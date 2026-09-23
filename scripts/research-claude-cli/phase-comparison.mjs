// One agent versus four roles, decided on the output.
//
// The decision rule is written down before either phase runs, so that whichever way the
// numbers fall, the answer is not chosen after seeing them. It is deliberately biased toward
// the simpler structure: four roles cost four CLI calls per run and a day to build, so they
// have to earn their place, and a tie goes to one agent.
//
// Nothing here consults a model. Every input is a count taken off runs that already happened.

/** Coverage and reproducibility must not go backwards. A structure that finds fewer bands, or
 *  reproduces less well, has lost regardless of what else it does. */
const REGRESSION_TOLERANCE = 0;

/** Four roles must beat one agent by more than noise. One scenario either way, over thirty, is
 *  noise — these are model runs — so a win has to be at least this many scenarios. */
const MEANINGFUL_MARGIN = 2;

/**
 * Compare two `compareWithBaseline` outputs plus the verifier summary.
 *
 * Returns a winner and the reasons, not a score. A single blended number would let a large win
 * on cost hide a regression in coverage, and coverage is the thing the whole exercise is for.
 */
export function comparePhases({ phase1, phase2, verifier, scenariosRun = null, requiredScenarios = 30 }) {
  if (!phase1) return null;
  // A verdict over a handful of scenarios is noise wearing a decision's clothes. One scenario
  // either way is well inside the run-to-run variation these are made of, so a partial run
  // reports the numbers and declines to name a winner.
  if (scenariosRun != null && scenariosRun !== requiredScenarios)
    return {
      winner: null,
      applicable: false,
      reason: `A verdict needs all ${requiredScenarios} pinned scopes; this run covered ${scenariosRun}.`,
      reasons: [],
    };
  // A scenario whose runs failed is not a datum for either side. Counting it would let a quota
  // wall during one phase's run decide which structure "won".
  const incomplete = (phase1.counts.incomplete ?? 0) + (phase2.counts.incomplete ?? 0);
  if (incomplete)
    return {
      winner: null,
      applicable: false,
      reason:
        `${incomplete} scenario(s) across the two phases did not complete all three runs. ` +
        "Re-run them and merge before comparing; a failed run is not evidence for either structure.",
      reasons: [],
    };
  const reasons = [];
  const bandDelta = phase2.counts.withBand - phase1.counts.withBand;
  const agreedDelta = phase2.counts.agreed - phase1.counts.agreed;
  const costDelta = phase2.planUsdPerScenario - phase1.planUsdPerScenario;

  reasons.push(
    `bands: ${phase2.counts.withBand} vs ${phase1.counts.withBand} (${signed(bandDelta)})`,
    `agreement: ${phase2.counts.agreed} vs ${phase1.counts.agreed} (${signed(agreedDelta)})`,
    `plan usage per scenario: $${phase2.planUsdPerScenario} vs $${phase1.planUsdPerScenario} (${signed(costDelta, 2)})`,
    `verifier challenged ${verifier.challenged} components and removed ${verifier.netComponentsRemoved} ` +
      `(${verifier.missingByName} missing by name, the rest relabelled), ` +
      `changing nothing on ${verifier.runsWithNoChallenge} of ${verifier.runs} runs`,
  );

  if (bandDelta < -REGRESSION_TOLERANCE || agreedDelta < -REGRESSION_TOLERANCE) {
    reasons.push(
      "four roles found fewer bands or reproduced less well, which no cost or verifier gain redeems",
    );
    return { winner: "one agent", reasons, bandDelta, agreedDelta, costDelta };
  }
  if (bandDelta >= MEANINGFUL_MARGIN || agreedDelta >= MEANINGFUL_MARGIN)
    return { winner: "four roles", reasons, bandDelta, agreedDelta, costDelta };
  if (verifier.netComponentsRemoved > 0 && agreedDelta >= 0 && bandDelta >= 0) {
    // The verifier is only worth its call if it actually removed something AND the run did not
    // get worse for it. Challenges the synthesiser ignored are not a benefit; they are four
    // roles' worth of cost spent on a note nobody acted on. `netComponentsRemoved` rather than
    // a name-set difference: the synthesiser rewords labels, and counting a relabelled
    // component as removed would credit the verifier for the synthesiser's prose.
    reasons.push("the verifier removed components without costing coverage or reproducibility");
    return { winner: "four roles", reasons, bandDelta, agreedDelta, costDelta };
  }
  reasons.push(
    "four roles did not beat one agent by more than noise, and a tie goes to the simpler structure",
  );
  return { winner: "one agent", reasons, bandDelta, agreedDelta, costDelta };
}

function signed(value, digits = 0) {
  const rounded = Number(value).toFixed(digits);
  return Number(rounded) > 0 ? `+${rounded}` : String(rounded);
}
