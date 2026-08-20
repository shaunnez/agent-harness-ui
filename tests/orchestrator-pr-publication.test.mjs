import test from "node:test";
import {
  assert,
  attachRunArtifact,
  createApprovalReadyTask,
  JsonTaskStore,
  makeArtifact,
  makeGateResult,
  makePersistedFinding,
  makeRuntimeRun,
  makeTestRow,
  mkdtemp,
  os,
  path,
  pullRequestObservation,
  refreshGateFreshness,
  rm,
  TaskOrchestrator,
} from "./orchestrator-test-support.mjs";

test("raises an exact-candidate GitHub PR and completes only after polling observes its merge", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-pr-lifecycle-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await createApprovalReadyTask(store, directory, "Raise a governed PR");
    let state = "open";
    const pullRequestManager = {
      async publish({ candidate, intent }) {
        assert.equal(candidate.headRevision, "b".repeat(40));
        assert.equal(intent.note, "Approved for GitHub review.");
        return pullRequestObservation({ state: "open" });
      },
      async inspect(intent) {
        assert.equal(intent.number, 84);
        return pullRequestObservation({ state });
      },
    };
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { async verifyCandidate() {} },
      pullRequestManager,
    });

    const opened = await orchestrator.approvePullRequest(task.id, "Approved for GitHub review.");
    assert.equal(opened.status, "awaiting-pr-merge");
    assert.equal(opened.candidates.at(-1).status, "pull_request_open");
    assert.equal(opened.pullRequestIntent.status, "open");
    assert.equal(opened.pullRequestIntent.number, 84);
    assert.equal(opened.approvals.length, 1);
    assert.match(opened.artifacts.at(-1).content, /github\.com\/acme\/widgets\/pull\/84/i);
    assert.equal(opened.completedStages.includes("approval"), false);

    const openedUpdatedAt = opened.updatedAt;
    await orchestrator.pollPullRequests();
    const stillOpen = await store.get(task.id);
    assert.equal(stillOpen.status, "awaiting-pr-merge");
    assert.equal(stillOpen.pullRequestIntent.consecutivePollFailures, 0);
    assert.equal(
      stillOpen.updatedAt,
      openedUpdatedAt,
      "poll telemetry must not masquerade as semantic task progress",
    );

    state = "merged";
    await orchestrator.pollPullRequests();
    const completed = await store.get(task.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.candidates.at(-1).status, "merged");
    assert.equal(completed.pullRequestIntent.status, "merged");
    assert.equal(completed.pullRequestIntent.mergeCommitRevision, "c".repeat(40));
    assert.equal(completed.completedStages.includes("approval"), true);
    assert.match(completed.events.at(-1).title, /GitHub PR merged/i);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("retains open PR state across transient polling errors and blocks a closed-unmerged PR", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-pr-polling-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await createApprovalReadyTask(store, directory, "Poll a governed PR");
    let inspection = "error";
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { async verifyCandidate() {} },
      pullRequestManager: {
        async publish() {
          return pullRequestObservation({ state: "open" });
        },
        async inspect() {
          if (inspection === "error") throw new Error("GitHub is temporarily unavailable.");
          return pullRequestObservation({ state: "closed" });
        },
      },
    });
    await orchestrator.approvePullRequest(task.id);
    const openedUpdatedAt = (await store.get(task.id)).updatedAt;

    await orchestrator.pollPullRequests();
    const unavailable = await store.get(task.id);
    assert.equal(unavailable.status, "awaiting-pr-merge");
    assert.equal(unavailable.pullRequestIntent.status, "open");
    assert.equal(unavailable.pullRequestIntent.consecutivePollFailures, 1);
    assert.match(unavailable.pullRequestIntent.lastError, /temporarily unavailable/i);
    assert.equal(unavailable.updatedAt, openedUpdatedAt);

    inspection = "closed";
    await orchestrator.pollPullRequests();
    const closed = await store.get(task.id);
    assert.equal(closed.status, "blocked");
    assert.equal(closed.blocker.code, "pull-request-closed");
    assert.equal(closed.pullRequestIntent.status, "closed");
    assert.equal(closed.completedStages.includes("approval"), false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("merge approval fails closed when persisted Test verdicts contradict", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-stale-approval-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject stale approval",
      description: "Status fields cannot override authoritative gate freshness.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
      // Local merge is opt-in now; this test drives that path deliberately.
      draft.approvalCompletion = "local-merge";
      draft.currentStage = "approval";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          status: "awaiting_human_approval",
        },
      ];
      const devReview = makeRuntimeRun({ id: "RUN-DEV", stage: "dev-review", artifactId: "ART-DEV" });
      const testRun = makeRuntimeRun({
        id: "RUN-TEST",
        stage: "test",
        kind: "test",
        artifactId: "ART-TEST",
        gateResult: makeGateResult({ stage: "test", verdict: "PASS", reportedVerdict: "REPAIR" }),
      });
      const finalReview = makeRuntimeRun({
        id: "RUN-FINAL",
        stage: "final-review",
        artifactId: "ART-FINAL",
        gateResult: makeGateResult({ stage: "final-review" }),
      });
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 2,
        bindingExplicit: true,
        command: "npm test",
        status: "passed",
        rows: [makeTestRow()],
      };
      draft.runs = [devReview, testRun, finalReview];
      draft.artifacts = [
        makeArtifact({ id: "ART-DEV" }),
        makeArtifact({ id: "ART-TEST", stage: "test", gateResult: testRun.gateResult, focusedTest }),
        makeArtifact({ id: "ART-FINAL", stage: "final-review", gateResult: finalReview.gateResult }),
      ];
      attachRunArtifact(draft, "RUN-TEST", draft.artifacts[1]);
      refreshGateFreshness(draft);
    });

    const beforeApproval = await store.get(task.id);
    assert.equal(beforeApproval.gateFreshness["dev-review"].fresh, true);
    assert.equal(beforeApproval.gateFreshness.test.fresh, false);
    assert.equal(beforeApproval.gateFreshness.test.reasonCode, "contradictory_evidence");
    assert.equal(beforeApproval.gateFreshness["final-review"].fresh, true);
    assert.equal(
      beforeApproval.runs.find((run) => run.id === "RUN-TEST").gateResult.reportedVerdict,
      "REPAIR",
    );

    let merged = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        async merge() {
          merged = true;
        },
      },
    });

    await assert.rejects(() => orchestrator.approveMerge(task.id), /cannot be approved.*not fresh/i);
    const rejected = await store.get(task.id);
    assert.equal(rejected.status, "awaiting-human-approval");
    assert.equal(rejected.mergeIntent, null);
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("merge approval fails closed when persisted gate findings are malformed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-malformed-finding-approval-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject malformed gate findings",
      description: "Persisted finding shapes must not authorize a merge.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
      // Local merge is opt-in now; this test drives that path deliberately.
      draft.approvalCompletion = "local-merge";
      draft.currentStage = "approval";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          status: "awaiting_human_approval",
        },
      ];
      const malformedFinding = makePersistedFinding({ severity: "p0" });
      const devReview = makeRuntimeRun({
        id: "RUN-DEV-MALFORMED",
        stage: "dev-review",
        gateResult: makeGateResult({ stage: "dev-review", findings: [malformedFinding] }),
      });
      const testRun = makeRuntimeRun({
        id: "RUN-TEST-MALFORMED",
        stage: "test",
        kind: "test",
        artifactId: "ART-TEST-MALFORMED",
        gateResult: makeGateResult({ stage: "test", findings: [malformedFinding] }),
      });
      const finalReview = makeRuntimeRun({
        id: "RUN-FINAL-MALFORMED",
        stage: "final-review",
        gateResult: makeGateResult({ stage: "final-review", findings: [malformedFinding] }),
      });
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 2,
        bindingExplicit: true,
        command: "npm test",
        status: "passed",
        rows: [makeTestRow()],
      };
      const testArtifact = makeArtifact({
        id: "ART-TEST-MALFORMED",
        stage: "test",
        gateResult: testRun.gateResult,
        focusedTest,
      });
      draft.runs = [devReview, testRun, finalReview];
      draft.artifacts = [testArtifact];
      attachRunArtifact(draft, testRun.id, testArtifact);
      refreshGateFreshness(draft);
    });

    const beforeApproval = await store.get(task.id);
    for (const stage of ["dev-review", "test", "final-review"]) {
      assert.equal(beforeApproval.gateFreshness[stage].fresh, false, stage);
      assert.equal(beforeApproval.gateFreshness[stage].reasonCode, "contradictory_evidence", stage);
    }

    let merged = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        async merge() {
          merged = true;
        },
      },
    });
    await assert.rejects(() => orchestrator.approveMerge(task.id), /cannot be approved.*not fresh/i);
    const rejected = await store.get(task.id);
    assert.equal(rejected.mergeIntent, null);
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
