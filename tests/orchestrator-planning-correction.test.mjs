import test from "node:test";
import {
  assert,
  JsonTaskStore,
  makeFocusedTestSummary,
  mkdtemp,
  os,
  PLAN_CRITIQUE_OUTPUT,
  path,
  rm,
  TaskOrchestrator,
  waitForStatus,
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
      runCodex: async ({ prompt }) => ({
        finalText: /<plan-critique>/.test(prompt) ? PLAN_CRITIQUE_OUTPUT : revisedOutput,
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
      ["implementation-plan.md", "implementation-plan-r2.md", "plan-critique-r2.md"],
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
      runCodex: async ({ prompt }) => ({
        finalText: /<plan-critique>/.test(prompt) ? PLAN_CRITIQUE_OUTPUT : revisedOutput,
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
      runCodex: async ({ prompt }) => ({
        finalText: /<plan-critique>/.test(prompt) ? PLAN_CRITIQUE_OUTPUT : revisedOutput,
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
