// Run the pinned scopes through a research runtime, three times each, and compare the result
// with the recorded baseline.
//
// Shared by phase 1 (one agent) and phase 2 (four roles) so that the two are scored by
// identical arithmetic over identical scopes. If the comparison itself differed between them,
// "four roles beat one agent" would be a statement about two scoreboards rather than about two
// runtimes.
//
// Nothing here asks a model anything. The score is the count of scenarios that produced a
// band, the count that agreed across three runs, and the plan usage — all read off the runs.
// `#101` merged a fix for a scorecard whose gate pass rate rewarded a laxer reviewer because
// the gates were themselves model runs; that mistake is not rebuilt here.

import { agreementCounts } from "../../server/research/claude-cli/agreement.mjs";
import { PLAN_LIMIT_ERROR_CODE } from "../../server/research/claude-cli/cli-call.mjs";
import { runTrio } from "../../server/research/claude-cli/trio.mjs";
import { loadPinnedScopes, loadRecordedBaseline } from "./scopes.mjs";

/** The counts the 90 recorded runs produced, and the two scenarios that correctly produced no
 *  band. A port that does not reproduce these is wrong; the thresholds and these numbers are
 *  not to be tuned to fit a result. */
export const RECORDED_BASELINE = Object.freeze({
  scenarios: 30,
  withBand: 28,
  agreed: 18,
  planUsdPerScenario: 4.97,
  noBandExpected: Object.freeze([
    "network-supply-connection-hv-metering",
    "switchboard-fault-rating-protection",
  ]),
});

/**
 * Drive `runtime` over `scopes`, three runs each.
 *
 * Scenarios are submitted one at a time and their three runs together: the runtime's own
 * concurrency cap decides how many CLI children actually exist at once, and holding the whole
 * batch back to one scenario keeps the queue depth predictable while a long benchmark runs.
 *
 * Stops the moment the claude.ai plan window is exhausted. The quota is not per call, so every
 * remaining scenario would fail the same way, and a benchmark that carried on would spend its
 * remaining wall clock writing $0.00 one-turn failures into a results file that gets read as
 * research. That is what the first live exit test did over its last five scenarios.
 *
 * Returns `{ records, aborted }`, never a bare array: a caller that cannot see the run was cut
 * short will compare 25 scenarios against a 30-scenario baseline and call it a verdict.
 */
export async function runBenchmark({ runtime, scopes, budget, profile = "standard", onProgress = () => {} }) {
  const records = [];
  for (const [index, scope] of scopes.entries()) {
    const startedAt = Date.now();
    const record = await runTrio({
      runtime,
      scenarioId: scope.id,
      objective: scope.objective,
      budget,
      profile,
    });
    records.push({
      ...record,
      recordedKey: scope.recordedKey,
      elapsedMs: Date.now() - startedAt,
      costUsd: sum(record.runs.map((run) => run.costUsd ?? 0)),
    });
    onProgress({ index: index + 1, total: scopes.length, record: records.at(-1) });
    const planLimited = record.runs.find((run) => run.error?.code === PLAN_LIMIT_ERROR_CODE);
    if (planLimited)
      return {
        records,
        aborted: {
          reason: PLAN_LIMIT_ERROR_CODE,
          scenario: scope.id,
          message: planLimited.error.message,
          scenariosRun: records.length,
          scenariosPlanned: scopes.length,
          remaining: scopes.slice(index + 1).map((entry) => entry.id),
        },
      };
  }
  return { records, aborted: null };
}

/** Compare a benchmark run with the recorded baseline, scenario by scenario. */
export async function compareWithBaseline(records) {
  const baseline = await loadRecordedBaseline();
  const counts = agreementCounts(records);
  const scenarios = records.map((record) => {
    const recorded = baseline.get(record.recordedKey) ?? [];
    const recordedBanded = recorded.filter((entry) => entry.band);
    return {
      scenario: record.scenarioId,
      recordedKey: record.recordedKey,
      status: record.status,
      recordedStatus: recordedStatusOf(recordedBanded),
      consensus: record.consensus,
      recordedConsensus: consensusOf(recordedBanded),
      runsWithBand: record.agreement.runsWithBand,
      recordedRunsWithBand: recordedBanded.length,
      // Named rather than counted, so a reader of the report can tell a scenario that was
      // researched and found nothing from one whose runs died.
      failedRuns: record.failedRuns ?? [],
      costUsd: round2(record.costUsd),
      recordedCostUsd: round2(sum(recorded.map((entry) => entry.costUsd ?? 0))),
    };
  });
  return {
    counts,
    baseline: RECORDED_BASELINE,
    planUsd: round2(sum(records.map((record) => record.costUsd ?? 0))),
    planUsdPerScenario: records.length ? round2(sum(records.map((r) => r.costUsd ?? 0)) / records.length) : 0,
    scenarios,
    // Status bucket agreement is the thing that must reproduce. Consensus values will not match
    // to the cent — these are model runs — so they are reported for a reader and never asserted.
    statusMatches: scenarios.filter((entry) => entry.status === entry.recordedStatus).length,
  };
}

/**
 * The phase 1 exit test, as stated: 28 of 30 with a band, 18 of those tight, and the two named
 * scenarios producing no band.
 *
 * Only meaningful over the full set, and only when all of it actually ran. A partial run
 * reports `applicable: false` rather than a verdict, because "18 agreed" out of three scenarios
 * is not a weaker version of the exit test, it is a different claim. A scenario whose runs
 * failed is refused for the same reason and more sharply: the test's third check is that two
 * named scenarios produce no band, and a scenario that crashed produces no band too. Scoring
 * the crash would let the port pass or fail its load-bearing check without being exercised.
 */
export function evaluateExitTest(comparison, { scenariosRun }) {
  if (scenariosRun !== RECORDED_BASELINE.scenarios)
    return {
      applicable: false,
      passed: null,
      reason: `The exit test is defined over all ${RECORDED_BASELINE.scenarios} pinned scopes; this run covered ${scenariosRun}.`,
    };
  const incomplete = comparison.scenarios
    .filter((entry) => entry.status === "incomplete")
    .map((entry) => entry.scenario);
  if (incomplete.length)
    return {
      applicable: false,
      passed: null,
      incomplete,
      reason:
        `${incomplete.length} scenario(s) did not complete all three runs, so they are not evidence ` +
        `either way: ${incomplete.join(", ")}. Re-run those scenarios and merge before scoring.`,
    };
  const noBand = comparison.scenarios
    .filter((entry) => entry.status === "not_established")
    .map((entry) => entry.scenario)
    .sort();
  const checks = [
    {
      name: "scenarios with a cost band",
      expected: RECORDED_BASELINE.withBand,
      actual: comparison.counts.withBand,
      passed: comparison.counts.withBand === RECORDED_BASELINE.withBand,
    },
    {
      name: "three-run agreement within 1.25x low and 1.35x high",
      expected: RECORDED_BASELINE.agreed,
      actual: comparison.counts.agreed,
      passed: comparison.counts.agreed === RECORDED_BASELINE.agreed,
    },
    {
      name: "the two scenarios that correctly produce no band",
      expected: [...RECORDED_BASELINE.noBandExpected].sort().join(", "),
      actual: noBand.join(", ") || "none",
      passed: noBand.join(",") === [...RECORDED_BASELINE.noBandExpected].sort().join(","),
    },
  ];
  return { applicable: true, passed: checks.every((check) => check.passed), checks };
}

export { loadPinnedScopes };

function recordedStatusOf(banded) {
  if (!banded.length) return "not_established";
  const lows = banded.map((entry) => Number(entry.band.low));
  const highs = banded.map((entry) => Number(entry.band.high));
  return Math.max(...lows) / Math.min(...lows) <= 1.25 && Math.max(...highs) / Math.min(...highs) <= 1.35
    ? "agreed"
    : "disputed";
}

function consensusOf(banded) {
  if (!banded.length) return null;
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  return {
    low: round2(median(banded.map((entry) => Number(entry.band.low)))),
    high: round2(median(banded.map((entry) => Number(entry.band.high)))),
  };
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
