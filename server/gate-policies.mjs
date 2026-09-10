// Server-side source of truth for the gate auto-run setting introduced in AH-054.
// This module is intentionally dependency-free so the orchestrator (which needs
// only `resolveGatePolicy`) never has to pull in route-handling code.
//
// `GATE_STAGES` mirrors `candidateGateStages` (src/components/runtime/workflow.ts:11)
// and `GATE_POLICIES` mirrors `GRILL_POLICIES` (server/runtime-settings-routes.mjs).

export const GATE_STAGES = new Set(["dev-review", "test", "final-review"]);

export const GATE_POLICIES = new Set(["manual", "auto-accept-recommendations"]);

/**
 * Normalize and validate a `gatePolicies` map.
 *
 * When `input` is `undefined`, the current persisted value is preserved
 * unchanged (mirroring the `grillPolicy` contract in
 * server/runtime-settings-routes.mjs). When both `input` and `current` are
 * absent, an empty map is returned: every gate defaults to `"manual"` via
 * `resolveGatePolicy`, so an empty/absent map is a complete, valid value.
 *
 * Throws on an unrecognized gate stage key or an unrecognized policy value.
 */
export function validateGatePolicies(input, current) {
  const source = input === undefined ? current : input;
  if (source === undefined || source === null) return {};
  if (typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Unknown gate stage.");
  }

  const normalized = {};
  for (const [stage, policy] of Object.entries(source)) {
    if (!GATE_STAGES.has(stage)) throw new Error("Unknown gate stage.");
    const value = String(policy);
    if (!GATE_POLICIES.has(value)) throw new Error("Choose a supported gate auto-run policy.");
    normalized[stage] = value;
  }
  return normalized;
}

/**
 * Resolve the effective policy for a single gate stage, defaulting to
 * `"manual"` when the settings object, its `gatePolicies` map, or the
 * specific stage key is absent.
 */
export function resolveGatePolicy(settings, stage) {
  return settings?.gatePolicies?.[stage] ?? "manual";
}

export const GATE_AUTO_ADVANCE = Object.freeze({
  implementation: { readyStatus: "ready-for-review", stage: "dev-review", nextKind: "review" },
  repair: { readyStatus: "ready-for-review", stage: "dev-review", nextKind: "review" },
  review: { readyStatus: "ready-for-test", stage: "test", nextKind: "test" },
  test: { readyStatus: "ready-for-final-review", stage: "final-review", nextKind: "final-review" },
});
