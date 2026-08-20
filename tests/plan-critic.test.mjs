import test from "node:test";
import { parsePlanCritique } from "../server/structured-output.mjs";
import {
  assert,
  JsonTaskStore,
  mkdtemp,
  os,
  PLAN_CRITIQUE_OUTPUT,
  PLAN_CRITIQUE_REVISE_OUTPUT,
  path,
  rm,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

const PLAN_OUTPUT = `<work-packages>{"packages":[{"id":"S1","title":"Scope","description":"One coherent package.","dependencies":[],"ownedPaths":["src/correct.ts"],"verificationCommandIds":["test"]}]}</work-packages>`;

async function planningTask(directory, { profile = "standard" } = {}) {
  const store = new JsonTaskStore(path.join(directory, "tasks.json"));
  await store.init();
  const task = await store.create({
    title: "Plan a change",
    description: "Produce an implementation plan for the approved specification.",
    repositoryPath: directory,
    workflow: "implement",
    priority: "medium",
  });
  await store.update(task.id, (draft) => {
    draft.status = "awaiting-plan-approval";
    draft.currentStage = "plan";
    draft.attemptsByStage.plan = 0;
    draft.completedStages = ["triage", "scouts", "synthesis", "grill", "specification"];
    draft.workflowProfile = { selected: profile, reason: "test", source: "test", history: [] };
    draft.artifacts.push({
      id: "spec-1",
      stage: "specification",
      name: "task-specification.md",
      kind: "markdown",
      content: "## Acceptance criteria\n\n1. Delegated connections appear.\n2. Owners keep access.",
      createdAt: "2026-08-08T00:00:00.000Z",
    });
  });
  return { store, task };
}

function orchestratorFor(store, critiqueOutput) {
  const prompts = [];
  return {
    prompts,
    orchestrator: new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async ({ prompt }) => {
        prompts.push(prompt);
        return {
          finalText: /<plan-critique>/.test(prompt) ? critiqueOutput : PLAN_OUTPUT,
          model: "gpt-5.6-sol",
          reasoning: "high",
          usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
        };
      },
    }),
  };
}

test("a passing critique lets the plan reach approval and retains the critique alongside it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-plan-critic-pass-"));
  try {
    const { store, task } = await planningTask(directory);
    const { orchestrator, prompts } = orchestratorFor(store, PLAN_CRITIQUE_OUTPUT);
    assert.equal(await orchestrator.start(task.id, "planning"), true);
    const done = await waitForStatus(store, task.id, "awaiting-plan-approval");

    assert.deepEqual(
      done.artifacts.filter((item) => item.stage === "plan").map((item) => item.name),
      ["implementation-plan.md", "plan-critique.md"],
    );
    assert.equal(done.planCritique.verdict, "PASS");
    assert.equal(done.planCritique.blocking.length, 0);
    assert.equal(done.planCritique.advisory.length, 1, "advisory notes are retained without gating");
    assert.equal(
      done.workPackages.map((item) => item.id).join(","),
      "S1",
      "a passing critique leaves the plan exactly as written",
    );

    // Fresh context: the critic reads the specification and the plan, never its own prior output.
    const critiquePrompt = prompts.find((prompt) => /<plan-critique>/.test(prompt));
    assert.match(critiquePrompt, /task-specification\.md/);
    assert.match(critiquePrompt, /implementation-plan\.md/);
    assert.match(critiquePrompt, /Work read-only/);
    assert.doesNotMatch(critiquePrompt, /plan-critique\.md/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a cited blocking finding stops the plan becoming approvable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-plan-critic-revise-"));
  try {
    const { store, task } = await planningTask(directory);
    const { orchestrator } = orchestratorFor(store, PLAN_CRITIQUE_REVISE_OUTPUT);
    assert.equal(await orchestrator.start(task.id, "planning"), true);
    const blocked = await waitForStatus(store, task.id, "failed");

    assert.equal(blocked.planCritique.verdict, "REVISE");
    assert.match(blocked.error, /acceptance-coverage/);
    assert.match(blocked.error, /No work package covers the second acceptance criterion/);
    assert.notEqual(
      blocked.status,
      "awaiting-plan-approval",
      "a plan with a cited defect must not be one click from spending implementation tokens",
    );
    // AH-034: "blocked" left the task with no way back to planning, so the revise loop was a dead
    // end. "failed" is retryable through the existing plan action.
    assert.equal(blocked.status, "failed");
    assert.equal(
      blocked.workPackages.length,
      1,
      "the rejected plan is retained rather than discarded, so the revision can see it",
    );
    assert.equal(
      blocked.artifacts.some((item) => item.name === "plan-critique.md"),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the fast profile skips the critic and records the skip", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-plan-critic-fast-"));
  try {
    const { store, task } = await planningTask(directory, { profile: "fast" });
    const { orchestrator, prompts } = orchestratorFor(store, PLAN_CRITIQUE_REVISE_OUTPUT);
    assert.equal(await orchestrator.start(task.id, "planning"), true);
    const done = await waitForStatus(store, task.id, "awaiting-plan-approval");

    assert.equal(
      prompts.some((prompt) => /<plan-critique>/.test(prompt)),
      false,
      "no critic model call on the fast path",
    );
    assert.equal(done.planCritique, null);
    assert.equal(done.stageDispositions["plan-review"].status, "not-required");
    assert.deepEqual(
      done.topologyTrace.nodesSkipped.map((entry) => entry.node),
      ["plan-review"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the critic records its own execution as a node and its edge from the plan", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-plan-critic-trace-"));
  try {
    const { store, task } = await planningTask(directory);
    const { orchestrator } = orchestratorFor(store, PLAN_CRITIQUE_OUTPUT);
    await orchestrator.start(task.id, "planning");
    const done = await waitForStatus(store, task.id, "awaiting-plan-approval");
    // AH-030, the first live run, recorded only the five stages that called recordNodeExecuted
    // directly: `plan` and `specification` were silently absent. Both halves matter — the stage
    // that ran and the critic that read it.
    assert.ok(
      done.topologyTrace.nodesExecuted.includes("plan"),
      "the plan stage itself must appear in the trace, not only its critic",
    );
    assert.ok(done.topologyTrace.nodesExecuted.includes("plan-review"));
    assert.deepEqual(done.topologyTrace.edgesTaken.at(-1), {
      from: "plan",
      to: "plan-review",
      kind: "advance",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("taste cannot block, structurally: an uncited aesthetic objection is refused as blocking", () => {
  const taste = `<plan-critique>${JSON.stringify({
    verdict: "REVISE",
    blocking: [{ dimension: "scope", claim: "I would have split this differently.", evidence: [] }],
    advisory: [],
  })}</plan-critique>`;
  assert.throws(() => parsePlanCritique(taste), /evidence must list at least 1 entry/);

  const offDimension = `<plan-critique>${JSON.stringify({
    verdict: "REVISE",
    blocking: [{ dimension: "elegance", claim: "The naming is inconsistent.", evidence: ["plan.md"] }],
    advisory: [],
  })}</plan-critique>`;
  assert.throws(() => parsePlanCritique(offDimension), /not a plan defect/);
});
