import test from "node:test";
import {
  assert,
  git,
  JsonTaskStore,
  makeFocusedTestSummary,
  mkdtemp,
  os,
  parseWorkPackages,
  path,
  rm,
  TaskOrchestrator,
  waitForStatus,
  writeFile,
} from "./orchestrator-test-support.mjs";

test("fails a slice closed when harness-executed package verification fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-package-verification-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Fail slice qualification",
      description: "A package must not integrate after a failed repository command.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Runtime","description":"Implement runtime behavior.","dependencies":[],"ownedPaths":["server/runtime.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`,
      );
    });
    let commitCalls = 0;
    let assembleCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, id) => ({
          id,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${id.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: path.join(directory, id),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        commit: async () => {
          commitCalls += 1;
          return {
            headRevision: "b".repeat(40),
            files: ["server/runtime.mjs"],
            summary: "1 file changed",
            diff: "+change",
            ownSummary: "1 file changed",
            ownDiff: "+change",
          };
        },
        assemble: async () => {
          assembleCalls += 1;
          throw new Error("assembly must not run");
        },
      },
      runCodex: async () => ({
        finalText:
          "## Outcome\n\nImplemented.\n\n## Changes\n\nChanged runtime.\n\n## Verification\n\nPASS\n\n## Ownership exceptions\n\nNone.\n\n## Remaining risks\n\nNone.",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
      runPackageVerification: async ({ workPackageId, attempt }) => ({
        headRevision: "b".repeat(40),
        candidateId: workPackageId,
        candidateRevision: attempt,
        bindingExplicit: true,
        command: ".agent-harness/verification.json: test",
        status: "failed",
        startedAt: "2026-08-08T00:00:00.000Z",
        completedAt: "2026-08-08T00:00:01.000Z",
        durationMs: 1_000,
        rows: [
          {
            id: "test",
            candidateId: workPackageId,
            candidateRevision: attempt,
            bindingExplicit: true,
            title: "Tests",
            command: "npm test",
            status: "failed",
            durationMs: 1_000,
            artifactReferences: [],
            assertions: [{ label: "exit code", actual: "1", expected: "0" }],
            failureDetails: "npm test exited 1.",
          },
        ],
        executedCommandIds: ["test"],
        declaredCommandIds: ["test"],
      }),
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "failed");
    assert.equal(commitCalls, 1, "focused checks bind to the exact committed package revision");
    assert.equal(assembleCalls, 0);
    assert.equal(finished.workPackages[0].status, "failed");
    assert.match(finished.workPackages[0].error, /S1 did not qualify: test failed/);
    assert.deepEqual(finished.candidates, []);
    const artifact = finished.artifacts.find((item) => item.workPackageId === "S1");
    assert.equal(artifact.focusedTest.status, "failed");
    assert.match(artifact.content, /Harness slice qualification/);
    assert.match(artifact.content, /npm test exited 1/);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("bounds parallel package agents and serializes heavy package qualification", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-parallel-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Parallel implementation",
      description: "Run independent slices concurrently.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[
          {"id":"S1","title":"One","description":"First slice.","dependencies":[],"ownedPaths":["one.ts"],"verificationCommandIds":["test"]},
          {"id":"S2","title":"Two","description":"Second slice.","dependencies":[],"ownedPaths":["two.ts"],"verificationCommandIds":["test"]},
          {"id":"S3","title":"Three","description":"Third slice.","dependencies":[],"ownedPaths":["three.ts"],"verificationCommandIds":["test"]},
          {"id":"S4","title":"Four","description":"Fourth slice.","dependencies":[],"ownedPaths":["four.ts"],"verificationCommandIds":["test"]}
        ]}</work-packages>`,
      );
    });
    let activeAgents = 0;
    let maximumActiveAgents = 0;
    let activeQualifications = 0;
    let maximumActiveQualifications = 0;
    const releases = [];
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, id) => ({
          id,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${id.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: path.join(directory, id),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        commit: async (slice) => ({
          headRevision: { S1: "b", S2: "c", S3: "d", S4: "e" }[slice.id.slice(0, 2)].repeat(40),
          files: [`${slice.id}.txt`],
          summary: "1 file changed",
          diff: "+change",
          ownSummary: "1 file changed",
          ownDiff: "+change",
        }),
        assemble: async () => ({
          headRevision: "f".repeat(40),
          files: ["S1.txt", "S2.txt", "S3.txt", "S4.txt"],
          summary: "4 files changed",
          diff: "+changes",
        }),
      },
      runCodex: async () => {
        activeAgents += 1;
        maximumActiveAgents = Math.max(maximumActiveAgents, activeAgents);
        await new Promise((resolve) => {
          const fallback = setTimeout(resolve, 100);
          releases.push(() => {
            clearTimeout(fallback);
            resolve();
          });
          if (activeAgents === 2)
            releases.splice(0).forEach((release) => {
              release();
            });
        });
        activeAgents -= 1;
        return {
          finalText: "## Outcome\n\nReady",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
      packageConcurrency: 2,
      runPackageVerification: async ({ workPackageId, attempt }) => {
        activeQualifications += 1;
        maximumActiveQualifications = Math.max(maximumActiveQualifications, activeQualifications);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeQualifications -= 1;
        return makeFocusedTestSummary({ candidateId: workPackageId, candidateRevision: attempt });
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(maximumActiveAgents, 2);
    assert.equal(maximumActiveQualifications, 1);
    assert.deepEqual(
      finished.candidates[0].members.map((member) => member.packageId),
      ["S1", "S2", "S3", "S4"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("accepts a work package's declared no-op instead of failing on an empty diff", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-noop-package-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Single no-op package",
      description: "Verification already passes; nothing should need to change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Keep ignored","description":"Verify only.","dependencies":[],"ownedPaths":["e2e/.gitignore"],"verificationCommandIds":["test"]}]}</work-packages>`,
      );
    });
    let sawAllowNoChanges = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, id) => ({
          id,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${id.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: path.join(directory, id),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        // Mirrors `GitWorktreeManager.commit`'s real `allowNoChanges` contract: only
        // returns the no-op shape when the orchestrator explicitly asked for it, which
        // it must only do after reading the agent's `<no-changes-needed>` marker.
        commit: async (_slice, _message, options) => {
          sawAllowNoChanges = options?.allowNoChanges === true;
          if (!options?.allowNoChanges)
            throw new Error("The implementation agent completed without changing any files.");
          return {
            headRevision: null,
            parentRevision: null,
            files: [],
            summary: "",
            diff: "",
            ownSummary: "",
            ownDiff: "",
            noChangesNeeded: true,
          };
        },
        assemble: async () => ({ headRevision: "a".repeat(40), files: [], summary: "", diff: "" }),
      },
      runCodex: async () => ({
        finalText:
          '## Outcome\n\nAlready ignored; nothing to change.\n\n<no-changes-needed>{"reason":"git check-ignore -v already exits 0 for playwright-report/results.json"}</no-changes-needed>',
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(sawAllowNoChanges, true);
    // "integrated": assembly already folded it in by the time the task reaches
    // ready-for-review, same terminal status a real committed package ends at.
    assert.equal(finished.workPackages[0].status, "integrated");
    assert.equal(finished.workPackages[0].headRevision, null);
    assert.deepEqual(finished.workPackages[0].files, []);
    assert.ok(finished.events.some((event) => /No changes needed/.test(event.detail ?? "")));
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("cleans up a superseded work-package worktree before retrying and after a successful commit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-worktree-cleanup-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Fails once, then succeeds",
      description: "Exercises worktree cleanup across a retry and a successful commit.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Runtime","description":"Implement runtime behavior.","dependencies":[],"ownedPaths":["server/runtime.mjs"],"verificationCommandIds":["test"]}]}</work-packages>`,
      );
    });
    let commitCalls = 0;
    const removedPaths = [];
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, id) => ({
          id,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${id.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: path.join(directory, id),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        commit: async () => {
          commitCalls += 1;
          if (commitCalls === 1) throw new Error("boom");
          return {
            headRevision: "b".repeat(40),
            files: ["server/runtime.mjs"],
            summary: "1 file changed",
            diff: "+change",
            ownSummary: "1 file changed",
            ownDiff: "+change",
          };
        },
        removeWorktree: async ({ worktreePath }) => {
          removedPaths.push(worktreePath);
        },
        assemble: async () => ({
          headRevision: "c".repeat(40),
          files: ["server/runtime.mjs"],
          summary: "1 file changed",
          diff: "+change",
        }),
      },
      runCodex: async () => ({
        finalText: "## Outcome\n\nDone",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    await waitForStatus(store, task.id, "failed");
    // The failed attempt's worktree survives its own failure, for inspection — it is
    // only reaped once superseded by the next retry.
    assert.deepEqual(removedPaths, []);

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.deepEqual(removedPaths, [path.join(directory, "S1-A1"), path.join(directory, "S1-A2")]);
    assert.equal(finished.workPackages[0].status, "integrated");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("does not flag a work package's own successful edit as a change to the source repository", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-source-snapshot-"));
  const repository = path.join(directory, "repository");
  const worktreeRootDirectory = path.join(directory, "worktrees");
  const previousRoot = process.env.AGENT_HARNESS_WORKTREE_ROOT;
  process.env.AGENT_HARNESS_WORKTREE_ROOT = worktreeRootDirectory;
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Edit a file inside its own isolated slice",
      description: "The slice worktree is supposed to end up dirty; that is the run succeeding.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Add a file","description":"Add feature.txt.","dependencies":[],"ownedPaths":["feature.txt"],"verificationCommandIds":["test"]}]}</work-packages>`,
      );
    });
    // No `worktreeManager` override: this exercises the real `GitWorktreeManager`, whose
    // `snapshotRepository`/`assertRepositoryUnchanged` are what the bug lived in. A fake
    // worktree manager (used by the other work-package tests here) never implements
    // those two methods, which is exactly why this interaction had no coverage before.
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: async ({ cwd }) => {
        await writeFile(path.join(cwd, "feature.txt"), "added by the agent\n", "utf8");
        return {
          finalText:
            "## Outcome\n\nAdded feature.txt.\n\n## Changes\n\nfeature.txt\n\n## Verification\n\nNone.\n\n## Ownership exceptions\n\nNone.\n\n## Remaining risks\n\nNone.",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(finished.workPackages[0].status, "integrated");
    assert.deepEqual(finished.workPackages[0].files, ["feature.txt"]);
  } finally {
    if (previousRoot === undefined) delete process.env.AGENT_HARNESS_WORKTREE_ROOT;
    else process.env.AGENT_HARNESS_WORKTREE_ROOT = previousRoot;
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("keeps implementation reservations candidate-unbound across assembly retries", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-assembly-retry-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Retry candidate assembly",
      description: "A failed candidate must not bind the next implementation attempt.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.stageRunLimits.implement = 2;
      draft.workPackages = [
        {
          id: "S1",
          title: "Single package",
          description: "Already qualified for candidate assembly.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["server/example.mjs"],
          verification: ["npm test"],
          verificationCommandIds: ["test"],
          status: "ready_for_integration",
          attempts: 1,
          branch: "agent-harness/test-s1",
          worktreePath: directory,
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          files: ["server/example.mjs"],
          error: null,
        },
      ];
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", title: "test", command: ["npm", "test"], report: null }],
      }),
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
        prepare: async (_task, candidateId) => ({
          id: candidateId,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: `agent-harness/${candidateId.toLowerCase()}`,
          repositoryRoot: directory,
          worktreePath: directory,
          status: "assembling",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        }),
        assemble: async () => {
          throw new Error("candidate assembly conflict");
        },
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    let failed = await waitForStatus(store, task.id, "failed");
    const firstReservation = failed.stageRunReservations.implement;
    assert.equal(firstReservation.workflowAttempt, 1);
    assert.equal(firstReservation.candidateId, null);
    assert.equal(failed.candidates[0].sourceWorkflowReservationId, firstReservation.id);
    assert.equal(failed.candidates[0].status, "failed");

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    failed = await waitForStatus(store, task.id, "blocked");
    const secondReservation = failed.stageRunReservations.implement;
    assert.equal(secondReservation.workflowAttempt, 2);
    assert.equal(secondReservation.candidateId, null);
    assert.equal(secondReservation.candidateRevision, null);
    assert.equal(secondReservation.candidateHeadRevision, null);
    assert.notEqual(secondReservation.id, firstReservation.id);
    assert.equal(failed.candidates[1].sourceWorkflowReservationId, secondReservation.id);
    assert.equal(failed.candidates[1].status, "failed");
    assert.equal(await orchestrator.start(task.id, "implementation"), false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
