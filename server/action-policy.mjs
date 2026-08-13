import { stageRunLimitFor } from "./run-activity.mjs";

export const PROJECTED_ACTIONS = Object.freeze([
  "run",
  "continue-implementation",
  "approve-spec",
  "approve-plan",
  "specification",
  "plan",
  "implement",
  "continue-package",
  "repair",
  "review",
  "test",
  "retry-test",
  "final-review",
  "approve-merge",
  "open-pr",
  "reconcile-pr",
  "reconcile-merge",
  "complete-merged",
  "refresh-candidate",
  "rebuild-candidate",
  "restart-implementation",
  "grant-retry",
]);

const RUN_ACTIONS = Object.freeze({
  run: {
    kind: "investigation",
    statuses: ["queued", "failed", "cancelled"],
    stages: ["triage", "scouts", "grill"],
  },
  specification: { kind: "specification", statuses: ["failed", "cancelled"], stages: ["specification"] },
  plan: {
    kind: "planning",
    statuses: ["awaiting-plan-approval", "failed", "cancelled"],
    stages: ["plan", "implement"],
  },
  implement: {
    kind: "implementation",
    statuses: ["ready-for-implementation", "failed", "cancelled"],
    stages: ["implement"],
  },
  repair: {
    kind: "repair",
    statuses: ["repair-required", "failed", "cancelled"],
    stages: ["implement", "dev-review", "test", "final-review"],
  },
  review: {
    kind: "review",
    statuses: ["ready-for-review", "review-retry-required", "failed", "cancelled"],
    stages: ["dev-review"],
  },
  test: { kind: "test", statuses: ["ready-for-test", "failed", "cancelled"], stages: ["test"] },
  "final-review": {
    kind: "final-review",
    statuses: ["ready-for-final-review", "failed", "cancelled"],
    stages: ["final-review"],
  },
});

const CANDIDATE_GATE_ACTIONS = new Set(["review", "test", "final-review"]);

export function runActionAdmission(task, action) {
  const configuration = RUN_ACTIONS[action];
  if (!configuration) return null;
  const deny = (reason, code = "state") => ({ allowed: false, reason, code, mode: "denied", configuration });
  if (!configuration.stages.includes(task.currentStage)) {
    return deny(`Task cannot run ${action} from the ${task.currentStage} stage.`);
  }
  const candidate = task.candidates?.at(-1);
  if (action === "implement" && candidate?.status === "repair_required") {
    return deny("Use the repair action to create a new revision of this candidate.");
  }
  if (action === "repair" && candidate?.status !== "repair_required") {
    return deny("The current candidate is not awaiting repair.");
  }
  const effectiveStage = action === "repair" ? "implement" : task.currentStage;
  const allowanceExhausted =
    (task.attemptsByStage?.[effectiveStage] ?? 0) >= stageRunLimitFor(task, effectiveStage);
  if (CANDIDATE_GATE_ACTIONS.has(action)) {
    const executable =
      configuration.statuses.includes(task.status) && task.status !== "blocked" && !allowanceExhausted;
    return {
      allowed: true,
      reason: executable
        ? null
        : "Candidate-gate preflight is available to detect target drift before another attempt is authorized.",
      mode: executable ? "execute" : "preflight-only",
      configuration,
    };
  }
  if (!configuration.statuses.includes(task.status)) {
    return deny(`Task cannot run ${action} while it is ${task.status}.`);
  }
  if (task.status === "blocked" || allowanceExhausted) {
    return deny(`The ${effectiveStage} stage has exhausted its retry allowance.`, "retry-exhausted");
  }
  return { allowed: true, reason: null, mode: "execute", configuration };
}
