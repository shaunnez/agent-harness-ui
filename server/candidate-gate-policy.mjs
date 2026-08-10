import { CANDIDATE_GATE_STAGES } from "./run-activity.mjs";

export const CANDIDATE_GATE_COMMAND_LIMIT = 4;

export function candidateGateCommandLimit(stageId) {
  return CANDIDATE_GATE_STAGES.includes(stageId) ? CANDIDATE_GATE_COMMAND_LIMIT : null;
}

export function candidateGateCommandInstruction(stageId) {
  const limit = candidateGateCommandLimit(stageId);
  return limit == null
    ? ""
    : "Use at most four targeted repository commands for read-only source inspection. Every command must be constructed to exit zero when the intended inspection succeeds: verify file paths before passing them to search tools, and use an explicit no-match allowance such as `rg ... || true` only when finding nothing is a valid result. A non-zero diagnostic command invalidates an otherwise-PASS review and consumes a bounded same-candidate retry; it never proves a candidate defect.";
}
