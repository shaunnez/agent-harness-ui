// Server-side source of truth for the gate auto-run setting introduced in AH-054.
// This module is intentionally dependency-free so the orchestrator (which needs
// only `resolveGatePolicy`) never has to pull in route-handling code.
//
// `RUN_GATE_STAGES` mirrors `candidateGateStages` (src/components/runtime/workflow.ts:11)
// and `GATE_POLICIES` mirrors `GRILL_POLICIES` (server/runtime-settings-routes.mjs).
// `GATE_STAGES` is the settable key set and covers both gate kinds; it mirrors
// `autoRunStages` (src/components/runtime/workflow.ts).

// Candidate-bound evidence gates. Auto-run here means "start the next agent run
// without waiting for a continue click" — no approval record is created.
export const RUN_GATE_STAGES = new Set(["implement", "dev-review", "test", "final-review"]);

// Human approval gates. Auto-run here means the orchestrator records the approval
// itself, through the same approve path a person uses, with every validation intact.
// Provenance is retained on the approval so an automatic approval is never mistaken
// for evidence that a person read the artifact.
export const APPROVAL_GATE_STAGES = new Set(["specification", "plan"]);

/**
 * The repair gate. Not a workflow stage: a candidate parks at `repair-required` on
 * whichever gate rejected it, and the repair run itself spends the `implement`
 * allowance. `"repair"` is a policy key that names a decision — may the harness
 * rebuild a rejected candidate without being asked? — rather than a place in the
 * pipeline, which is why it is settable but never appears in `workflowStages`.
 *
 * It is separated from `RUN_GATE_STAGES` because the question it asks an operator is
 * a different one. Opting Implement in says "start the run I would have started".
 * Opting Repair in says "act on a rejection I have not read". Two bounds keep that
 * from running away, and both predate this key: the repair run consumes an Implement
 * attempt, and the repair circuit breaker moves an over-repaired candidate to
 * `blocked` — a status no policy can advance.
 */
export const REPAIR_GATE_STAGES = new Set(["repair"]);

export const GATE_STAGES = new Set([...RUN_GATE_STAGES, ...APPROVAL_GATE_STAGES, ...REPAIR_GATE_STAGES]);

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

/**
 * Keyed by the status the task parks in, not by the run kind that produced it. Two
 * kinds can park at the same gate — `implementation` and `repair` both land on
 * `ready-for-review`, and `approvePlan` lands on `ready-for-implementation` without any
 * run finishing at all — so the status is the only key that names the gate exactly once.
 */
export const GATE_AUTO_ADVANCE = Object.freeze({
  "ready-for-implementation": { stage: "implement", nextKind: "implementation" },
  "ready-for-review": { stage: "dev-review", nextKind: "review" },
  "ready-for-test": { stage: "test", nextKind: "test" },
  "ready-for-final-review": { stage: "final-review", nextKind: "final-review" },
});

/**
 * The gate a task is parked at, or `null` when it is not parked at one.
 *
 * `GATE_AUTO_ADVANCE` cannot answer this alone because `repair-required` is the one
 * gate whose stage is not fixed by its status: a candidate can be rejected at
 * dev-review, test or final-review and parks at whichever one rejected it. The
 * returned `stage` is where the decision is recorded, `policyStage` is the key looked
 * up in `gatePolicies`, and for every gate but repair the two are the same.
 */
export function resolveGateAutoAdvance(task) {
  const parked = GATE_AUTO_ADVANCE[task?.status];
  if (parked) return { ...parked, policyStage: parked.stage };
  if (task?.status !== "repair-required") return null;
  // A repair is only meaningful against a gate that judged a candidate. Any other
  // stage reaching this status is a shape the orchestrator does not produce, and
  // guessing a stage for it would attribute the run to the wrong budget.
  if (!RUN_GATE_STAGES.has(task.currentStage)) return null;
  return { stage: task.currentStage, nextKind: "repair", policyStage: "repair" };
}

/**
 * Approval gates are keyed by the status the task parks in rather than by the run kind
 * that produced it, because more than one kind can park at the same gate: a fast task
 * reaches `awaiting-plan-approval` straight out of `investigation`, while a standard
 * task reaches it out of `planning`.
 */
export const GATE_APPROVAL_ADVANCE = Object.freeze({
  "awaiting-spec-approval": { stage: "specification", approval: "specification" },
  "awaiting-plan-approval": { stage: "plan", approval: "plan" },
});
