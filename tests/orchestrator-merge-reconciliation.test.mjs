import test from "node:test";
import {
  assert,
  attachRunArtifact,
  JsonTaskStore,
  makeArtifact,
  makeGateResult,
  makeRuntimeRun,
  makeTestRow,
  mkdtemp,
  os,
  path,
  refreshGateFreshness,
  rm,
  TaskOrchestrator,
} from "./orchestrator-test-support.mjs";

test("blocks a failed pending merge and idempotently reconciles the retained approval intent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-merge-recovery-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Recover merge",
      description: "Finalize a merge that completed before task persistence.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
    });
    await store.update(task.id, (draft) => {
      draft.status = "merging";
      draft.currentStage = "approval";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "feature",
          baseRef: "refs/heads/feature",
          headRevision: "b".repeat(40),
          branch: "agent-harness/ah-001-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "awaiting_human_approval",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        },
      ];
      draft.mergeIntent = {
        candidateId: "C1",
        candidateRevision: 1,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        targetRef: "refs/heads/feature",
        note: "Approved before restart.",
        status: "pending",
        startedAt: new Date().toISOString(),
        completedAt: null,
        error: null,
      };
      const devReview = makeRuntimeRun({
        id: "RUN-DEV-RECOVERY",
        stage: "dev-review",
        candidateRevision: 1,
        artifactId: "ART-DEV-RECOVERY",
        gateResult: makeGateResult({ candidateRevision: 1 }),
      });
      const testRun = makeRuntimeRun({
        id: "RUN-TEST-RECOVERY",
        stage: "test",
        kind: "test",
        candidateRevision: 1,
        artifactId: "ART-TEST-RECOVERY",
        gateResult: makeGateResult({ stage: "test", candidateRevision: 1 }),
      });
      const finalReview = makeRuntimeRun({
        id: "RUN-FINAL-RECOVERY",
        stage: "final-review",
        candidateRevision: 1,
        artifactId: "ART-FINAL-RECOVERY",
        gateResult: makeGateResult({ stage: "final-review", candidateRevision: 1 }),
      });
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 1,
        bindingExplicit: true,
        command: "npm test",
        status: "passed",
        rows: [makeTestRow({ candidateRevision: 1 })],
      };
      draft.runs = [devReview, testRun, finalReview];
      draft.artifacts = [
        makeArtifact({ id: "ART-DEV-RECOVERY", candidateRevision: 1, gateResult: devReview.gateResult }),
        makeArtifact({
          id: "ART-TEST-RECOVERY",
          stage: "test",
          candidateRevision: 1,
          gateResult: testRun.gateResult,
          focusedTest,
        }),
        makeArtifact({
          id: "ART-FINAL-RECOVERY",
          stage: "final-review",
          candidateRevision: 1,
          gateResult: finalReview.gateResult,
        }),
      ];
      attachRunArtifact(draft, testRun.id, draft.artifacts[1]);
      refreshGateFreshness(draft);
    });
    let mergeCalls = 0;
    let mergeStateCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        mergeState: async () => {
          mergeStateCalls += 1;
          if (mergeStateCalls === 1)
            throw new Error("Known fast-forward failure after approval intent was recorded.");
          return "merged";
        },
        merge: async () => {
          mergeCalls += 1;
        },
      },
    });

    await orchestrator.recoverMergeIntents();
    const blocked = await store.get(task.id);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blocker.code, "merge-reconciliation");
    assert.equal(blocked.mergeIntent.status, "failed");
    assert.match(blocked.mergeIntent.error, /Known fast-forward failure/);

    await orchestrator.reconcileMerge(task.id);
    await orchestrator.reconcileMerge(task.id);
    const recovered = await store.get(task.id);
    assert.equal(recovered.status, "merged-to-target");
    assert.equal(recovered.mergeIntent.status, "completed");
    assert.equal(recovered.mergeIntent.note, "Approved before restart.");
    assert.equal(recovered.mergeIntent.reconciliationAttempts, 1);
    assert.equal(recovered.approvals.filter((approval) => approval.stage === "approval").length, 1);
    assert.equal(mergeCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refreshes a target-diverged candidate as a new revision and invalidates downstream gates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-refresh-candidate-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Refresh candidate",
      description: "Replay an approved candidate onto the latest target.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const oldBase = "a".repeat(40);
    const oldHead = "b".repeat(40);
    const targetHead = "c".repeat(40);
    const refreshedHead = "d".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "approval";
      draft.error = "The recorded target ref diverged while recovering a pending merge.";
      draft.blocker = { code: "target-diverged", detail: draft.error, detectedAt: new Date().toISOString() };
      draft.completedStages = [
        "triage",
        "scouts",
        "grill",
        "specification",
        "plan",
        "implement",
        "dev-review",
        "test",
        "final-review",
      ];
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: oldBase,
          baseBranch: "main",
          baseRef: "refs/heads/main",
          headRevision: oldHead,
          branch: "agent-harness/ah-001-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "awaiting_human_approval",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [
            { number: 1, headRevision: oldHead, reason: "assembly", createdAt: new Date().toISOString() },
          ],
        },
      ];
      draft.mergeIntent = { status: "failed", error: draft.error };
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        refreshCandidate: async () => ({
          previousBaseRevision: oldBase,
          previousHeadRevision: oldHead,
          targetRevision: targetHead,
          headRevision: refreshedHead,
          files: ["src/change.ts"],
          summary: "1 file changed",
        }),
      },
    });

    await orchestrator.refreshCandidate(task.id);
    const refreshed = await store.get(task.id);
    const candidate = refreshed.candidates[0];
    assert.equal(refreshed.status, "ready-for-review");
    assert.equal(refreshed.currentStage, "dev-review");
    assert.equal(refreshed.error, null);
    assert.equal(refreshed.blocker, null);
    assert.equal(refreshed.mergeIntent, null);
    assert.equal(candidate.revisionNumber, 2);
    assert.equal(candidate.baseRevision, targetHead);
    assert.equal(candidate.headRevision, refreshedHead);
    assert.equal(candidate.revisions.at(-1).reason, "target-refresh");
    assert.equal(refreshed.mergeIntent, null);
    assert.equal(refreshed.mergeIntentHistory.length, 1);
    assert.equal(refreshed.mergeIntentHistory[0].status, "failed");
    assert.equal(refreshed.mergeIntentHistory[0].supersededByCandidateRevision, 2);
    assert.deepEqual(refreshed.completedStages, [
      "triage",
      "scouts",
      "grill",
      "specification",
      "plan",
      "implement",
    ]);
    assert.match(refreshed.events.at(-1).detail, /must pass every candidate-bound gate again/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("blocks a candidate gate on target drift before reserving an attempt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-gate-target-drift-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Pause stale candidate gate",
      description: "Do not spend a review attempt after the target advances.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = 2;
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          baseRef: "refs/heads/main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/stale-candidate",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_review",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        },
      ];
    });
    let restoreCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        ensureCandidate: async () => {
          restoreCalls += 1;
          return true;
        },
        mergeState: async () => "diverged",
      },
    });

    await assert.rejects(
      () => orchestrator.start(task.id, "review"),
      /Refresh the candidate before spending another candidate-bound gate attempt/,
    );
    const blocked = await store.get(task.id);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blocker.code, "target-diverged");
    assert.equal(blocked.attemptsByStage["dev-review"], 2);
    assert.equal(blocked.activeRunKind, null);
    assert.equal(restoreCalls, 1);
    assert.equal(
      blocked.events.some((event) => event.title === "Candidate worktree restored"),
      true,
    );
    assert.match(blocked.events.at(-1).detail, /No gate attempt was spent/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
