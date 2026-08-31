import test from "node:test";
import assert from "node:assert/strict";
import { createTaskActionRoutes } from "../server/task-action-routes.mjs";
import {
  applyTaskRolePolicy,
  resolveGatePromotionEligibility,
  resolveRolePolicyEligibility,
  updateTaskRolePolicy,
} from "../server/companion-actions.mjs";

const modelCatalog = {
  models: [
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", editable: true, reasoningLevels: ["medium", "high"] },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", editable: true, reasoningLevels: ["high", "xhigh"] },
  ],
};

const settings = {
  allowedModels: ["gpt-5.6-luna", "gpt-5.6-sol"],
  defaultModel: "gpt-5.6-luna",
  defaultReasoning: "medium",
};

function taskFixture(overrides = {}) {
  const stagePolicies = {
    triage: { model: "gpt-5.6-luna", reasoning: "medium" },
    scouts: { model: "gpt-5.6-luna", reasoning: "medium" },
    grill: { model: "gpt-5.6-luna", reasoning: "medium" },
    specification: { model: "gpt-5.6-luna", reasoning: "medium" },
    plan: { model: "gpt-5.6-luna", reasoning: "medium" },
    implement: { model: "gpt-5.6-luna", reasoning: "medium" },
    repair: { model: "gpt-5.6-luna", reasoning: "medium" },
    "dev-review": { model: "gpt-5.6-luna", reasoning: "medium" },
    test: { model: "gpt-5.6-luna", reasoning: "medium" },
    "final-review": { model: "gpt-5.6-luna", reasoning: "medium" },
  };
  return {
    id: "AH-001",
    status: "queued",
    currentStage: "triage",
    workflow: "implement",
    activeRunKind: null,
    activeRunReservationId: null,
    activeRunIds: [],
    attemptsByStage: {},
    stageRunLimits: { "dev-review": 3, test: 3, "final-review": 3 },
    repositoryAuthorityStatus: "bound",
    repositoryAuthority: {
      id: "authority-1",
      selectedRevision: "a".repeat(40),
      targetRef: "refs/heads/main",
      capturedAt: "2026-08-31T00:00:00.000Z",
      upstreamRef: null,
      remoteVerification: { status: "not-configured", error: null },
    },
    agentConfig: {
      model: "gpt-5.6-luna",
      reasoning: "medium",
      stagePolicies,
    },
    runs: [],
    artifacts: [],
    candidates: [],
    ...overrides,
  };
}

function candidateFixture(overrides = {}) {
  return {
    id: "C1",
    revisionNumber: 1,
    headRevision: "b".repeat(40),
    baseRevision: "a".repeat(40),
    status: "ready_for_review",
    ...overrides,
  };
}

function readyForReviewTask(overrides = {}) {
  return taskFixture({
    status: "ready-for-review",
    currentStage: "dev-review",
    candidates: [candidateFixture()],
    ...overrides,
  });
}

function memoryStore(task, { beforeTransition = null } = {}) {
  const current = structuredClone(task);
  const globalSettings = structuredClone(settings);
  let transitionHook = beforeTransition;
  return {
    async get(id) {
      return current.id === id ? structuredClone(current) : null;
    },
    async settings() {
      return structuredClone(globalSettings);
    },
    async transition(id, condition, updater) {
      if (current.id !== id) return null;
      if (transitionHook) {
        const hook = transitionHook;
        transitionHook = null;
        await hook(current);
      }
      if (!condition(current)) {
        const error = new Error("Task state changed before the requested action could be reserved.");
        error.code = "TASK_TRANSITION_CONFLICT";
        throw error;
      }
      updater(current);
      return structuredClone(current);
    },
    async update(id, updater) {
      if (current.id !== id) return null;
      updater(current);
      return structuredClone(current);
    },
    read() {
      return structuredClone(current);
    },
    settingsRead() {
      return structuredClone(globalSettings);
    },
  };
}

function routeHarness(store, { mutateBeforeReservation = false, approvePullRequest = null } = {}) {
  let sent = null;
  let started = null;
  let approved = null;
  const orchestrator = {
    async approvePullRequest(id, note, expectedCandidate) {
      approved = { id, note, expectedCandidate };
      return approvePullRequest?.({ id, note, expectedCandidate });
    },
    async start(id, kind, options = {}) {
      started = { id, kind };
      if (mutateBeforeReservation) {
        await store.update(id, (draft) => {
          draft.candidates.at(-1).revisionNumber = 2;
        });
      }
      return options.canStart ? options.canStart(store.read()) : true;
    },
    isRunning: () => false,
  };
  const handler = createTaskActionRoutes({
    store,
    orchestrator,
    send: (_response, status, body) => {
      sent = { status, body };
    },
    readJson: async (request) => request.body,
    readModelCatalog: async () => modelCatalog,
  });
  return {
    async invoke(path, method, body) {
      sent = null;
      await handler({ method, body }, {}, new URL(`http://127.0.0.1${path}`));
      return sent;
    },
    started: () => started,
    approved: () => approved,
  };
}

test("task role policy eligibility accepts only an allowed discovered policy", () => {
  const task = taskFixture();
  const result = resolveRolePolicyEligibility(
    task,
    { role: "implement", model: "gpt-5.6-sol", reasoning: "high" },
    settings,
    modelCatalog,
  );
  assert.deepEqual(result.policy, { model: "gpt-5.6-sol", reasoning: "high" });
  assert.equal(result.role, "implement");
  assert.equal(result.ok, true);
});

test("task role policy mutation is isolated from global settings and historical runs", async () => {
  const task = taskFixture({
    runs: [{ id: "historical", model: "gpt-5.6-luna", reasoning: "medium", status: "completed" }],
  });
  const store = memoryStore(task);
  const result = await updateTaskRolePolicy({
    store,
    taskId: task.id,
    input: { role: "implement", model: "gpt-5.6-sol", reasoning: "high" },
    catalog: modelCatalog,
  });
  assert.equal(result.ok, true);
  const after = store.read();
  assert.deepEqual(after.agentConfig.stagePolicies.implement, {
    model: "gpt-5.6-sol",
    reasoning: "high",
  });
  assert.equal(after.agentConfig.model, task.agentConfig.model);
  assert.deepEqual(after.runs, task.runs);
  assert.deepEqual(store.settingsRead(), settings);
});

test("task role policy rejects a task without repository authority", async () => {
  const task = taskFixture({ repositoryAuthorityStatus: "legacy-unbound", repositoryAuthority: null });
  const store = memoryStore(task);
  const result = await updateTaskRolePolicy({
    store,
    taskId: task.id,
    input: { role: "implement", model: "gpt-5.6-sol", reasoning: "high" },
    catalog: modelCatalog,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "repository-authority");
  assert.deepEqual(
    store.read().agentConfig.stagePolicies.implement,
    task.agentConfig.stagePolicies.implement,
  );
});

test("task role policy revalidates repository authority inside its transition", async () => {
  const task = taskFixture();
  const store = memoryStore(task, {
    beforeTransition(current) {
      current.repositoryAuthorityStatus = "legacy-unbound";
    },
  });
  const result = await updateTaskRolePolicy({
    store,
    taskId: task.id,
    input: { role: "implement", model: "gpt-5.6-sol", reasoning: "high" },
    catalog: modelCatalog,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "repository-authority");
  assert.deepEqual(
    store.read().agentConfig.stagePolicies.implement,
    task.agentConfig.stagePolicies.implement,
  );
});

test("role policy route rejects unknown fields and invalid model policy", async () => {
  const store = memoryStore(taskFixture());
  const route = routeHarness(store);
  const unknownField = await route.invoke("/api/tasks/AH-001/agent-policy", "PUT", {
    role: "implement",
    model: "gpt-5.6-sol",
    reasoning: "high",
    endpoint: "/unsafe",
  });
  assert.equal(unknownField.status, 400);
  assert.equal(unknownField.body.code, "invalid-policy");
  const invalid = await route.invoke("/api/tasks/AH-001/agent-policy", "PUT", {
    role: "implement",
    model: "gpt-9-unknown",
    reasoning: "high",
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "invalid-policy");
  assert.equal(store.read().agentConfig.stagePolicies.implement.model, "gpt-5.6-luna");

  const valid = await route.invoke("/api/tasks/AH-001/agent-policy", "PUT", {
    role: "implement",
    model: "gpt-5.6-sol",
    reasoning: "high",
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.scope, "task_snapshot");
  assert.deepEqual(valid.body.task.agentConfig.stagePolicies.implement, {
    model: "gpt-5.6-sol",
    reasoning: "high",
  });
});

test("gate promotion rejects stale candidate identity before invoking the orchestrator", async () => {
  const store = memoryStore(readyForReviewTask());
  const route = routeHarness(store);
  const result = await route.invoke("/api/tasks/AH-001/review", "POST", {
    candidateId: "C1",
    candidateRevision: 1,
    candidateHeadRevision: "c".repeat(40),
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "stale-candidate");
  assert.equal(route.started(), null);
});

test("gate promotion rejects unbound repository authority and ineligible gates", () => {
  const authorityResult = resolveGatePromotionEligibility(
    readyForReviewTask({ repositoryAuthorityStatus: "legacy-unbound" }),
    { action: "review", candidateId: "C1", candidateRevision: 1, candidateHeadRevision: "b".repeat(40) },
  );
  assert.equal(authorityResult.code, "repository-authority");

  const ineligibleResult = resolveGatePromotionEligibility(readyForReviewTask({ status: "blocked" }), {
    action: "review",
    candidateId: "C1",
    candidateRevision: 1,
    candidateHeadRevision: "b".repeat(40),
  });
  assert.equal(ineligibleResult.code, "ineligible");
});

test("gate promotion rejects candidate bases outside the bound repository revision", () => {
  const result = resolveGatePromotionEligibility(
    readyForReviewTask({ candidates: [candidateFixture({ baseRevision: "c".repeat(40) })] }),
    { action: "review", candidateId: "C1", candidateRevision: 1, candidateHeadRevision: "b".repeat(40) },
  );
  assert.equal(result.code, "repository-authority");
});

test("gate promotion delegates an eligible exact candidate to the existing action admission", async () => {
  const store = memoryStore(readyForReviewTask());
  const route = routeHarness(store);
  const result = await route.invoke("/api/tasks/AH-001/review", "POST", {
    candidateId: "C1",
    candidateRevision: 1,
    candidateHeadRevision: "b".repeat(40),
  });
  assert.equal(result.status, 202);
  assert.deepEqual(result.body, { started: true });
  assert.deepEqual(route.started(), { id: "AH-001", kind: "review" });
});

test("open-pr forwards exact candidate scope and retains a stale approval denial", async () => {
  const candidate = candidateFixture({ status: "awaiting_human_approval" });
  const freshness = {
    fresh: true,
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    target: { candidateId: candidate.id, candidateRevision: candidate.revisionNumber },
  };
  const store = memoryStore(
    taskFixture({
      status: "awaiting-human-approval",
      currentStage: "approval",
      runs: undefined,
      candidates: [candidate],
      gateFreshness: {
        "dev-review": freshness,
        test: freshness,
        "final-review": freshness,
      },
    }),
  );
  const route = routeHarness(store, {
    approvePullRequest: async () => {
      const error = new Error("The candidate changed after this action was proposed.");
      error.code = "STALE_CANDIDATE";
      error.evidence = ["Current C1 revision 2 @ dddddddd."];
      throw error;
    },
  });
  const result = await route.invoke("/api/tasks/AH-001/open-pr", "POST", {
    candidateId: "C1",
    candidateRevision: 1,
    candidateHeadRevision: "b".repeat(40),
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "stale-candidate");
  assert.deepEqual(route.approved(), {
    id: "AH-001",
    note: "",
    expectedCandidate: {
      candidateId: "C1",
      candidateRevision: 1,
      candidateHeadRevision: "b".repeat(40),
    },
  });
});

test("gate promotion rejects payload fields that are not part of the fixed confirmation scope", () => {
  const result = resolveGatePromotionEligibility(readyForReviewTask(), {
    action: "review",
    candidateId: "C1",
    candidateRevision: 1,
    candidateHeadRevision: "b".repeat(40),
    repositoryPath: "/outside/repository",
  });
  assert.equal(result.code, "unknown");
});

test("exact candidate binding is revalidated by the reservation predicate", async () => {
  const store = memoryStore(readyForReviewTask());
  const route = routeHarness(store, { mutateBeforeReservation: true });
  const result = await route.invoke("/api/tasks/AH-001/review", "POST", {
    candidateId: "C1",
    candidateRevision: 1,
    candidateHeadRevision: "b".repeat(40),
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "stale-candidate");
  assert.equal(route.started().id, "AH-001");
});

test("applyTaskRolePolicy does not alter unrelated task policy fields", () => {
  const task = taskFixture();
  const historicalPolicy = structuredClone(task.agentConfig);
  applyTaskRolePolicy(task, "implement", { model: "gpt-5.6-sol", reasoning: "high" });
  assert.deepEqual(task.agentConfig.model, historicalPolicy.model);
  assert.deepEqual(task.agentConfig.reasoning, historicalPolicy.reasoning);
  assert.deepEqual(task.agentConfig.stagePolicies.triage, historicalPolicy.stagePolicies.triage);
  assert.deepEqual(task.agentConfig.stagePolicies.implement, {
    model: "gpt-5.6-sol",
    reasoning: "high",
  });
});
