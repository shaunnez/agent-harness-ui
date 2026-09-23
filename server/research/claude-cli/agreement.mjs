// Three-run agreement, computed exactly as `18f-build-review.py` computes it.
//
// This is the verification the 90 recorded runs actually used: run each scenario three times
// and compare the bands. It is not a model judging a model. That distinction matters here
// specifically — PR #101 merged a fix for a scorecard whose gate pass rate rewarded a laxer
// reviewer, because the gates were themselves model runs. Nothing in this file asks a model
// anything; it is arithmetic over numbers the runs already produced.
//
// The thresholds are the recorded ones and are not tuned. If a port does not reproduce the
// recorded counts, the port is wrong; moving these numbers until it matches would destroy the
// only evidence that the port is faithful.

/** max(low)/min(low) across the runs that produced a band. */
export const TIGHT_LOW_RATIO = 1.25;
/** max(high)/min(high). Looser than the low ratio because the high end absorbs the scope's
 *  optional inclusions, and the recorded thresholds are the ones the 18-of-28 count came from. */
export const TIGHT_HIGH_RATIO = 1.35;

/**
 * Agreement over one scenario's runs.
 *
 * `runs` is an array of `{ run, band }`, where `band` is `{ low, high, unit, centre, basis }`
 * or null. A run whose band is null is counted in `runsTotal` and excluded from the ratios:
 * "two of three runs found a band, and they agree" is a different statement from "three runs
 * agree", and collapsing them would overstate reproducibility.
 *
 * Consensus is the median of the lows and the median of the highs, taken independently. That
 * is what `18f-build-review.py` does. It can produce a consensus pair that no single run
 * proposed, which is correct for a band — the ends are separate estimates, not a unit.
 *
 * A run that carries a `status` other than `completed` makes the whole scenario `incomplete`,
 * never `not_established`. Those are opposite claims: "three runs researched this and no
 * defensible band exists" is a finding, and "the runs died" is an absence of one. The first
 * live exit test scored five crashed scenarios as `not_established`, and one of them is a
 * scenario the exit test requires to produce no band — so it passed its check by never having
 * run. Entries with no `status` at all are the recorded baseline's `{run, band}` rows, which
 * predate this field and are all completed runs by construction.
 */
export function agreementForRuns(runs) {
  const banded = runs.filter((entry) => entry.band && entry.band.low != null && entry.band.high != null);
  const lows = banded.map((entry) => Number(entry.band.low));
  const highs = banded.map((entry) => Number(entry.band.high));
  const failed = failedRunsIn(runs);
  if (failed.length)
    return {
      status: "incomplete",
      range: null,
      consensus: null,
      failedRuns: failed,
      agreement: {
        lowRatio: null,
        highRatio: null,
        runsWithBand: banded.length,
        runsTotal: runs.length,
      },
    };
  if (!banded.length)
    return {
      status: "not_established",
      range: null,
      consensus: null,
      failedRuns: [],
      agreement: { lowRatio: null, highRatio: null, runsWithBand: 0, runsTotal: runs.length },
    };
  const lowRatio = Math.max(...lows) / Math.min(...lows);
  const highRatio = Math.max(...highs) / Math.min(...highs);
  return {
    status: lowRatio <= TIGHT_LOW_RATIO && highRatio <= TIGHT_HIGH_RATIO ? "agreed" : "disputed",
    failedRuns: [],
    range: { min: Math.min(...lows), max: Math.max(...highs) },
    consensus: { low: round2(median(lows)), high: round2(median(highs)) },
    agreement: {
      lowRatio: round3(lowRatio),
      highRatio: round3(highRatio),
      runsWithBand: banded.length,
      runsTotal: runs.length,
    },
    unit: banded[0].band.unit ?? null,
    centre: banded[0].band.centre ?? "Auckland",
    basis: banded[0].band.basis ?? null,
  };
}

/** Roll a set of per-scenario agreement records up into the counts phase 1's exit test checks:
 *  how many scenarios produced a band, and how many of those agree tightly.
 *
 *  `withBand` counts `agreed` and `disputed` by name rather than everything that is not
 *  `not_established`, so an `incomplete` scenario cannot be counted as having produced one. */
export function agreementCounts(records) {
  const count = (status) => records.filter((record) => record.status === status).length;
  return {
    scenarios: records.length,
    agreed: count("agreed"),
    disputed: count("disputed"),
    notEstablished: count("not_established"),
    incomplete: count("incomplete"),
    withBand: count("agreed") + count("disputed"),
  };
}

/** The runs that did not complete, named. A run with no `status` field is a recorded-baseline
 *  row rather than a live run, and is not evidence of a failure. */
function failedRunsIn(runs) {
  return runs
    .filter((entry) => entry.status != null && entry.status !== "completed")
    .map((entry) => ({
      run: entry.run ?? entry.runId ?? null,
      status: entry.status,
      errorCode: entry.error?.code ?? null,
    }));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
