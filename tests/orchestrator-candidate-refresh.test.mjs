import test from "node:test";
import { withActionEligibility } from "../server/retry-admission-policy.mjs";
import {
  assert,
  JsonTaskStore,
  makeFocusedTestSummary,
  mkdtemp,
  os,
  path,
  rm,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

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

for (const scenario of [
  { name: "timed-out", error: "Codex run exceeded 900 seconds.", failsCommit: false },
  {
    name: "ownership-blocked",
    error: "Candidate changed src/outside.ts, which is outside the work package ownership (src/feature.ts).",
    failsCommit: false,
  },
  {
    name: "ownership-blocked with an unresolved exception",
    error: "Candidate changed src/outside.ts, which is outside the work package ownership (src/feature.ts).",
    failsCommit: true,
  },
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
        draft.stageRunLimits.implement = 4;
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
          makeFocusedTestSummary({ candidateId: "S2", candidateRevision: 4 }),
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
      assert.equal(ready.workPackages[1].attempts, 4);
      assert.equal(ready.stageRunLimits.implement, 5);
      assert.equal(request.timeoutMs, 1_800_000);
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
