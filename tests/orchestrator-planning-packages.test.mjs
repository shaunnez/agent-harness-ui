import test from "node:test";
import {
  assert,
  escapeRegex,
  GRILL_OUTPUT,
  gateOutput,
  git,
  harnessEvidence,
  JsonTaskStore,
  makeFocusedTestSummary,
  mkdtemp,
  os,
  PLAN_OUTPUT,
  parseWorkPackages,
  path,
  refreshGateFreshness,
  rm,
  SCOUT_OUTPUT,
  TaskOrchestrator,
  TEST_OUTPUT,
  waitForStatus,
  writeFile,
} from "./orchestrator-test-support.mjs";

test("a revised plan retains the rejected plan artifact and replaces package scope", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-revise-plan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Revise plan",
      description: "Recover an unacceptable plan without erasing it.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = 1;
      draft.completedStages = ["triage", "scouts", "grill", "specification", "plan"];
      draft.workPackages = [
        {
          id: "S1",
          title: "Rejected scope",
          description: "Wrong plan.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["wrong/path.ts"],
          verification: [],
          status: "planned",
          attempts: 0,
        },
      ];
      draft.artifacts.push({
        id: "plan-r1",
        stage: "plan",
        name: "implementation-plan.md",
        kind: "markdown",
        content: "Rejected plan",
        createdAt: "2026-08-08T00:00:00.000Z",
      });
      draft.decisions.push({
        id: "decision-r2",
        question: "How must the plan change?",
        answer: "Use one package under src/correct.ts.",
        createdAt: "2026-08-08T00:01:00.000Z",
      });
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Correct scope","description":"One coherent package.","dependencies":[],"ownedPaths":["src/correct.ts"],"verificationCommandIds":["test"]}]}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: revisedOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "planning"), true);
    const revised = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(revised.attemptsByStage.plan, 2);
    assert.deepEqual(
      revised.workPackages.map((item) => item.ownedPaths),
      [["src/correct.ts"]],
    );
    assert.deepEqual(
      revised.artifacts.filter((artifact) => artifact.stage === "plan").map((artifact) => artifact.name),
      ["implementation-plan.md", "implementation-plan-r2.md"],
    );
    assert.equal(revised.artifacts.find((artifact) => artifact.id === "plan-r1").content, "Rejected plan");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrects a blocked legacy plan and preserves an exact clean slice for requalification", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-correct-blocked-plan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Correct blocked plan",
      description: "A persisted zero-command plan must return to read-only planning.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error = "S1: Focused package verification requires at least one repository manifest command id.";
      draft.attemptsByStage.plan = 1;
      draft.attemptsByStage.implement = 6;
      draft.stageRunLimits.implement = 6;
      draft.workPackages = [
        {
          id: "S1",
          title: "Browser contract",
          description: "Retain the exact committed browser change.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["e2e/example.spec.ts"],
          verification: [],
          verificationCommandIds: [],
          verificationRuns: [],
          status: "failed",
          attempts: 6,
          branch: "agent-harness/blocked-plan-s1-a6",
          worktreePath: "/tmp/blocked-plan-s1-a6",
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          files: ["e2e/example.spec.ts"],
          error: draft.error,
        },
      ];
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Browser contract","description":"Retain the exact committed browser change.","dependencies":[],"ownedPaths":["e2e/example.spec.ts"],"verificationCommandIds":["playwright-e2e"]}]}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "playwright-e2e", command: ["make", "e2e-native"] }],
      }),
      runCodex: async () => ({
        finalText: revisedOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.deepEqual(await orchestrator.correctInvalidPlan(task.id), { started: true });
    const revised = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(revised.stageRunLimits.implement, 7);
    assert.equal(revised.workPackages[0].retainedForRequalification, true);
    assert.equal(revised.workPackages[0].headRevision, "b".repeat(40));
    assert.deepEqual(revised.workPackages[0].verificationCommandIds, ["playwright-e2e"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("returns a failed package qualification to Plan and retains its commit for scoped continuation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-correct-qualification-plan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Correct qualification scope",
      description: "Add the contract test exposed by focused package verification.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.error = "S1 did not qualify: backend-test failed.";
      draft.attemptsByStage.plan = 1;
      draft.attemptsByStage.implement = 3;
      draft.workPackages = [
        {
          id: "S1",
          title: "Change route contract",
          description: "Implement the route change.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/route.ts"],
          verification: [],
          verificationCommandIds: ["test"],
          verificationRuns: [],
          status: "failed",
          attempts: 3,
          branch: "agent-harness/qualification-s1-a3",
          worktreePath: "/tmp/qualification-s1-a3",
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          files: ["src/route.ts"],
          error: draft.error,
        },
      ];
    });
    const revisedOutput = `<work-packages>{"packages":[{"id":"S1","title":"Change route contract","description":"Repair the route and its contract snapshot.","dependencies":[],"ownedPaths":["src","tests/contract.test.ts"],"verificationCommandIds":["test"]}]}</work-packages>`;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision: "c".repeat(40), baseBranch: "main" }),
        retainedPatchDisposition: async () => "pending",
      },
      runCodex: async () => ({
        finalText: revisedOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.deepEqual(await orchestrator.correctInvalidPlan(task.id), { started: true });
    const revised = await waitForStatus(store, task.id, "awaiting-plan-approval");
    assert.equal(revised.stageRunLimits.implement, 4);
    assert.equal(revised.workPackages[0].retainedForRequalification, false);
    assert.match(revised.workPackages[0].retainedContinuation.qualificationFailure, /did not qualify/);
    assert.deepEqual(revised.workPackages[0].ownedPaths, ["src", "tests/contract.test.ts"]);
    assert.equal(revised.workPackages[0].headRevision, "b".repeat(40));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requalifies an exact clean retained slice without rerunning model implementation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-requalify-retained-slice-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Requalify retained slice",
      description: "Use the corrected manifest against the exact clean package commit.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const baseRevision = "a".repeat(40);
    const packageRevision = "b".repeat(40);
    const candidateRevision = "c".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-implementation";
      draft.currentStage = "implement";
      draft.workPackages = [
        {
          id: "S1",
          title: "Browser contract",
          description: "Requalify the exact retained browser change.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["e2e/example.spec.ts"],
          verification: [],
          verificationCommandIds: ["playwright-e2e"],
          verificationRuns: [],
          status: "planned",
          attempts: 6,
          branch: "agent-harness/requalify-s1-a6",
          worktreePath: "/tmp/requalify-s1-a6",
          baseRevision,
          headRevision: packageRevision,
          files: ["e2e/example.spec.ts"],
          error: null,
          retainedForRequalification: true,
        },
      ];
    });
    let modelCalls = 0;
    const qualification = {
      ...makeFocusedTestSummary({ candidateId: "S1", candidateRevision: 6 }),
      headRevision: packageRevision,
      executionKind: "focused-package",
    };
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "playwright-e2e", command: ["make", "e2e-native"] }],
      }),
      runCodex: async () => {
        modelCalls += 1;
        throw new Error("Model implementation must not rerun for exact retained requalification.");
      },
      runPackageVerification: async () => qualification,
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision, baseBranch: "main" }),
        inspectRetainedSlice: async () => ({
          branch: "agent-harness/requalify-s1-a6",
          files: ["e2e/example.spec.ts"],
          headRevision: packageRevision,
          worktreePath: "/tmp/requalify-s1-a6",
          clean: true,
        }),
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
          files: ["e2e/example.spec.ts"],
          summary: "1 file changed",
          diff: "",
        }),
      },
    });

    assert.equal(await orchestrator.start(task.id, "implementation"), true);
    const ready = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(modelCalls, 0);
    assert.equal(ready.workPackages[0].status, "integrated");
    const retainedRun = ready.runs.find((run) => run.source === "harness-requalification");
    assert.equal(retainedRun.status, "completed");
    assert.equal(ready.artifacts.find((artifact) => artifact.runId === retainedRun.id).model, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a plan parse failure retains the exact failed attempt without replacing prior scope", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-invalid-plan-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Retain failed plan",
      description: "Keep the model output when structured plan parsing fails.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "failed";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = 1;
      draft.workPackages = [
        {
          id: "S1",
          title: "Prior scope",
          description: "Retained plan.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/prior.ts"],
          verification: [],
          status: "planned",
          attempts: 0,
        },
      ];
      draft.artifacts.push({
        id: "plan-r1",
        stage: "plan",
        name: "implementation-plan.md",
        kind: "markdown",
        content: "Prior plan",
        createdAt: "2026-08-08T00:00:00.000Z",
      });
    });
    const invalidOutput = "<work-packages>not-json</work-packages>";
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: invalidOutput,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "planning"), true);
    const failed = await waitForStatus(store, task.id, "failed");
    assert.equal(failed.attemptsByStage.plan, 2);
    assert.deepEqual(
      failed.workPackages.map((item) => item.ownedPaths),
      [["src/prior.ts"]],
    );
    const planArtifacts = failed.artifacts.filter((artifact) => artifact.stage === "plan");
    assert.deepEqual(
      planArtifacts.map((artifact) => artifact.name),
      ["implementation-plan.md", "implementation-plan-r2-invalid.md"],
    );
    assert.equal(planArtifacts.at(-1).content, invalidOutput);
    assert.equal(failed.runs.at(-1).artifactId, planArtifacts.at(-1).id);
    assert.match(failed.error, /work-packages JSON block was invalid/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

test("advances an approved implementation task through a revision-bound candidate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-candidate-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Ship a small change",
      description: "Implement and verify the approved change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    let merged = false;
    let commitCount = 0;
    let candidateNeedsRecovery = false;
    let recoveryCount = 0;
    let repairCount = 0;
    let reviewCount = 0;
    let verifyCount = 0;
    let originalAuthorizerContent = null;
    const runtimeCalls = [];
    const worktreeManager = {
      async base() {
        return { repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" };
      },
      async prepare(_task, candidateId) {
        return {
          id: candidateId,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: "agent-harness/test-c1",
          repositoryRoot: directory,
          worktreePath: path.join(directory, candidateId),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        };
      },
      async commit(candidate) {
        commitCount += 1;
        if (candidate.id === "C1" && repairCount === 1) {
          await store.update(task.id, (draft) => {
            const authorizerId = draft.stageRunReservations.implement.authorizingGateArtifactId;
            const authorizer = draft.artifacts.find((artifact) => artifact.id === authorizerId);
            originalAuthorizerContent = authorizer.content;
            authorizer.content = "";
          });
          candidateNeedsRecovery = true;
        }
        return {
          headRevision: (candidate.id === "S1-A1" ? "s" : candidate.id === "S2-A1" ? "t" : "c").repeat(40),
          files: ["src/change.ts"],
          summary: "1 file changed",
          diff: "+change",
          ownSummary: "1 file changed",
          ownDiff: "+change",
        };
      },
      async assemble() {
        return {
          headRevision: "b".repeat(40),
          files: ["src/change.ts"],
          summary: "1 file changed",
          diff: "+change",
        };
      },
      async merge() {
        merged = true;
      },
      async verifyCandidate() {
        verifyCount += 1;
        return true;
      },
      async recoverCandidate() {
        if (!candidateNeedsRecovery) return false;
        candidateNeedsRecovery = false;
        recoveryCount += 1;
        return true;
      },
    };
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [
          { id: "test", command: ["npm", "test"] },
          { id: "typecheck", command: ["npm", "run", "typecheck"] },
        ],
      }),
      // The harness executes verification now, so this flow supplies the observation through the
      // same seam as runCodex (#47). Bound to a *fixed* C1 revision 2 rather than to whatever
      // the candidate currently is, exactly as the model-authored TEST_OUTPUT it replaces was:
      // the point of this flow is that evidence for an older revision must not clear a newer
      // candidate, and binding to the live candidate would erase the scenario.
      runVerification: async () => {
        // Two rows, because this flow asserts what the persisted artifact carries and the
        // model-authored TEST_OUTPUT it replaces described two commands.
        const base = harnessEvidence({ id: "C1", revisionNumber: 2, headRevision: "b".repeat(40) });
        return {
          ...base,
          rows: [
            base.rows[0],
            {
              ...base.rows[0],
              id: "test-api",
              title: "api.test.mjs",
              command: "npm run test:api",
              durationMs: 350,
            },
          ],
          executedCommandIds: ["test", "test-api"],
          declaredCommandIds: ["test", "test-api"],
        };
      },
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager,
      runCodex: async (options) => {
        const { prompt } = options;
        runtimeCalls.push(options);
        options.onEvent?.({
          type: "activity",
          tone: "success",
          title: "Repository command completed",
          detail: "npm.cmd test",
          commandFailed: false,
          toolCall: {
            id: `cmd-${runtimeCalls.length}`,
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 0",
          },
        });
        if (/You are the candidate Repair agent/.test(prompt)) {
          repairCount += 1;
        }
        let finalText = "## Outcome\n\nReady";
        if (/<scout-report>/.test(prompt)) finalText = SCOUT_OUTPUT;
        if (/<grill-questions>/.test(prompt)) finalText = GRILL_OUTPUT;
        if (/<work-packages>/.test(prompt)) finalText = PLAN_OUTPUT;
        if (/Development review/.test(prompt)) {
          reviewCount += 1;
          finalText =
            reviewCount === 1
              ? gateOutput(1, "REPAIR", [
                  {
                    severity: "P1",
                    title: "Repair required",
                    detail: "Fix the candidate.",
                    candidateId: "C1",
                    candidateRevision: 1,
                  },
                ])
              : gateOutput(2);
        } else if (/Focused test/.test(prompt)) {
          finalText = TEST_OUTPUT;
        } else if (/Final review/.test(prompt)) {
          finalText = gateOutput(2);
        }
        return {
          finalText,
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    await orchestrator.start(task.id);
    await waitForStatus(store, task.id, "awaiting-grill");
    await orchestrator.answerGrillQuestion(task.id, {
      questionId: "Q1",
      answer: "Keep it backwards compatible.",
      source: "operator",
    });
    await orchestrator.finishGrill(task.id, { source: "operator" });
    await waitForStatus(store, task.id, "awaiting-spec-approval");
    await orchestrator.approveSpecification(task.id);
    await waitForStatus(store, task.id, "awaiting-plan-approval");
    await orchestrator.approvePlan(task.id);
    assert.equal((await store.get(task.id)).status, "ready-for-implementation");

    await orchestrator.start(task.id, "implementation");
    await waitForStatus(store, task.id, "ready-for-review");
    await orchestrator.start(task.id, "review");
    const repairReady = await waitForStatus(store, task.id, "repair-required");
    assert.equal(repairReady.gateFreshness["dev-review"].reasonCode, "repair_required");
    assert.ok(repairReady.gateFreshness["dev-review"].sourceRunId);
    assert.ok(repairReady.gateFreshness["dev-review"].sourceArtifactId);
    await orchestrator.start(task.id, "repair");
    const driftedRepair = await waitForStatus(store, task.id, "failed");
    assert.equal(driftedRepair.currentStage, "implement");
    assert.equal(driftedRepair.candidates[0].revisionNumber, 1);
    assert.equal(commitCount, 3, "the probe mutates authority only after the first Repair commit");
    assert.equal(recoveryCount, 1, "a rejected post-commit Repair must recover the recorded candidate head");
    assert.match(driftedRepair.error, /authorizing gate/i);
    assert.match(
      driftedRepair.stageRunReservations.implement.authorizingGateSnapshotDigest,
      /^[0-9a-f]{64}$/,
    );
    await store.update(task.id, (draft) => {
      const authorizerId = draft.stageRunReservations.implement.authorizingGateArtifactId;
      draft.artifacts.find((artifact) => artifact.id === authorizerId).content = originalAuthorizerContent;
      refreshGateFreshness(draft);
    });
    assert.equal(await orchestrator.start(task.id, "repair"), true);
    await waitForStatus(store, task.id, "ready-for-review");
    await orchestrator.start(task.id, "review");
    await waitForStatus(store, task.id, "ready-for-test");
    await orchestrator.start(task.id, "test");
    await waitForStatus(store, task.id, "ready-for-final-review");
    await orchestrator.start(task.id, "final-review");
    const approvalTask = await waitForStatus(store, task.id, "awaiting-human-approval");

    assert.equal(approvalTask.candidates[0].headRevision, "c".repeat(40));
    assert.equal(approvalTask.candidates[0].revisionNumber, 2);
    assert.deepEqual(
      approvalTask.candidates[0].revisions.map((revision) => revision.headRevision),
      ["b".repeat(40), "c".repeat(40)],
    );
    assert.equal(approvalTask.decisions.length, 1);
    assert.deepEqual(
      approvalTask.workPackages.map((item) => item.status),
      ["integrated", "integrated"],
    );
    assert.deepEqual(
      approvalTask.candidates[0].members.map((member) => member.packageId),
      ["S1", "S2"],
    );
    assert.equal(approvalTask.artifacts.length, 16);
    assert.equal(
      approvalTask.artifacts.filter(
        (artifact) => artifact.stage === "implement" && artifact.candidateRevision === 2,
      ).length,
      2,
      "the rejected post-commit Repair remains retained audit evidence beside the successful retry",
    );
    const testCall = runtimeCalls.find((call) => /Focused test/.test(call.prompt));
    // Inverted deliberately, and this assertion is the change in #47 rather than a casualty of
    // it. The test agent used to need workspace-write and loopback access because it ran the
    // verification commands itself; the harness runs them now, so the agent only reads the
    // worktree to interpret results. No stage grants network access any more, which is exactly
    // what made this stage impossible on Claude (#40) and dependent on Codex credits.
    assert.equal(testCall.sandbox, "read-only");
    assert.equal(
      testCall.networkAccess,
      false,
      "the test agent no longer runs commands, so it needs no loopback access",
    );
    assert.equal(runtimeCalls.find((call) => /Development review/.test(call.prompt)).networkAccess, false);
    // Read-only stages get the shorter budget; the long one existed for running suites.
    assert.equal(testCall.timeoutMs, 360_000);
    assert.match(
      testCall.tempDirectory,
      new RegExp(`^${escapeRegex(path.join(os.tmpdir(), "agent-harness", task.id))}`),
    );
    assert.equal(testCall.tempDirectory.startsWith(path.join(directory, "C1")), false);
    assert.equal(
      verifyCount,
      10,
      "test and both Repair attempts verify at their boundaries (7), plus a post-run check for each read-only review stage: two dev-reviews and one final-review",
    );
    assert.equal(
      approvalTask.artifacts.find((artifact) => artifact.stage === "test")?.focusedTest?.rows?.length,
      2,
    );
    assert.equal(
      approvalTask.artifacts.find((artifact) => artifact.stage === "test")?.focusedTest?.rows?.[1].status,
      "passed",
    );
    assert.equal(
      approvalTask.artifacts.find((artifact) => artifact.stage === "test")?.focusedTest?.rows?.[1]
        .candidateRevision,
      2,
    );
    const reviewRuns = approvalTask.runs.filter((run) => run.stage === "dev-review");
    const repairRevision = approvalTask.candidates[0].revisions[1];
    const repairRun = approvalTask.runs.find(
      (run) =>
        run.kind === "repair" && run.workflowReservationId === repairRevision.sourceWorkflowReservationId,
    );
    const repairArtifact = approvalTask.artifacts.find((artifact) => artifact.runId === repairRun.id);
    const repairAuthorizerArtifact = approvalTask.artifacts.find(
      (artifact) => artifact.runId === reviewRuns[0].id,
    );
    const testRun = approvalTask.runs.find((run) => run.stage === "test");
    assert.equal(reviewRuns.length, 2);
    assert.equal(
      repairRevision.sourceWorkflowReservedAt,
      approvalTask.stageRunReservations.implement.reservedAt,
    );
    assert.equal(repairRevision.authorizingGateStage, "dev-review");
    assert.equal(repairRevision.authorizingGateReservationId, reviewRuns[0].workflowReservationId);
    assert.equal(repairRevision.authorizingGateRunId, reviewRuns[0].id);
    assert.equal(repairRevision.authorizingGateArtifactId, repairAuthorizerArtifact.id);
    assert.match(approvalTask.stageRunReservations.implement.authorizingGateSnapshotDigest, /^[0-9a-f]{64}$/);
    assert.ok(
      Date.parse(repairAuthorizerArtifact.createdAt) < Date.parse(repairRevision.sourceWorkflowReservedAt),
    );
    assert.ok(Date.parse(repairRevision.sourceWorkflowReservedAt) <= Date.parse(repairRun.startedAt));
    assert.ok(Date.parse(repairRun.completedAt) <= Date.parse(repairArtifact.createdAt));
    assert.ok(Date.parse(repairArtifact.createdAt) <= Date.parse(repairRevision.createdAt));
    assert.deepEqual(reviewRuns[1].gateResult.blockingReasons, []);
    assert.equal(reviewRuns[1].retryOfRunId, reviewRuns[0].id);
    assert.equal(repairRun.repairOfRunId, reviewRuns[0].id);
    assert.equal(testRun.test.rowCount, 2);
    assert.equal(testRun.toolCalls[0].name, "command_execution");
    assert.equal(testRun.artifactId, approvalTask.artifacts.find((artifact) => artifact.stage === "test").id);
    assert.equal(approvalTask.artifacts.find((artifact) => artifact.stage === "test").runId, testRun.id);
    assert.equal(
      approvalTask.runs.every((run) => run.status === "completed"),
      true,
    );
    assert.deepEqual(approvalTask.activeRunIds, []);
    for (const stage of ["dev-review", "test", "final-review"]) {
      const passEvent = approvalTask.events.find(
        (event) => event.stage === stage && event.title.endsWith(" passed"),
      );
      assert.equal(
        passEvent.runId,
        approvalTask.gateFreshness[stage].sourceRunId,
        `${stage} pass event links its authoritative run`,
      );
      assert.equal(passEvent.freshness.fresh, true, `${stage} pass event carries authoritative freshness`);
    }
    await orchestrator.approveMerge(task.id);
    const merged1 = await store.get(task.id);
    assert.equal(merged1.status, "merged-to-target");
    assert.equal(
      merged1.completedAt,
      null,
      "merging onto the target branch does not itself complete the task",
    );
    assert.equal(merged1.candidates[0].status, "merged");
    assert.equal(merged1.artifacts.length, 17);
    assert.equal(merged1.artifacts.at(-1).stage, "approval");
    assert.equal(merged1.artifacts.at(-1).candidateId, "C1");
    assert.equal(merged1.artifacts.at(-1).candidateRevision, 2);
    assert.match(merged1.artifacts.at(-1).content, /Merge method: fast-forward only/);
    assert.match(merged1.artifacts.at(-1).content, new RegExp(`Merged revision: ${"c".repeat(40)}`));
    assert.equal(merged1.mergeIntent.status, "completed");
    assert.equal(merged1.approvals.filter((approval) => approval.stage === "approval").length, 1);
    await assert.rejects(() => orchestrator.approveMerge(task.id), /not awaiting merge approval/i);
    assert.equal(merged, true);

    for (const kind of ["review", "test", "final-review", "implementation"]) {
      assert.equal(
        await orchestrator.start(task.id, kind),
        false,
        `${kind} must not start once the task is merged-to-target`,
      );
    }
    await assert.rejects(() => orchestrator.completeMergedTask("AH-missing"), /Task not found/i);

    await orchestrator.completeMergedTask(task.id, "Promoted to the shared integration branch.");
    const complete = await store.get(task.id);
    assert.equal(complete.status, "completed");
    assert.ok(complete.completedAt);
    assert.equal(complete.candidates[0].status, "merged");
    const promotion = complete.approvals.find((approval) => approval.stage === "promotion");
    assert.ok(promotion, "promoting to completed records a persisted decision");
    assert.equal(promotion.note, "Promoted to the shared integration branch.");
    await assert.rejects(() => orchestrator.completeMergedTask(task.id), /not merged to its target branch/i);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
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
    assert.match(restarted.events.at(-1).detail, /bbbbbbbb/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("continues a timed-out retained package without discarding progress or incrementing its package attempt", async () => {
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
      draft.error = "S1: Codex run exceeded 900 seconds.";
      draft.attemptsByStage.implement = 4;
      draft.stageRunLimits.implement = 4;
      draft.workPackages = [
        {
          id: "S1",
          title: "Retained implementation",
          description: "Finish the retained package.",
          dependencies: [],
          batch: 1,
          ownedPaths: ["src/feature.ts"],
          verification: [],
          verificationCommandIds: ["test"],
          verificationRuns: [],
          status: "failed",
          attempts: 4,
          branch: "agent-harness/retained-s1-a4",
          worktreePath: "/tmp/retained-s1-a4",
          baseRevision,
          headRevision: null,
          files: [],
          error: "Codex run exceeded 900 seconds.",
        },
      ];
    });
    let request = null;
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      runCodex: async (input) => {
        request = input;
        return {
          finalText:
            "## Outcome\nDone\n## Changes\nScoped\n## Verification\nFocused\n## Ownership exceptions\nNone\n## Remaining risks\nNone",
          model: "gpt-5.6-sol",
          reasoning: "xhigh",
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
        };
      },
      runPackageVerification: async () => makeFocusedTestSummary({ candidateId: "S1", candidateRevision: 4 }),
      worktreeManager: {
        base: async () => ({ repositoryRoot: directory, baseRevision, baseBranch: "main" }),
        inspectRetainedSlice: async () => ({
          branch: "agent-harness/retained-s1-a4",
          files: ["src/feature.ts", "src/outside.ts"],
          headRevision: baseRevision,
          worktreePath: "/tmp/retained-s1-a4",
          clean: false,
        }),
        commit: async () => ({
          headRevision: packageRevision,
          files: ["src/feature.ts"],
          summary: "1 file changed",
          ownSummary: "1 file changed",
          noChangesNeeded: false,
        }),
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
    const ready = await waitForStatus(store, task.id, "ready-for-review");
    assert.equal(ready.workPackages[0].attempts, 4);
    assert.equal(ready.stageRunLimits.implement, 5);
    assert.equal(request.timeoutMs, 1_800_000);
    assert.match(request.prompt, /restore every retained path outside declared ownership: src\/outside\.ts/i);
    assert.equal(ready.candidates[0].baseRevision, baseRevision);
    assert.equal(ready.candidates[0].headRevision, candidateRevision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
