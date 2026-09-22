import test from "node:test";
import { CandidateOperationsOrchestrator } from "../server/orchestrator-candidate-operations.mjs";
import { withActionEligibility } from "../server/retry-admission-policy.mjs";
import {
  assert,
  JsonTaskStore,
  makeFocusedTestSummary,
  mkdtemp,
  os,
  path,
  rm,
  gateOutput,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

test("recovers an interrupted refresh and rebases onto the captured authority revision", async () => {
  const oldBase = "a".repeat(40);
  const oldHead = "b".repeat(40);
  const targetRevision = "c".repeat(40);
  const refreshedHead = "d".repeat(40);
  const task = {
    id: "AH-078",
    repositoryPath: "/tmp/repository",
    status: "blocked",
    currentStage: "dev-review",
    error: "The target branch advanced.",
    blocker: { code: "target-diverged", detail: "The target branch advanced." },
    candidates: [
      {
        id: "C1",
        revisionNumber: 3,
        baseRevision: oldBase,
        headRevision: oldHead,
        status: "ready_for_review",
        revisions: [],
      },
    ],
    completedStages: ["implement"],
    repositoryAuthorityHistory: [],
    runs: [],
    artifacts: [],
    events: [],
  };
  let verifyCalls = 0;
  let recovered = 0;
  const authority = {
    id: "authority-current",
    selectedRevision: targetRevision,
    capturedAt: "2026-09-15T01:00:00.000Z",
    upstreamRef: "refs/remotes/origin/main",
    remoteVerification: { status: "verified", error: null },
  };
  const orchestrator = new CandidateOperationsOrchestrator({
    store: {
      get: async () => structuredClone(task),
      transition: async (_id, condition, updater) => {
        assert.equal(condition(task), true);
        updater(task);
        return structuredClone(task);
      },
    },
    github: {},
    mergeActive: new Set(),
    refreshActive: new Set(),
    repositoryAuthority: { capture: async () => structuredClone(authority) },
    start: () => {},
    worktrees: {
      verifyCandidate: async () => {
        verifyCalls += 1;
        if (verifyCalls === 1) {
          throw new Error("The candidate worktree no longer matches its recorded revision.");
        }
      },
      recoverCandidate: async () => {
        recovered += 1;
        return true;
      },
      refreshCandidate: async (_candidate, options) => {
        assert.deepEqual(options, { targetRevision });
        return {
          previousBaseRevision: oldBase,
          previousHeadRevision: oldHead,
          targetRevision,
          headRevision: refreshedHead,
          files: ["src/change.ts"],
          summary: "src/change.ts | 1 +",
        };
      },
    },
  });

  const refreshed = await orchestrator.refreshCandidate(task.id);

  assert.equal(recovered, 1);
  assert.equal(refreshed.candidates[0].revisionNumber, 4);
  assert.equal(refreshed.candidates[0].baseRevision, targetRevision);
  assert.equal(refreshed.candidates[0].headRevision, refreshedHead);
  assert.equal(refreshed.events.at(-1).title, "Interrupted candidate refresh recovered");
});

test("records refresh conflicts and rebuilds approved packages from the latest target", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-rebuild-candidate-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Rebuild conflicted candidate",
      description: "Retain the old candidate and rerun the approved plan.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.error = "The target branch advanced.";
      draft.blocker = { code: "target-diverged", detail: draft.error, detectedAt: new Date().toISOString() };
      draft.completedStages = [
        "triage",
        "scouts",
        "grill",
        "specification",
        "plan",
        "implement",
        "dev-review",
      ];
      draft.attemptsByStage.implement = 3;
      draft.stageRunLimits.implement = 3;
      draft.workPackages = [
        {
          id: "S1",
          title: "Approved slice",
          description: "Reapply the approved outcome.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/change.ts"],
          verificationCommandIds: ["test"],
          verification: ["test"],
          status: "integrated",
          attempts: 1,
          branch: "agent-harness/old-slice",
          worktreePath: directory,
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          files: ["src/change.ts"],
          verificationRuns: [{ status: "passed" }],
        },
      ];
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          baseRef: "refs/heads/main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/old-candidate",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_test",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        },
      ];
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        refreshCandidate: async () => {
          throw new Error("Candidate refresh conflicted while replaying it onto main: overlap");
        },
        mergeState: async () => "diverged",
      },
    });

    await assert.rejects(() => orchestrator.refreshCandidate(task.id), /refresh conflicted/i);
    const conflicted = await store.get(task.id);
    assert.equal(conflicted.blocker.code, "target-refresh-conflict");

    await orchestrator.rebuildCandidateFromTarget(task.id);
    const rebuilt = await store.get(task.id);
    assert.equal(rebuilt.status, "ready-for-implementation");
    assert.equal(rebuilt.currentStage, "implement");
    assert.equal(rebuilt.candidates[0].status, "superseded");
    assert.equal(rebuilt.workPackages[0].status, "planned");
    assert.deepEqual(rebuilt.workPackages[0].verificationRuns, []);
    assert.equal(rebuilt.stageRunLimits.implement, 4);
    assert.deepEqual(rebuilt.completedStages, ["triage", "scouts", "grill", "specification", "plan"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restarts stopped pre-candidate packages from an advanced target", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-restart-implementation-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Restart stale packages",
      description: "Do not continue historical slices after the target advances.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error = "S1 crossed its ownership boundary.";
      draft.blocker = {
        code: "implementation-target-diverged",
        detail: "The checkout advanced beyond the captured upstream authority.",
        detectedAt: "2026-08-01T12:00:00.000Z",
      };
      draft.repositoryAuthority = {
        selectedRevision: "a".repeat(40),
      };
      draft.attemptsByStage.implement = 3;
      draft.stageRunLimits.implement = 3;
      draft.workPackages = [
        {
          id: "S1",
          title: "Approved slice",
          description: "Implement from the current target.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/change.ts"],
          verificationCommandIds: ["test"],
          status: "failed",
          attempts: 1,
          baseRevision: "a".repeat(40),
          branch: "agent-harness/old-slice",
          worktreePath: directory,
          headRevision: null,
          files: [],
          error: draft.error,
          verificationRuns: [{ status: "failed" }],
        },
      ];
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ baseRevision: "b".repeat(40), baseBranch: "main", repositoryRoot: directory }),
      },
    });

    await orchestrator.restartImplementationFromTarget(task.id);
    const restarted = await store.get(task.id);
    assert.equal(restarted.status, "ready-for-implementation");
    assert.equal(restarted.currentStage, "implement");
    assert.equal(restarted.workPackages[0].status, "planned");
    assert.deepEqual(restarted.workPackages[0].verificationRuns, []);
    assert.equal(restarted.stageRunLimits.implement, 4);
    assert.match(restarted.events.at(-1).detail, /aaaaaaaa/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("replays one clean retained package onto an advanced target for zero-model requalification", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-replay-retained-package-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Replay retained package",
      description: "Preserve the completed slice when the target advances during qualification.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    const oldBase = "a".repeat(40);
    const oldHead = "b".repeat(40);
    const targetRevision = "c".repeat(40);
    const replayedHead = "d".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.blocker = {
        code: "implementation-target-diverged",
        detail: "The target advanced while package qualification was settling.",
        detectedAt: new Date().toISOString(),
      };
      draft.repositoryAuthority = { selectedRevision: targetRevision };
      draft.workPackages = [
        {
          id: "S1",
          title: "Retained slice",
          description: "Replay this exact change.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/change.ts"],
          verificationCommandIds: ["test"],
          status: "failed",
          attempts: 1,
          baseRevision: oldBase,
          branch: "agent-harness/old-slice",
          worktreePath: directory,
          headRevision: oldHead,
          files: ["src/change.ts"],
          error: "S1 did not qualify before the target moved.",
          verificationRuns: [{ status: "failed", headRevision: oldHead }],
        },
      ];
    });
    let refreshOptions = null;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        inspectRetainedSlice: async () => ({
          clean: true,
          branch: "agent-harness/old-slice",
          worktreePath: directory,
          headRevision: oldHead,
          files: ["src/change.ts"],
        }),
        refreshCandidate: async (_package, options) => {
          refreshOptions = options;
          return {
            targetRevision,
            headRevision: replayedHead,
            files: ["src/change.ts"],
          };
        },
      },
    });

    await orchestrator.restartImplementationFromTarget(task.id);
    const restarted = await store.get(task.id);
    assert.deepEqual(refreshOptions, { targetRevision });
    assert.equal(restarted.workPackages[0].baseRevision, targetRevision);
    assert.equal(restarted.workPackages[0].headRevision, replayedHead);
    assert.equal(restarted.workPackages[0].retainedForRequalification, true);
    assert.match(restarted.events.at(-1).detail, /without another model implementation run/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const scenario of [
  { name: "timed-out", error: "Codex run exceeded 900 seconds.", failsCommit: false },
]) {
  test(`continues a ${scenario.name} retained package while preserving completed dependencies and ownership`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-retained-continuation-"));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: "Continue retained package",
        description: "Resume the exact timed-out slice with a bounded longer timeout.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "high",
      });
      const baseRevision = "a".repeat(40);
      const packageRevision = "b".repeat(40);
      const candidateRevision = "c".repeat(40);
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = "implement";
        draft.error = `S2: ${scenario.error}`;
        draft.repositoryAuthorityStatus = "bound";
        draft.repositoryAuthority = {
          id: "retained-authority",
          repositoryRoot: directory,
          selectedRevision: baseRevision,
          targetRef: "refs/heads/main",
          checkoutBranch: "main",
          capturedAt: new Date().toISOString(),
        };
        draft.attemptsByStage.implement = 4;
        draft.stageRunLimits.implement = 5;
        draft.workPackages = [
          {
            id: "S1",
            title: "Qualified dependency",
            description: "Already finished.",
            dependencies: [],
            batch: 1,
            ownedPaths: ["src/dependency.ts"],
            verificationCommandIds: ["test"],
            verificationRuns: [],
            status: "ready_for_integration",
            attempts: 2,
            branch: "agent-harness/retained-s1-a2",
            worktreePath: null,
            baseRevision,
            headRevision: "d".repeat(40),
            files: ["src/dependency.ts"],
            error: null,
          },
          {
            id: "S2",
            title: "Retained implementation",
            description: "Finish the retained package.",
            dependencies: ["S1"],
            batch: 2,
            ownedPaths: ["src/feature.ts"],
            verification: [],
            verificationCommandIds: ["test"],
            verificationRuns: [],
            status: "failed",
            attempts: 4,
            branch: "agent-harness/retained-s2-a4",
            worktreePath: "/tmp/retained-s2-a4",
            baseRevision,
            headRevision: null,
            files: [],
            error: scenario.error,
          },
        ];
      });
      const dependency = (await store.get(task.id)).workPackages[0];
      assert.equal(
        withActionEligibility(await store.get(task.id)).actionEligibility.actions["continue-package"].allowed,
        true,
      );
      let request = null;
      let modelCalls = 0;
      const orchestrator = new TaskOrchestrator(store, {
        readVerificationManifest: async () => ({
          source: ".agent-harness/verification.json",
          commands: [{ id: "test", command: ["npm", "test"] }],
        }),
        runCodex: async (input) => {
          request = input;
          modelCalls += 1;
          return {
            finalText:
              "## Outcome\nDone\n## Changes\nScoped\n## Verification\nFocused\n## Ownership exceptions\nNone\n## Remaining risks\nNone",
            model: "gpt-5.6-sol",
            reasoning: "xhigh",
            usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
          };
        },
        runPackageVerification: async () =>
          makeFocusedTestSummary({ candidateId: "S2", candidateRevision: 5 }),
        worktreeManager: {
          base: async () => ({ repositoryRoot: directory, baseRevision, baseBranch: "main" }),
          inspectRetainedSlice: async () => ({
            branch: "agent-harness/retained-s2-a4",
            files: ["src/feature.ts", "src/outside.ts"],
            headRevision: baseRevision,
            worktreePath: "/tmp/retained-s2-a4",
            clean: false,
          }),
          commit: async (_slice, _message, options) => {
            assert.deepEqual(options.ownedPaths, ["src/feature.ts"]);
            if (scenario.failsCommit) throw new Error(scenario.error);
            return {
              headRevision: packageRevision,
              files: ["src/feature.ts"],
              summary: "1 file changed",
              ownSummary: "1 file changed",
              noChangesNeeded: false,
            };
          },
          removeWorktree: async () => [],
          prepare: async (_task, candidateId, options) => ({
            id: candidateId,
            revisionNumber: 1,
            baseRevision: options.baseRevision,
            baseBranch: "main",
            baseRef: "refs/heads/main",
            headRevision: null,
            branch: `agent-harness/${candidateId.toLowerCase()}`,
            repositoryRoot: directory,
            worktreePath: directory,
            status: "assembling",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revisions: [],
          }),
          assemble: async () => ({
            headRevision: candidateRevision,
            files: ["src/feature.ts"],
            summary: "1 file changed",
            diff: "",
          }),
        },
      });

      assert.deepEqual(await orchestrator.continueRetainedPackage(task.id), { started: true });
      const ready = await waitForStatus(
        store,
        task.id,
        scenario.failsCommit ? "blocked" : "ready-for-review",
      );
      assert.equal(modelCalls, 1);
      assert.deepEqual(ready.workPackages[0].headRevision, dependency.headRevision);
      assert.equal(ready.workPackages[0].attempts, dependency.attempts);
      assert.equal(ready.workPackages[1].attempts, 5);
      assert.equal(ready.stageRunLimits.implement, 5);
      // The stage default is the hour-long runaway guard; a continuation no longer
      // escalates past it because that value is also the override clamp ceiling.
      assert.equal(request.timeoutMs, 3_600_000);
      assert.match(
        request.prompt,
        /restore every retained path outside declared ownership: src\/outside\.ts/i,
      );
      if (scenario.failsCommit) {
        assert.equal(ready.candidates.length, 0);
        assert.equal(ready.workPackages[1].status, "failed");
        assert.equal(ready.workPackages[1].error, scenario.error);
      } else {
        assert.equal(ready.candidates[0].baseRevision, baseRevision);
        assert.equal(ready.candidates[0].headRevision, candidateRevision);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("an advanced target refreshes the candidate and restarts Dev Review without an operator retry", async () => {
  // Merging anything into the target used to park every in-flight candidate at `blocked`
  // until an operator pressed Refresh: 76 recorded "Candidate gate paused for target
  // refresh" events against 73 manual refreshes. The rebase is mechanical, so the harness
  // does it and reruns the candidate-bound gates from Dev Review.
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-auto-refresh-"));
  const targetRevision = "c".repeat(40);
  const refreshedHead = "d".repeat(40);
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Survive an advanced target",
      description: "A merge into the target must not cost an operator retry.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.completedStages = [
        "triage",
        "scouts",
        "grill",
        "specification",
        "plan",
        "implement",
        "dev-review",
      ];
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          baseRef: "refs/heads/main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/auto-refresh",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_test",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        },
      ];
    });

    let refreshes = 0;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        verifyCandidate: async () => {},
        // Diverged until the rebase lands, then sitting on the target like a real one.
        mergeState: async () => (refreshes === 0 ? "diverged" : "pending"),
        refreshCandidate: async (candidate) => {
          refreshes += 1;
          return {
            targetRevision,
            headRevision: refreshedHead,
            previousBaseRevision: candidate.baseRevision,
            previousHeadRevision: candidate.headRevision,
            alreadyApplied: false,
          };
        },
      },
      repositoryAuthorityService: {
        capture: async () => ({ id: "auth-1", selectedRevision: targetRevision, upstreamRef: null }),
      },
      runCodex: async () => ({
        finalText: gateOutput(2),
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
      }),
    });

    // The operator asked for Test. The target had moved, so the candidate is rebased and
    // Dev Review runs instead — the gate that a new revision actually has to clear first.
    assert.equal(await orchestrator.start(task.id, "test"), true);
    const after = await waitForStatus(store, task.id, "ready-for-test");

    assert.equal(refreshes, 1);
    assert.equal(after.candidates[0].revisionNumber, 2);
    assert.equal(after.candidates[0].baseRevision, targetRevision);
    assert.equal(after.candidates[0].headRevision, refreshedHead);
    // The task never needed a human: it is runnable, not blocked.
    assert.equal(after.blocker, null);
    assert.ok(
      after.events.some(
        (event) => event.title === "Candidate refreshed automatically after the target advanced",
      ),
      "the automatic refresh must be recorded as evidence",
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
