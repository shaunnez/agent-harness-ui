// What a finished question may send back to a tender (`30-EVAL-RESULT.md`): Confident, a wide
// estimate within 35%, no price, or review, with the median best band. Pure: no runs, no models.

import assert from "node:assert/strict";
import test from "node:test";
import { gradeQuestion, WIDE_ESTIMATE_RATIO } from "../server/research/research-question-grade.mjs";

const checked = (low, high, basis = "qv") => ({
  basis,
  low,
  high,
  check: basis === "allowance" ? "allowance" : "qv-found",
});
const run = (low, high, components = [checked(low, high)]) => ({
  status: "completed",
  low,
  high,
  components,
});

test("agreed runs with every source checked are confident, with the median of lows and highs", () => {
  const grading = gradeQuestion({
    status: "agreed",
    unitsDiffer: null,
    runs: [run(100, 150), run(110, 160), run(90, 170)],
  });
  assert.equal(grading.grade, "confident");
  assert.equal(grading.label, "Confident");
  assert.deepEqual(grading.bestBand, { low: 100, high: 160 });
  assert.deepEqual(grading.range, { low: 90, high: 170 });
  assert.deepEqual(grading.reasons, []);
});

test("an unchecked source or heavy allowances keep an agreed question in review", () => {
  const unchecked = run(100, 150, [{ basis: "web", low: 100, high: 150, check: "web-unverified" }]);
  const review = gradeQuestion({
    status: "agreed",
    unitsDiffer: null,
    runs: [run(100, 150), run(100, 150), unchecked],
  });
  assert.equal(review.grade, "review");
  assert.equal(review.bestBand, null);
  assert.match(review.reasons.join(" "), /did not check out/);

  const heavy = run(100, 150, [checked(50, 70), checked(50, 80, "allowance")]);
  const allowances = gradeQuestion({
    status: "agreed",
    unitsDiffer: null,
    runs: [run(100, 150), run(100, 150), heavy],
  });
  assert.equal(allowances.grade, "review");
  assert.match(allowances.reasons.join(" "), /Allowances/);
});

test("disputed runs whose middles are within 35% are a wide estimate; wider ones need review", () => {
  assert.equal(WIDE_ESTIMATE_RATIO, 1.35);
  // Middles 125, 150 and 165: 1.32x apart.
  const wide = gradeQuestion({
    status: "disputed",
    unitsDiffer: null,
    runs: [run(100, 150), run(120, 180), run(150, 180)],
  });
  assert.equal(wide.grade, "unsure");
  assert.equal(wide.label, "Wide estimate");
  assert.deepEqual(wide.bestBand, { low: 120, high: 180 });
  assert.deepEqual(wide.range, { low: 100, high: 180 });

  // Middles 125 and 200: 60% apart.
  const far = gradeQuestion({
    status: "disputed",
    unitsDiffer: null,
    runs: [run(100, 150), run(150, 250), run(110, 160)],
  });
  assert.equal(far.grade, "review");
  assert.match(far.reasons.join(" "), /60% apart/);

  const units = gradeQuestion({
    status: "disputed",
    unitsDiffer: ["m2", "each"],
    runs: [run(100, 150), run(110, 160), run(100, 150)],
  });
  assert.equal(units.grade, "review");
  assert.match(units.reasons.join(" "), /different measures/);
});

test("no band anywhere is no price; a missing band, a failed run or one run is review", () => {
  const empty = { status: "completed", low: null, high: null, components: [] };
  assert.equal(
    gradeQuestion({ status: "not_established", unitsDiffer: null, runs: [empty, empty, empty] }).grade,
    "no_price",
  );

  const lone = gradeQuestion({ status: "disputed", unitsDiffer: null, runs: [run(100, 150), empty, empty] });
  assert.equal(lone.grade, "review");
  assert.match(lone.reasons.join(" "), /Not every run produced a price/);

  const failed = gradeQuestion({
    status: "incomplete",
    unitsDiffer: null,
    runs: [run(100, 150), run(100, 150), { status: "failed", low: null, high: null, components: [] }],
  });
  assert.equal(failed.grade, "review");
  assert.match(failed.reasons.join(" "), /did not finish/);

  const single = gradeQuestion({ status: "single_run", unitsDiffer: null, runs: [run(100, 150)] });
  assert.equal(single.grade, "review");
  assert.match(single.reasons.join(" "), /One run/);

  assert.equal(gradeQuestion({ status: "running", unitsDiffer: null, runs: [] }), null);
});
