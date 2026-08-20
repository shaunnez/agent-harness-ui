import assert from "node:assert/strict";
import test from "node:test";
import { FAILURE_CLASSIFICATIONS } from "../server/evaluation.mjs";
import { admitBackjump, BACKJUMP_LIMIT, backjumpsSpent, routeFailure } from "../server/failure-routing.mjs";

function taskWithBackjumps(count) {
  return {
    topologyTrace: {
      nodesExecuted: [],
      nodesSkipped: [],
      edgesTaken: [
        { from: "plan", to: "implement", kind: "advance" },
        ...Array.from({ length: count }, () => ({ from: "test", to: "plan", kind: "backjump" })),
      ],
      routingDecisions: [],
    },
  };
}

// --- the full table -------------------------------------------------------------

test("every classification routes somewhere, and nothing else does", () => {
  for (const classification of FAILURE_CLASSIFICATIONS) {
    const route = routeFailure(classification);
    assert.equal(route.classification, classification);
    assert.ok(route.action, `${classification} needs an action`);
    assert.ok(route.rationale.length > 20, `${classification} needs a real rationale`);
    assert.ok(Array.isArray(route.invalidates));
  }
  assert.throws(() => routeFailure("VIBES"), /Cannot route an unknown failure classification/);
  assert.throws(() => routeFailure(null), /Cannot route an unknown failure classification/);
});

test("the exact route of each classification", () => {
  const expected = {
    IMPLEMENTATION_DEFECT: { action: "repair-candidate", rewindTo: "implement", discardsCandidate: false },
    PLAN_DEFECT: { action: "replan", rewindTo: "plan", discardsCandidate: true },
    SPECIFICATION_GAP: { action: "respecify", rewindTo: "specification", discardsCandidate: true },
    INVESTIGATION_GAP: { action: "reinvestigate", rewindTo: "scouts", discardsCandidate: true },
    VERIFICATION_GAP: { action: "revise-verification", rewindTo: "test", discardsCandidate: false },
    ENVIRONMENT_FAILURE: { action: "remediate-environment", rewindTo: null, discardsCandidate: false },
    INTEGRATION_FAILURE: { action: "reintegrate", rewindTo: "implement", discardsCandidate: true },
    TARGET_DRIFT: { action: "refresh-base", rewindTo: "implement", discardsCandidate: true },
  };
  for (const [classification, shape] of Object.entries(expected)) {
    const route = routeFailure(classification);
    assert.equal(route.action, shape.action, classification);
    assert.equal(route.rewindTo, shape.rewindTo, classification);
    assert.equal(route.discardsCandidate, shape.discardsCandidate, classification);
  }
});

test("only an implementation defect spends the automatic repair cycle", () => {
  for (const classification of FAILURE_CLASSIFICATIONS) {
    assert.equal(
      routeFailure(classification).consumesRepairCycle,
      classification === "IMPLEMENTATION_DEFECT",
      `${classification} must not touch the repair budget`,
    );
  }
});

test("an implementation defect routes to exactly the pre-existing repair behaviour", () => {
  const route = routeFailure("IMPLEMENTATION_DEFECT");
  assert.deepEqual(route.invalidates, []);
  assert.equal(route.discardsCandidate, false);
  assert.equal(route.consumesBackjump, false);
  assert.equal(route.requiresHuman, false);
});

test("invalidation always reaches every stage downstream of the rewind target", () => {
  const order = [
    "scouts",
    "synthesis",
    "grill",
    "specification",
    "plan",
    "implement",
    "dev-review",
    "test",
    "final-review",
  ];
  for (const classification of FAILURE_CLASSIFICATIONS) {
    const route = routeFailure(classification);
    if (!route.rewindTo || !route.invalidates.length) continue;
    const from = order.indexOf(route.rewindTo);
    if (from === -1) continue;
    for (const stage of order.slice(from)) {
      // A rewind that leaves stale downstream evidence behind would let a later gate pass on
      // evidence produced against assumptions that have since been discarded.
      assert.ok(
        route.invalidates.includes(stage),
        `${classification} rewinds to ${route.rewindTo} but leaves ${stage} evidence valid`,
      );
    }
  }
});

test("a deeper rewind invalidates a superset of a shallower one", () => {
  const plan = new Set(routeFailure("PLAN_DEFECT").invalidates);
  const spec = new Set(routeFailure("SPECIFICATION_GAP").invalidates);
  const investigation = new Set(routeFailure("INVESTIGATION_GAP").invalidates);
  for (const stage of plan) assert.ok(spec.has(stage), `specification rewind must also invalidate ${stage}`);
  for (const stage of spec)
    assert.ok(investigation.has(stage), `investigation rewind must also invalidate ${stage}`);
});

// --- backjump admission ---------------------------------------------------------

test("backjumps are counted from the recorded trace, not a separate counter", () => {
  assert.equal(backjumpsSpent(taskWithBackjumps(0)), 0);
  assert.equal(backjumpsSpent(taskWithBackjumps(2)), 2);
  assert.equal(backjumpsSpent({}), 0);
  assert.equal(backjumpsSpent(null), 0);
});

test("the backjump budget stops an endless rewind loop", () => {
  const route = routeFailure("PLAN_DEFECT");
  assert.equal(admitBackjump(taskWithBackjumps(0), route).admitted, true);
  assert.equal(admitBackjump(taskWithBackjumps(BACKJUMP_LIMIT - 1), route).admitted, true);
  const exhausted = admitBackjump(taskWithBackjumps(BACKJUMP_LIMIT), route);
  assert.equal(exhausted.admitted, false);
  assert.match(exhausted.reason, /needs human direction/);
});

test("a route that costs no backjump is admitted even past the limit", () => {
  for (const classification of ["IMPLEMENTATION_DEFECT", "ENVIRONMENT_FAILURE", "TARGET_DRIFT"]) {
    const admission = admitBackjump(taskWithBackjumps(BACKJUMP_LIMIT + 5), routeFailure(classification));
    assert.equal(admission.admitted, true, `${classification} must not be gated by the backjump budget`);
  }
});

test("an environment failure asks for a human instead of a rewind", () => {
  const route = routeFailure("ENVIRONMENT_FAILURE");
  assert.equal(route.requiresHuman, true);
  assert.equal(route.rewindTo, null);
  assert.equal(route.consumesBackjump, false);
});

test("target drift costs no budget because the work was never wrong", () => {
  const route = routeFailure("TARGET_DRIFT");
  assert.equal(route.consumesBackjump, false);
  assert.equal(route.consumesRepairCycle, false);
  assert.equal(route.discardsCandidate, true);
});

test("a returned route cannot be mutated into a different policy", () => {
  const first = routeFailure("PLAN_DEFECT");
  first.invalidates.push("approval");
  first.rewindTo = "triage";
  const second = routeFailure("PLAN_DEFECT");
  assert.equal(second.rewindTo, "plan");
  assert.equal(second.invalidates.includes("approval"), false);
});
