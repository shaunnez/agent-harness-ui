import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVAL_GATE_STAGES,
  GATE_APPROVAL_ADVANCE,
  GATE_AUTO_ADVANCE,
  GATE_POLICIES,
  GATE_STAGES,
  RUN_GATE_STAGES,
  resolveGatePolicy,
  REPAIR_GATE_STAGES,
  resolveGateAutoAdvance,
  validateGatePolicies,
} from "../server/gate-policies.mjs";

test("GATE_STAGES covers all three gate kinds and GATE_POLICIES names the two supported policies", () => {
  assert.deepEqual([...RUN_GATE_STAGES].sort(), ["dev-review", "final-review", "implement", "test"]);
  assert.deepEqual([...APPROVAL_GATE_STAGES].sort(), ["plan", "specification"]);
  // Repair is its own kind, not a run gate: the others advance a candidate that passed,
  // it acts on one that was rejected.
  assert.deepEqual([...REPAIR_GATE_STAGES].sort(), ["repair"]);
  assert.deepEqual([...GATE_STAGES].sort(), [
    "dev-review",
    "final-review",
    "implement",
    "plan",
    "repair",
    "specification",
    "test",
  ]);
  assert.deepEqual([...GATE_POLICIES].sort(), ["auto-accept-recommendations", "manual"]);
});

test("the repair gate is resolved from the stage that rejected the candidate", () => {
  for (const stage of ["dev-review", "test", "final-review"]) {
    assert.deepEqual(resolveGateAutoAdvance({ status: "repair-required", currentStage: stage }), {
      stage,
      nextKind: "repair",
      policyStage: "repair",
    });
  }
});

test("repair is settable under one key but never reported as its own stage", () => {
  // The whole point of `policyStage`: an operator opts in once, and the decision is
  // still recorded against whichever gate turned the candidate down.
  const advance = resolveGateAutoAdvance({ status: "repair-required", currentStage: "test" });
  assert.equal(advance.policyStage, "repair");
  assert.notEqual(advance.stage, "repair");
  assert.deepEqual(validateGatePolicies({ repair: "auto-accept-recommendations" }), {
    repair: "auto-accept-recommendations",
  });
});

test("every other gate resolves to itself, and a task at no gate resolves to nothing", () => {
  assert.deepEqual(resolveGateAutoAdvance({ status: "ready-for-test", currentStage: "test" }), {
    stage: "test",
    nextKind: "test",
    policyStage: "test",
  });
  for (const task of [
    null,
    undefined,
    { status: "queued", currentStage: "triage" },
    // Blocked is where the repair circuit breaker puts an over-repaired candidate. No
    // policy may advance it: that is the bound that stops automatic repair looping.
    { status: "blocked", currentStage: "dev-review" },
    // `repair-required` outside a candidate gate is a shape the orchestrator does not
    // produce; guessing a stage would charge the run to the wrong budget.
    { status: "repair-required", currentStage: "plan" },
  ]) {
    assert.equal(resolveGateAutoAdvance(task), null);
  }
});

test("the two advance maps are keyed by parked status and never claim the same status", () => {
  assert.deepEqual(Object.keys(GATE_AUTO_ADVANCE).sort(), [
    "ready-for-final-review",
    "ready-for-implementation",
    "ready-for-review",
    "ready-for-test",
  ]);
  assert.deepEqual(Object.keys(GATE_APPROVAL_ADVANCE).sort(), [
    "awaiting-plan-approval",
    "awaiting-spec-approval",
  ]);
  for (const status of Object.keys(GATE_APPROVAL_ADVANCE)) {
    assert.equal(GATE_AUTO_ADVANCE[status], undefined);
  }
});

test("every advance map entry names a stage that is settable in gatePolicies", () => {
  for (const transition of Object.values(GATE_AUTO_ADVANCE)) {
    assert.ok(RUN_GATE_STAGES.has(transition.stage), `${transition.stage} is not a run gate`);
  }
  for (const transition of Object.values(GATE_APPROVAL_ADVANCE)) {
    assert.ok(APPROVAL_GATE_STAGES.has(transition.stage), `${transition.stage} is not an approval gate`);
  }
});

test("validateGatePolicies accepts the approval gate stages", () => {
  assert.deepEqual(
    validateGatePolicies(
      {
        specification: "auto-accept-recommendations",
        plan: "manual",
        implement: "auto-accept-recommendations",
      },
      undefined,
    ),
    {
      specification: "auto-accept-recommendations",
      plan: "manual",
      implement: "auto-accept-recommendations",
    },
  );
});

test("resolveGatePolicy defaults the approval gates to manual", () => {
  assert.equal(resolveGatePolicy({ gatePolicies: {} }, "specification"), "manual");
  assert.equal(resolveGatePolicy({ gatePolicies: { specification: "manual" } }, "plan"), "manual");
  assert.equal(
    resolveGatePolicy({ gatePolicies: { plan: "auto-accept-recommendations" } }, "plan"),
    "auto-accept-recommendations",
  );
});

test("validateGatePolicies accepts a partial map and leaves unspecified stages absent", () => {
  const normalized = validateGatePolicies({ "dev-review": "auto-accept-recommendations" }, undefined);
  assert.deepEqual(normalized, { "dev-review": "auto-accept-recommendations" });
  assert.equal(normalized.test, undefined);
  assert.equal(normalized["final-review"], undefined);
});

test("validateGatePolicies falls back to the current value when input is undefined", () => {
  const current = { test: "auto-accept-recommendations" };
  assert.deepEqual(validateGatePolicies(undefined, current), current);
});

test("validateGatePolicies returns an empty object when both input and current are absent", () => {
  assert.deepEqual(validateGatePolicies(undefined, undefined), {});
});

test("validateGatePolicies rejects an unknown gate stage key", () => {
  assert.throws(() => validateGatePolicies({ "not-a-gate": "manual" }, undefined), /Unknown gate stage\./);
});

test("validateGatePolicies rejects an unknown policy value", () => {
  assert.throws(
    () => validateGatePolicies({ "dev-review": "always-automatic" }, undefined),
    /Choose a supported gate auto-run policy\./,
  );
});

test("resolveGatePolicy defaults to manual when the settings object has no gatePolicies map", () => {
  assert.equal(resolveGatePolicy({}, "dev-review"), "manual");
  assert.equal(resolveGatePolicy(undefined, "test"), "manual");
});

test("resolveGatePolicy defaults to manual for a stage key absent from an otherwise populated map", () => {
  const settings = { gatePolicies: { test: "auto-accept-recommendations" } };
  assert.equal(resolveGatePolicy(settings, "dev-review"), "manual");
  assert.equal(resolveGatePolicy(settings, "final-review"), "manual");
});

test("resolveGatePolicy resolves each gate stage independently", () => {
  const settings = {
    gatePolicies: {
      "dev-review": "auto-accept-recommendations",
      test: "manual",
    },
  };
  assert.equal(resolveGatePolicy(settings, "dev-review"), "auto-accept-recommendations");
  assert.equal(resolveGatePolicy(settings, "test"), "manual");
  assert.equal(resolveGatePolicy(settings, "final-review"), "manual");
});
