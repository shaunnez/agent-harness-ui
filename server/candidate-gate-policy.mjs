// Development Review inspects the candidate fresh, with no structured harness evidence to
// lean on, so it gets a materially higher ceiling. Test and Final Review already receive
// structured, candidate-bound evidence (verification results, prior gate artifacts) and only
// need a couple of commands to confirm it, so they keep a tight ceiling.
export const CANDIDATE_GATE_COMMAND_LIMITS = Object.freeze({
  "dev-review": 10,
  test: 2,
  "final-review": 2,
});

export function candidateGateCommandLimit(stageId) {
  return CANDIDATE_GATE_COMMAND_LIMITS[stageId] ?? null;
}

export function candidateGateCommandInstruction(stageId) {
  const limit = candidateGateCommandLimit(stageId);
  return limit == null
    ? ""
    : `Use at most ${limit} targeted repository commands for read-only source inspection. Every command must be constructed to exit zero when the intended inspection succeeds: verify file paths before passing them to search tools, and use an explicit no-match allowance such as \`rg ... || true\` only when finding nothing is a valid result. A non-zero diagnostic command invalidates an otherwise-PASS review and consumes a bounded same-candidate retry; it never proves a candidate defect.`;
}
