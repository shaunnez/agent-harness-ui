import test from "node:test";
import { waitUntil } from "./wait-support.mjs";
import { readFile } from "node:fs/promises";
import { GitWorktreeManager } from "../server/git-worktree.mjs";
import {
  effectivePackageRuns,
  validInitialCandidateProducer,
  validateRetryRunScopes,
} from "../server/retry-reservation-validation.mjs";
import { candidateRevisionProducerEvidence } from "../server/candidate-lineage-validation.mjs";
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
        // Simulate an operator checkout that is locally ahead of the captured
        // repository authority. The real qualification error must remain primary.
        base: async () => ({ repositoryRoot: directory, baseRevision: "f".repeat(40), baseBranch: "main" }),
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

test("runs an upstream-bound implementation while the operator checkout is locally ahead", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-upstream-bound-"));
  const repository = path.join(directory, "repository");
  const remote = path.join(directory, "remote.git");
  const worktreeRootDirectory = path.join(directory, "worktrees");
  const previousRoot = process.env.AGENT_HARNESS_WORKTREE_ROOT;
  process.env.AGENT_HARNESS_WORKTREE_ROOT = worktreeRootDirectory;
  try {
    await git(directory, ["init", "--bare", remote]);
    await git(directory, ["init", repository]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);
    const baseRevision = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
    const branch = (await git(repository, ["branch", "--show-current"])).stdout.trim();
    await git(repository, ["remote", "add", "origin", remote]);
    await git(repository, ["push", "-u", "origin", branch]);
    await writeFile(path.join(repository, "operator-local.txt"), "unpublished local commit\n", "utf8");
    await git(repository, ["add", "operator-local.txt"]);
    await git(repository, ["commit", "-m", "operator local commit"]);
    const localRevision = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();

    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Implement from the tracked target",
      description: "Keep an unrelated local commit out of the approved implementation base.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        `<work-packages>{"packages":[{"id":"S1","title":"Add feature","description":"Add feature.txt.","dependencies":[],"ownedPaths":["feature.txt"],"verificationCommandIds":["test"]}]}</work-packages>`,
      );
    });
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: async ({ cwd }) => {
        await writeFile(path.join(cwd, "feature.txt"), "candidate change\n", "utf8");
        return {
          finalText:
            "## Outcome\n\nAdded feature.txt.\n\n## Changes\n\nfeature.txt\n\n## Verification\n\nNone.\n\n## Ownership exceptions\n\nNone.\n\n## Remaining risks\n\nNone.",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(finished.repositoryAuthority.selectedRevision, baseRevision);
    assert.equal(finished.repositoryAuthority.localHead, localRevision);
    assert.equal(finished.repositoryAuthority.relationship, "ahead");
    assert.equal(finished.candidates[0].baseRevision, baseRevision);
    assert.deepEqual(finished.workPackages[0].files, ["feature.txt"]);
    const candidateFiles = (
      await git(finished.candidates[0].worktreePath, ["ls-tree", "--name-only", "HEAD"])
    ).stdout
      .trim()
      .split("\n");
    assert.deepEqual(candidateFiles, ["README.md", "feature.txt"]);
    assert.equal((await git(repository, ["rev-parse", "HEAD"])).stdout.trim(), localRevision);
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

test("a dirty source checkout refuses Implement before a stage attempt is spent", async () => {
  // `GitWorktreeManager.base()` already rejects a dirty tree, but only several steps into
  // the run — after the stage is reserved and the attempt counted. All 13 recorded
  // "uncommitted changes" stage failures were at Implement, each one spending an attempt
  // against the stage run limit for a condition visible before any model ran.
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-dirty-preflight-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Refuse a dirty checkout",
      description: "An uncommitted tree must not cost a stage attempt.",
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
    const before = await store.get(task.id);
    const attemptsBefore = before.attemptsByStage?.implement ?? 0;

    let codexRuns = 0;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        uncommittedEntries: async () => ["src/scratch.ts", "notes.md"],
        base: async () => {
          throw new Error("base() must not be reached for a dirty checkout");
        },
      },
      runCodex: async () => {
        codexRuns += 1;
        return { finalText: "", usage: {} };
      },
    });

    await assert.rejects(
      () => orchestrator.start(task.id, "implementation"),
      /2 uncommitted changes \(src\/scratch\.ts, notes\.md\)\. Commit or stash them/,
    );

    const after = await store.get(task.id);
    assert.equal(codexRuns, 0, "no model may run for a checkout that cannot produce a candidate");
    assert.equal(after.attemptsByStage?.implement ?? 0, attemptsBefore, "no stage attempt was spent");
    assert.equal(after.status, "ready-for-implementation", "the task stays runnable once the tree is clean");
    assert.equal(after.activeRunKind, null);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

for (const scenario of [
  {
    name: "cancellation during qualification never launches a repair",
    limit: 2,
    failures: 1,
    calls: 1,
    status: "cancelled",
    cancel: true,
  },
  {
    name: "turning automatic repair off prevents the next retry",
    limit: 2,
    failures: 1,
    calls: 1,
    status: "failed",
    disable: true,
  },
  {
    name: "ownership failures do not trigger automatic repairs",
    limit: 2,
    failures: 1,
    calls: 1,
    status: "failed",
    ownership: true,
  },
  {
    name: "repairs a failed check and integrates only the corrected package",
    limit: 2,
    failures: 1,
    calls: 2,
    status: "ready-for-review",
  },
  {
    name: "stops at the configured package repair limit",
    limit: 2,
    failures: 9,
    calls: 3,
    status: "failed",
    manualContinuation: true,
  },
  {
    name: "manual repair mode does not dispatch a package retry",
    limit: 2,
    failures: 1,
    calls: 1,
    status: "failed",
    manual: true,
  },
  { name: "zero disables package repairs", limit: 0, failures: 1, calls: 1, status: "failed" },
  {
    name: "does not retry a command that could not start",
    limit: 2,
    failures: 1,
    calls: 1,
    status: "failed",
    exitCode: null,
  },
  {
    name: "does not repair a repository baseline failure",
    limit: 2,
    failures: 1,
    calls: 1,
    status: "blocked",
    baseline: true,
  },
]) {
  test(scenario.name, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "harness-package-repair-"));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      await store.updateSettings((settings) => {
        settings.gatePolicies = { repair: scenario.manual ? "manual" : "auto-accept-recommendations" };
        settings.repairLimits = {
          package: scenario.limit,
          candidate: { fast: 1, standard: 2, "high-risk": 3 },
        };
      });
      const task = await store.create({
        title: scenario.name,
        description: "Correct failing checks without losing prior work.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-implementation";
        draft.currentStage = "implement";
        draft.workPackages = parseWorkPackages(
          '<work-packages>{"packages":[{"id":"S1","title":"Feature","description":"Implement feature.","dependencies":[],"ownedPaths":["feature.ts"],"verificationCommandIds":["test"]}]}</work-packages>',
        );
      });
      let manualContinuation = false;
      let preparations = 0;
      let commits = 0;
      let assemblies = 0;
      const prompts = [];
      const paths = [];
      const orchestrator = new TaskOrchestrator(store, {
        worktreeManager: {
          base: async () => ({ repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" }),
          prepare: async (_task, id) => {
            if (id.startsWith("S")) preparations++;
            return {
              id,
              revisionNumber: 1,
              baseRevision: "a".repeat(40),
              branch: "package",
              worktreePath: path.join(directory, "retained"),
              headRevision: null,
              revisions: [],
            };
          },
          inspectRetainedSlice: async (p) => ({
            worktreePath: p.worktreePath,
            headRevision: p.headRevision,
            clean: true,
            files: [],
          }),
          commit: async (slice) => {
            paths.push(slice.worktreePath);
            commits++;
            if (scenario.ownership) throw new Error("Candidate changed outside declared ownership");
            return {
              headRevision: String(commits).repeat(40),
              files: ["feature.ts"],
              summary: "change",
              diff: "+change",
              ownSummary: "change",
              ownDiff: "+change",
            };
          },
          assemble: async () => {
            assemblies++;
            return {
              headRevision: "f".repeat(40),
              files: ["feature.ts"],
              summary: "change",
              diff: "+change",
            };
          },
        },
        runCodex: async ({ prompt }) => {
          prompts.push(prompt);
          return {
            finalText: "## Outcome\nImplemented",
            usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
          };
        },
        runPackageVerification: async ({ workPackageId, attempt }) => {
          if (scenario.cancel) await orchestrator.cancel(task.id);
          if (scenario.disable)
            await store.updateSettings((settings) => {
              settings.gatePolicies.repair = "manual";
            });
          const status = !manualContinuation && attempt <= scenario.failures ? "failed" : "passed";
          const summary = makeFocusedTestSummary({
            candidateId: workPackageId,
            candidateRevision: attempt,
            status,
          });
          summary.headRevision = String(attempt).repeat(40);
          summary.rows[0].exitCode = status === "passed" ? 0 : "exitCode" in scenario ? scenario.exitCode : 1;
          summary.rows[0].failureDetails =
            status === "passed"
              ? null
              : "not ok 1 - API operator provenance\nexpected missing question; actual missing operator source";
          if (scenario.baseline) {
            summary.failureKind = "repository-baseline";
            summary.baselineVerification = { revision: "a".repeat(40), commandIds: ["test"] };
          }
          return summary;
        },
      });
      assert.equal(await orchestrator.start(task.id, "implementation"), true);
      const finished = await waitForStatus(store, task.id, scenario.status);
      await waitUntil(() => !orchestrator.isRunning(task.id), "package workflow to settle");
      assert.equal(prompts.length, scenario.calls);
      assert.equal(preparations, 1, "repairs reuse the retained worktree");
      assert.equal(new Set(paths).size, 1);
      assert.equal(finished.workPackages[0].automaticRepairAttempts ?? 0, scenario.calls - 1);
      assert.equal(
        finished.workPackages[0].verificationRuns?.length ?? 0,
        scenario.cancel || scenario.ownership ? 0 : scenario.calls,
      );
      assert.equal(assemblies, scenario.status === "ready-for-review" ? 1 : 0);
      if (scenario.calls > 1) {
        assert.match(prompts[1], /API operator provenance/);
        assert.match(prompts[1], /do not start over or discard/);
        assert.equal(finished.artifacts.filter((a) => a.workPackageId === "S1").length, scenario.calls);
        const reservation = finished.stageRunReservations.implement;
        const runs = finished.runs.filter((run) => run.workflowReservationId === reservation.id);
        assert.equal(validateRetryRunScopes(finished, reservation, runs), null);
        if (scenario.status === "ready-for-review") {
          const candidate = finished.candidates[0];
          assert.equal(validInitialCandidateProducer(finished, candidate, reservation), true);
          assert.ok(
            candidateRevisionProducerEvidence(finished, candidate, {
              byNumber: new Map(candidate.revisions.map((revision) => [revision.number, revision])),
            }),
          );
          const broken = structuredClone(runs);
          delete broken[1].packageRepairOfRunId;
          assert.equal(
            effectivePackageRuns(finished, broken),
            null,
            "duplicate calls require recorded repair lineage",
          );
          const noFailure = structuredClone(finished);
          noFailure.artifacts.find((artifact) => artifact.runId === runs[0].id).focusedTest.status = "passed";
          assert.equal(
            effectivePackageRuns(noFailure, runs),
            null,
            "a passing check cannot authorize a correction",
          );
        }
      }
      if (scenario.manualContinuation) {
        manualContinuation = true;
        assert.equal(await orchestrator.start(task.id, "implementation"), true);
        const recovered = await waitForStatus(store, task.id, "ready-for-review");
        await orchestrator.shutdown();
        const latest = recovered.runs.at(-1);
        assert.equal(latest.packageRepairOfRunId, undefined);
        assert.equal(recovered.workPackages[0].automaticRepairAttempts, scenario.limit);
        assert.equal(
          validInitialCandidateProducer(
            recovered,
            recovered.candidates[0],
            recovered.stageRunReservations.implement,
          ),
          true,
        );
      }
      await orchestrator.shutdown();
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
}

test("automatic repair preserves dependency commits and produces valid candidate lineage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "package-repair-git-"));
  try {
    await git(directory, ["init", "repository"]);
    const repository = path.join(directory, "repository");
    await git(repository, ["config", "user.name", "Harness test"]);
    await git(repository, ["config", "user.email", "harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n");
    await git(repository, ["add", "."]);
    await git(repository, ["commit", "-m", "base"]);
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    await store.updateSettings((settings) => {
      settings.gatePolicies = { repair: "auto-accept-recommendations" };
    });
    const task = await store.create({
      title: "Dependent package correction",
      description: "Keep earlier work while correcting a check.",
      repositoryPath: repository,
      workflow: "implement",
      workflowProfile: "standard",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = parseWorkPackages(
        '<work-packages>{"packages":[{"id":"S1","title":"Dependency","description":"Add dependency","dependencies":[],"ownedPaths":["dependency.txt"],"verificationCommandIds":["test"]},{"id":"S2","title":"Feature","description":"Use dependency","dependencies":["S1"],"ownedPaths":["feature.txt"],"verificationCommandIds":["test"]}]}</work-packages>',
      );
    });
    const manager = new GitWorktreeManager(path.join(directory, "w"));
    const calls = { S1: 0, S2: 0 };
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: manager,
      runCodex: async ({ prompt, cwd }) => {
        const id = prompt.includes("work package S1") ? "S1" : "S2";
        calls[id]++;
        if (id === "S2")
          assert.equal(await readFile(path.join(cwd, "dependency.txt"), "utf8"), "dependency\n");
        await writeFile(
          path.join(cwd, id === "S1" ? "dependency.txt" : "feature.txt"),
          id === "S1" ? "dependency\n" : calls.S2 === 1 ? "broken\n" : "fixed\n",
        );
        return {
          finalText: "## Outcome\nImplemented",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      runPackageVerification: async ({ workPackageId, attempt, worktreePath }) => {
        const contents = await readFile(path.join(worktreePath, "feature.txt"), "utf8").catch(() => "");
        const summary = makeFocusedTestSummary({
          candidateId: workPackageId,
          candidateRevision: attempt,
          status: contents === "broken\n" ? "failed" : "passed",
        });
        summary.rows[0].exitCode = summary.status === "failed" ? 1 : 0;
        summary.rows[0].failureDetails =
          summary.status === "failed" ? "Expected fixed, received broken" : null;
        return summary;
      },
    });
    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-review");
    await orchestrator.shutdown();
    assert.deepEqual(calls, { S1: 1, S2: 2 });
    const candidate = finished.candidates[0];
    assert.equal(await readFile(path.join(candidate.worktreePath, "feature.txt"), "utf8"), "fixed\n");
    assert.equal(await readFile(path.join(candidate.worktreePath, "dependency.txt"), "utf8"), "dependency\n");
    assert.deepEqual(finished.workPackages[1].files, ["feature.txt"]);
    assert.ok(
      candidateRevisionProducerEvidence(finished, candidate, {
        byNumber: new Map(candidate.revisions.map((revision) => [revision.number, revision])),
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
