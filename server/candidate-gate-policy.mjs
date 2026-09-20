// Development Review inspects the candidate fresh, with no structured harness evidence to
// lean on, so it gets the highest ceiling. Test and Final Review already receive structured,
// candidate-bound evidence (verification results, prior gate artifacts) and need fewer
// commands to confirm it, so they keep a lower ceiling.
//
// These are cost ceilings, not correctness boundaries: exceeding one aborts the run and
// fails the stage, so a ceiling set below what the gate actually needs converts ordinary
// reviews into operator retries. Measured against the recorded task store, `test: 2` and
// `final-review: 2` were the single largest source of stage failures in the harness — 51 of
// 280 recorded `Stage failed` events were a command-budget abort, and 39 of those were
// Focused Test alone. The old value also made the instruction below incoherent: at limit 2
// it asked the reviewer to plan within 1 command while reserving 2, a budget of 3 against a
// hard stop of 2. Every ceiling now leaves a real planning allowance after the 2 reserved
// follow-up commands.
export const CANDIDATE_GATE_COMMAND_LIMITS = Object.freeze({
  "dev-review": 14,
  test: 6,
  "final-review": 6,
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
