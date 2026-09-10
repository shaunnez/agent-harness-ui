import assert from "node:assert/strict";
import test from "node:test";
import { TaskControlOrchestrator } from "../server/orchestrator-task-control.mjs";
import { withActionEligibility } from "../server/retry-admission-policy.mjs";

function controlFor({ task, settings = {}, startResult = true }) {
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
  };
  const control = new TaskControlOrchestrator({
    store,
    active: new Map(),
    worktrees: {},
    planAuthority: {},
    run: async () => {},
  });
  const starts = [];
  control.start = async (_id, kind, options) => {
    starts.push(kind);
    if (startResult) options.onReserve?.(current);
    return startResult;
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
      events: [],
    };
    const { control, current, starts } = controlFor({
      task,
      settings: { gatePolicies: { [scenario.stage]: "auto-accept-recommendations" } },
    });

    await control._autoAdvanceGate(task.id, scenario.completedKind);

    assert.deepEqual(starts, [scenario.nextKind]);
    assert.match(current.events.at(-1).title, /auto-run authorized/i);
    assert.match(current.events.at(-1).detail, /persisted automation policy/i);
  });
}

test("manual and unrelated gate policies leave the task waiting", async () => {
  for (const gatePolicies of [{}, { "dev-review": "manual" }, { test: "auto-accept-recommendations" }]) {
    const task = { id: "AH-MANUAL", status: "ready-for-review", currentStage: "dev-review", events: [] };
    const { control, starts } = controlFor({ task, settings: { gatePolicies } });
    await control._autoAdvanceGate(task.id, "implementation");
    assert.deepEqual(starts, []);
  }
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
