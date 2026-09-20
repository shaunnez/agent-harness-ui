import assert from "node:assert/strict";
import test from "node:test";
import { TaskControlOrchestrator } from "../server/orchestrator-task-control.mjs";
import { withActionEligibility } from "../server/retry-admission-policy.mjs";

function controlFor({ task, settings = {}, startResult = true, stalePlan = false }) {
  const current = structuredClone(task);
  const store = {
    async get() {
      return structuredClone(current);
    },
    async settings() {
      return structuredClone(settings);
    },
    async update(_id, updater) {
      updater(current);
      return structuredClone(current);
    },
    async transition(_id, condition, updater) {
      if (!condition(current)) {
        const error = new Error("Task state changed before the requested action could be reserved.");
        error.code = "TASK_TRANSITION_CONFLICT";
        throw error;
      }
      updater(current);
      return structuredClone(current);
    },
  };
  const control = new TaskControlOrchestrator({
    store,
    active: new Map(),
    worktrees: {},
    planAuthority: { blockStalePlan: async () => stalePlan },
    run: async () => {},
  });
  // The manifest read is repository I/O; the plan's own executability rules are what
  // these tests are about, so only the read is replaced.
  control._readVerificationManifestInjected = true;
  control._readVerificationManifest = async () => ({ commands: [{ id: "lint", command: ["make", "lint"] }] });
  const starts = [];
  control.start = async (_id, kind, options) => {
    starts.push(kind);
    const admissible = options.canStart?.(current) ?? true;
    if (startResult && admissible) options.onReserve?.(current);
    return startResult && admissible;
  };
  return { control, current, starts };
}

for (const scenario of [
  {
    completedKind: "implementation",
    status: "ready-for-review",
    stage: "dev-review",
    nextKind: "review",
  },
  { completedKind: "review", status: "ready-for-test", stage: "test", nextKind: "test" },
  {
    completedKind: "test",
    status: "ready-for-final-review",
    stage: "final-review",
    nextKind: "final-review",
  },
]) {
  test(`auto-runs ${scenario.stage} through the ordinary ${scenario.nextKind} reservation path`, async () => {
    const task = {
      id: "AH-AUTO",
      status: scenario.status,
      currentStage: scenario.stage,
      workflowProfile: { selected: "high-risk" },
      attemptsByStage: { [scenario.stage]: 0 },
      stageRunLimits: { [scenario.stage]: 3 },
      events: [],
    };
    const { control, current, starts } = controlFor({
      task,
      settings: { gatePolicies: { [scenario.stage]: "auto-accept-recommendations" } },
    });

    await control._autoAdvanceGate(task.id);

    assert.deepEqual(starts, [scenario.nextKind]);
    assert.match(current.events.at(-1).title, /auto-run authorized/i);
    assert.match(current.events.at(-1).detail, /persisted automation policy/i);
  });
}

test("manual and unrelated gate policies leave the task waiting", async () => {
  for (const gatePolicies of [{}, { "dev-review": "manual" }, { test: "auto-accept-recommendations" }]) {
    const task = { id: "AH-MANUAL", status: "ready-for-review", currentStage: "dev-review", events: [] };
    const { control, starts } = controlFor({ task, settings: { gatePolicies } });
    await control._autoAdvanceGate(task.id);
    assert.deepEqual(starts, []);
  }
});

test("auto-run cannot bypass an exhausted gate allowance", async () => {
  const task = {
    id: "AH-EXHAUSTED-AUTO",
    status: "ready-for-review",
    currentStage: "dev-review",
    workflowProfile: { selected: "standard" },
    attemptsByStage: { "dev-review": 3 },
    stageRunLimits: { "dev-review": 3 },
    events: [],
  };
  const { control, current, starts } = controlFor({
    task,
    settings: { gatePolicies: { "dev-review": "auto-accept-recommendations" } },
  });

  await control._autoAdvanceGate(task.id);

  assert.deepEqual(starts, ["review"]);
  assert.equal(
    current.events.some((event) => /auto-run authorized/i.test(event.title)),
    false,
  );
});

test("records a failed automatic reservation instead of swallowing it", async () => {
  const task = { id: "AH-RACE", status: "ready-for-test", currentStage: "test", events: [] };
  const { control, current } = controlFor({
    task,
    settings: { gatePolicies: { test: "auto-accept-recommendations" } },
    startResult: false,
  });

  await control._autoAdvanceGate(task.id, "review");

  assert.match(current.events.at(-1).title, /could not start/i);
  assert.match(current.events.at(-1).detail, /task changed/i);
});

test("does not advertise PR promotion when candidate and task authority differ", () => {
  const projected = withActionEligibility({
    status: "awaiting-human-approval",
    currentStage: "approval",
    activeRunKind: null,
    activeRunReservationId: null,
    repositoryAuthorityStatus: "bound",
    repositoryAuthority: { selectedRevision: "a".repeat(40) },
    candidates: [
      {
        id: "C1",
        revisionNumber: 2,
        baseRevision: "b".repeat(40),
        headRevision: "c".repeat(40),
        status: "awaiting_human_approval",
      },
    ],
  });

  assert.equal(projected.actionEligibility.actions["open-pr"].allowed, false);
  assert.match(projected.actionEligibility.actions["open-pr"].reason, /base matches/i);
});

// --- approval gates -------------------------------------------------------------

function planReadyTask(overrides = {}) {
  return {
    id: "AH-PLAN-AUTO",
    status: "awaiting-plan-approval",
    currentStage: "plan",
    workflowProfile: { selected: "standard" },
    workPackages: [{ id: "WP-1", dependencies: [], verificationCommandIds: ["lint"] }],
    attemptsByStage: {},
    stageRunLimits: {},
    approvals: [],
    artifacts: [],
    events: [],
    ...overrides,
  };
}

test("an automatic specification approval starts planning and is marked as automatic", async () => {
  const task = {
    id: "AH-SPEC-AUTO",
    status: "awaiting-spec-approval",
    currentStage: "specification",
    workflow: "implement",
    approvals: [],
    artifacts: [],
    events: [],
  };
  const { control, current, starts } = controlFor({
    task,
    settings: { gatePolicies: { specification: "auto-accept-recommendations" } },
  });

  await control._autoAdvanceGate(task.id);

  assert.deepEqual(starts, ["planning"]);
  assert.equal(current.approvals.length, 1);
  assert.equal(current.approvals[0].stage, "specification");
  assert.equal(current.approvals[0].automatic, true);
  const approvalEvent = current.events.find((event) => /auto-approved/i.test(event.title));
  assert.ok(approvalEvent, "the automatic approval is recorded as such in the activity log");
  assert.match(approvalEvent.detail, /No person reviewed this artifact\./);
});

test("an automatic plan approval chains straight into implementation when implement is opted in", async () => {
  const { control, current, starts } = controlFor({
    task: planReadyTask(),
    settings: {
      gatePolicies: { plan: "auto-accept-recommendations", implement: "auto-accept-recommendations" },
    },
  });

  await control._autoAdvanceGate("AH-PLAN-AUTO");

  assert.deepEqual(starts, ["implementation"]);
  assert.equal(current.approvals.at(-1).stage, "plan");
  assert.equal(current.approvals.at(-1).automatic, true);
});

test("an automatic plan approval stops at ready-for-implementation when implement stays manual", async () => {
  const { control, current, starts } = controlFor({
    task: planReadyTask(),
    settings: { gatePolicies: { plan: "auto-accept-recommendations" } },
  });

  await control._autoAdvanceGate("AH-PLAN-AUTO");

  assert.deepEqual(starts, []);
  assert.equal(current.status, "ready-for-implementation");
  assert.equal(current.approvals.at(-1).automatic, true);
});

test("a manually approved plan still starts implementation when implement is opted in", async () => {
  const { control, current, starts } = controlFor({
    task: planReadyTask(),
    settings: { gatePolicies: { implement: "auto-accept-recommendations" } },
  });

  await control.approvePlan("AH-PLAN-AUTO", "Looks right.");

  assert.deepEqual(starts, ["implementation"]);
  assert.equal(current.approvals.at(-1).automatic, false);
  assert.equal(current.approvals.at(-1).note, "Looks right.");
});

test("manual approval gates leave the task parked with no approval invented", async () => {
  for (const gatePolicies of [{}, { plan: "manual" }, { specification: "auto-accept-recommendations" }]) {
    const { control, current, starts } = controlFor({ task: planReadyTask(), settings: { gatePolicies } });
    await control._autoAdvanceGate("AH-PLAN-AUTO");
    assert.deepEqual(starts, []);
    assert.equal(current.status, "awaiting-plan-approval");
    assert.deepEqual(current.approvals, []);
  }
});

test("auto-approval fails closed on a stale plan and records why", async () => {
  const { control, current, starts } = controlFor({
    task: planReadyTask(),
    settings: { gatePolicies: { plan: "auto-accept-recommendations" } },
    stalePlan: true,
  });

  await control._autoAdvanceGate("AH-PLAN-AUTO");

  assert.deepEqual(starts, []);
  assert.equal(current.status, "awaiting-plan-approval");
  assert.deepEqual(current.approvals, [], "a refused gate must not leave an approval behind");
  assert.match(current.events.at(-1).title, /could not start/i);
  assert.match(current.events.at(-1).detail, /Revalidate the retained plan\./);
});

test("auto-approval fails closed on a plan with no verifiable work package", async () => {
  const { control, current } = controlFor({
    task: planReadyTask({ workPackages: [{ id: "WP-1", dependencies: [], verificationCommandIds: [] }] }),
    settings: { gatePolicies: { plan: "auto-accept-recommendations" } },
  });

  await control._autoAdvanceGate("AH-PLAN-AUTO");

  assert.equal(current.status, "awaiting-plan-approval");
  assert.deepEqual(current.approvals, []);
  assert.match(current.events.at(-1).detail, /at least one repository manifest command id/i);
});

test("a run gate whose start throws records why instead of stalling the task in silence", async () => {
  const task = {
    id: "AH-THROW",
    status: "ready-for-implementation",
    currentStage: "implement",
    workflowProfile: { selected: "fast" },
    attemptsByStage: { implement: 0 },
    stageRunLimits: { implement: 3 },
    events: [],
  };
  const { control, current, starts } = controlFor({
    task,
    settings: { gatePolicies: { implement: "auto-accept-recommendations" } },
  });
  // A stray uncommitted file in the operator's checkout is what throws here in practice.
  // Whatever the cause, the task must not stop with nothing written explaining it.
  control.start = async () => {
    throw new Error("The selected repository has 1 uncommitted change (.DS_Store).");
  };

  await control._autoAdvanceGate(task.id);

  assert.deepEqual(starts, []);
  assert.equal(current.status, "ready-for-implementation");
  const recorded = current.events.map((event) => `${event.title} ${event.detail ?? ""}`).join(" ");
  assert.match(recorded, /uncommitted change/);
});
