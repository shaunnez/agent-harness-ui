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
    : `You have a hard limit of ${limit} repository-command invocations. Before using tools, plan the complete inspection within ${Math.max(1, limit - 2)} commands and reserve 2 commands for unexpected follow-up. Start with one command that reads the complete candidate diff and stat. Inspect only changed files and directly relevant surrounding contracts; do not inventory or broadly search the repository. Reuse the supplied specification, plan, package qualification, and candidate metadata. After command ${Math.max(1, limit - 2)}, stop using repository tools and produce the best evidence-bound verdict available. Never start command ${limit + 1}. Every command must be constructed to exit zero when the intended inspection succeeds: verify file paths before passing them to search tools, and use an explicit no-match allowance such as \`rg ... || true\` only when finding nothing is a valid result. Insufficient source evidence is a non-blocking verification gap unless a concrete candidate defect has already been established. A non-zero diagnostic command invalidates an otherwise-PASS review and consumes a bounded same-candidate retry; it never proves a candidate defect.`;
}
