import test from "node:test";
import assert from "node:assert/strict";
import {
  GATE_POLICIES,
  GATE_STAGES,
  resolveGatePolicy,
  validateGatePolicies,
} from "../server/gate-policies.mjs";

test("GATE_STAGES and GATE_POLICIES name the three gate stages and the two supported policies", () => {
  assert.deepEqual([...GATE_STAGES].sort(), ["dev-review", "final-review", "test"]);
  assert.deepEqual([...GATE_POLICIES].sort(), ["auto-accept-recommendations", "manual"]);
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
