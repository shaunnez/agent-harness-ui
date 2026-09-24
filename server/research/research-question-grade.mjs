// What a finished question may send back to a tender, decided in code from its runs
// (`research-agent-deepagents-spike-pack/30-EVAL-RESULT.md`, Shaun, 24 September):
//
//   | Grade      | Rule                                                              | Goes back                     |
//   |------------|-------------------------------------------------------------------|-------------------------------|
//   | confident  | agreed, every component checked, allowances < 1/3 of each run      | the best band                 |
//   | unsure     | disputed, every run priced in one measure, midpoints within 35%,   | the best band and full range, |
//   |            | every component checked                                            | flagged "wide estimate"       |
//   | no_price   | every run finished and none produced a band                        | "not established"             |
//   | review     | anything else                                                      | nothing automatic             |
//
// The best band is the median of the runs' lows and the median of their highs, taken separately.
// Derived, like the status, and left out of the evidence fingerprint: the same runs always grade
// the same way, and adding the grade must not make a standing review stale.

/** The "wide estimate" tolerance on run midpoints: 35%, matching the agreement rule's own 1.35x
 *  on high ends. Five answers and a cross-arm proxy set it; calibrate it on real bids. */
export const WIDE_ESTIMATE_RATIO = 1.35;

/** Above this share of a run's priced total, allowances are judgement rather than sources. */
export const MAX_ALLOWANCE_SHARE = 1 / 3;

const CHECKED = new Set(["qv-found", "web-verified", "allowance"]);

const LABELS = {
  confident: "Confident",
  unsure: "Wide estimate",
  no_price: "No price",
  review: "Needs review",
};

/** `record` is a question record without its grade: `status`, `unitsDiffer` and `runs`, each run
 *  with `status`, `low`, `high` and `components` (`basis`, `low`, `high`, `check`). */
export function gradeQuestion(record) {
  if (record.status === "running" || record.status === "queued") return null;
  const runs = record.runs ?? [];
  const banded = runs.filter((run) => run.low != null && run.high != null);
  if (runs.length && runs.every((run) => run.status === "completed") && !banded.length)
    return graded("no_price", null, null, []);
  const best = banded.length
    ? { low: median(banded.map((run) => run.low)), high: median(banded.map((run) => run.high)) }
    : null;
  const range = banded.length
    ? { low: Math.min(...banded.map((run) => run.low)), high: Math.max(...banded.map((run) => run.high)) }
    : null;
  const reasons = [];
  if (runs.some((run) => run.status !== "completed")) reasons.push("A run did not finish.");
  if (runs.length < 2) reasons.push("One run, not cross-checked.");
  const checked = runs.every(
    (run) => run.components?.length && run.components.every((item) => CHECKED.has(item.check)),
  );
  if (!checked) reasons.push("A source did not check out.");
  const heavy = runs.some((run) => allowanceShare(run.components) >= MAX_ALLOWANCE_SHARE);
  if (heavy) reasons.push("Allowances carry a third or more of a run.");
  if (!reasons.length && record.status === "agreed") return graded("confident", best, range, []);

  const mids = banded.map((run) => (run.low + run.high) / 2);
  const spread = mids.length && Math.min(...mids) > 0 ? Math.max(...mids) / Math.min(...mids) : null;
  if (banded.length < runs.length) reasons.push("Not every run produced a price.");
  if (record.unitsDiffer) reasons.push("The runs priced in different measures.");
  if (spread != null && spread > WIDE_ESTIMATE_RATIO)
    reasons.push(`The runs' middles are ${Math.round((spread - 1) * 100)}% apart.`);
  if (!reasons.length && record.status === "disputed") return graded("unsure", best, range, []);
  return graded("review", null, range, reasons.length ? reasons : [`The question is ${record.status}.`]);
}

function graded(grade, bestBand, range, reasons) {
  return {
    grade,
    label: LABELS[grade],
    // Only a grade that goes back to a tender carries a best band.
    bestBand: grade === "confident" || grade === "unsure" ? bestBand : null,
    range,
    reasons,
  };
}

function allowanceShare(components) {
  let total = 0;
  let allowance = 0;
  for (const item of components ?? []) {
    if (item.low == null || item.high == null) continue;
    const mid = Math.abs((Number(item.low) + Number(item.high)) / 2);
    total += mid;
    if (item.basis === "allowance") allowance += mid;
  }
  return total ? allowance / total : 0;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
