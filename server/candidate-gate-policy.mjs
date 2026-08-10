import { CANDIDATE_GATE_STAGES } from "./run-activity.mjs";

export const CANDIDATE_GATE_COMMAND_LIMIT = 4;

export function candidateGateCommandLimit(stageId) {
  return CANDIDATE_GATE_STAGES.includes(stageId) ? CANDIDATE_GATE_COMMAND_LIMIT : null;
}

export function candidateGateCommandInstruction(stageId) {
  const limit = candidateGateCommandLimit(stageId);
  return limit == null
    ? ""
    : "Use at most four targeted repository commands for read-only source inspection.";
}
