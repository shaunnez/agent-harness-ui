/**
 * Where a failed run goes next.
 *
 * The harness already knew how to repair a candidate. What it could not do was decide that the
 * candidate was fine and the *plan* was wrong. This module is that decision, and it is
 * deliberately a pure lookup rather than a model call: the diagnosis agent classifies, and this
 * table alone chooses the rewind target. A model that proposes a convenient rewind cannot get
 * one, which is why `parseFailureDiagnosis` returns `proposedRewindTo` and never `rewindTo`.
 *
 * What this module does NOT do: change candidate lineage rules, gate freshness, repair
 * authority, or the automatic repair budget. `IMPLEMENTATION_DEFECT` routes to exactly the
 * behaviour that existed before this module, byte for byte. Every other classification takes a
 * new path that spends a separate, independently bounded budget (see BACKJUMP_LIMIT).
 */
import { FAILURE_CLASSIFICATIONS } from "./evaluation.mjs";

/**
 * A backjump rewinds the graph rather than editing code, so it does not consume the automatic
 * candidate-repair cycle. That means it needs a budget of its own, or a model that always
 * answers "PLAN_DEFECT" would loop between planning and review forever without ever spending
 * the counter that stops repair loops. Two is deliberate: one genuine mistake in an upstream
 * assumption is common, two is unlucky, three is a signal that a human should look.
 */
export const BACKJUMP_LIMIT = 2;

const ROUTES = Object.freeze({
  IMPLEMENTATION_DEFECT: {
    action: "repair-candidate",
    rewindTo: "implement",
    invalidates: [],
    discardsCandidate: false,
    consumesRepairCycle: true,
    consumesBackjump: false,
    rationale:
      "The candidate is wrong and the upstream assumptions hold, so the existing repair path applies unchanged.",
  },
  PLAN_DEFECT: {
    action: "replan",
    rewindTo: "plan",
    invalidates: ["plan", "implement", "dev-review", "test", "final-review"],
    discardsCandidate: true,
    consumesRepairCycle: false,
    consumesBackjump: true,
    rationale:
      "The plan did not cover what the failure exposed. Repairing the candidate would implement the same wrong plan more carefully.",
  },
  SPECIFICATION_GAP: {
    action: "respecify",
    rewindTo: "specification",
    invalidates: ["specification", "plan", "implement", "dev-review", "test", "final-review"],
    discardsCandidate: true,
    consumesRepairCycle: false,
    consumesBackjump: true,
    rationale:
      "The requirement itself is underspecified, so no plan drawn from it can be correct. The acceptance criteria have to change first.",
  },
  INVESTIGATION_GAP: {
    action: "reinvestigate",
    rewindTo: "scouts",
    invalidates: [
      "scouts",
      "synthesis",
      "grill",
      "specification",
      "plan",
      "implement",
      "dev-review",
      "test",
      "final-review",
    ],
    discardsCandidate: true,
    consumesRepairCycle: false,
    consumesBackjump: true,
    rationale:
      "The evidence the whole chain was built on is incomplete. Everything downstream inherited the gap, so the rewind goes back to gathering facts.",
  },
  VERIFICATION_GAP: {
    action: "revise-verification",
    rewindTo: "test",
    invalidates: ["test", "final-review"],
    discardsCandidate: false,
    consumesRepairCycle: false,
    consumesBackjump: true,
    rationale:
      "The candidate may be correct and the check is what is wrong or missing. Editing code to satisfy a bad check is the failure mode this route exists to prevent.",
  },
  ENVIRONMENT_FAILURE: {
    action: "remediate-environment",
    rewindTo: null,
    invalidates: ["test"],
    discardsCandidate: false,
    consumesRepairCycle: false,
    consumesBackjump: false,
    requiresHuman: true,
    rationale:
      "Nothing in the reasoning graph is wrong, so no rewind can help. The environment needs a human; spending a budget on it would punish the task for a machine problem.",
  },
  INTEGRATION_FAILURE: {
    action: "reintegrate",
    rewindTo: "implement",
    invalidates: ["implement", "dev-review", "test", "final-review"],
    discardsCandidate: true,
    consumesRepairCycle: false,
    consumesBackjump: true,
    rationale:
      "The individual slices are sound but their combination is not, so the integration is re-derived rather than one slice being patched.",
  },
  TARGET_DRIFT: {
    action: "refresh-base",
    rewindTo: "implement",
    invalidates: ["implement", "dev-review", "test", "final-review"],
    discardsCandidate: true,
    consumesRepairCycle: false,
    consumesBackjump: false,
    rationale:
      "The target branch moved under the candidate. The work was never wrong, so this costs no budget; it is rebased onto the current base and re-qualified.",
  },
});

/** Every classification has exactly one route, checked at module load rather than at runtime. */
for (const classification of FAILURE_CLASSIFICATIONS) {
  if (!ROUTES[classification])
    throw new Error(`failure-routing.mjs is missing a route for ${classification}.`);
}

export function routeFailure(classification) {
  const route = ROUTES[String(classification ?? "").toUpperCase()];
  if (!route)
    throw new Error(
      `Cannot route an unknown failure classification: ${classification}. Known: ${FAILURE_CLASSIFICATIONS.join(", ")}.`,
    );
  return {
    classification: String(classification).toUpperCase(),
    requiresHuman: false,
    ...structuredClone(route),
  };
}

/**
 * How many backjumps this task has already spent. Read from the recorded trace rather than a
 * separate counter, so the budget and the telemetry can never disagree about what happened.
 */
export function backjumpsSpent(task) {
  return (task?.topologyTrace?.edgesTaken ?? []).filter((edge) => edge?.kind === "backjump").length;
}

/**
 * The admission decision, kept separate from the route itself so the route table stays a pure
 * statement of *where* each failure belongs and this function owns *whether* we may go there.
 */
export function admitBackjump(task, route) {
  if (!route.consumesBackjump) return { admitted: true, spent: backjumpsSpent(task), reason: null };
  const spent = backjumpsSpent(task);
  if (spent >= BACKJUMP_LIMIT) {
    return {
      admitted: false,
      spent,
      reason: `This task has already rewound ${spent} time${spent === 1 ? "" : "s"}, the limit for automatic backjumps. A third upstream assumption failure needs human direction rather than another automatic rewind.`,
    };
  }
  return { admitted: true, spent, reason: null };
}
