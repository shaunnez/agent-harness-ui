// A controlled experiment is only decidable when one metric was named before the run and every
// arm was given the same allowance to reach it. Without the declared metric a comparison becomes
// whichever column happens to favour the preferred variant; without the allowance a variant can
// win by spending more wall time or tokens than its rivals were permitted. Both are declared on
// the experiment snapshot at task creation and are therefore frozen alongside the brief, base SHA,
// policy matrix, acceptance criteria and verification commands.

const MAX_WALL_TIME_MS = 24 * 60 * 60 * 1_000;
const MAX_TOTAL_TOKENS = 100_000_000;

function round(value, places = 6) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Every decision metric is derived from evidence the harness already records: gate verdicts,
 * candidate revisions and operator scores. None of them is model-supplied, so a variant cannot
 * report its own win. `direction` states which end of the range is better, because "fewer repairs"
 * and "higher pass rate" cannot share a comparator.
 */
export const DECISION_METRICS = {
  "first-pass-gate-success-rate": {
    label: "First-pass gate success rate",
    direction: "higher",
    describe: "Share of dev-review, test and final-review gates that passed on their first attempt.",
    value: (variant) => (variant.gateAttempts ? variant.firstPassGateSuccessRate : null),
  },
  "eventual-gate-success-rate": {
    label: "Eventual gate success rate",
    direction: "higher",
    describe: "Share of gates that eventually passed, after any permitted repair.",
    value: (variant) => (variant.gateAttempts ? variant.eventualGateSuccessRate : null),
  },
  "repairs-per-task": {
    label: "Repairs per task",
    direction: "lower",
    describe: "Recorded repair revisions divided by the number of tasks in the arm.",
    value: (variant) => (variant.sampleCount ? round(variant.repairCount / variant.sampleCount, 4) : null),
  },
  "average-blind-score": {
    label: "Average blind score",
    direction: "higher",
    describe: "Mean 1-5 blind evaluation score. Requires blind scoring to have been recorded.",
    value: (variant) => variant.averageBlindScore,
  },
  "average-human-score": {
    label: "Average human score",
    direction: "higher",
    describe: "Mean 1-5 operator score. Subjective and rate-limited by operator attention.",
    value: (variant) => variant.averageHumanScore,
  },
};

export const DEFAULT_DECISION_METRIC = "first-pass-gate-success-rate";

export function normalizeDecisionMetric(value) {
  if (value == null) return DEFAULT_DECISION_METRIC;
  const id = String(value).trim();
  if (!Object.hasOwn(DECISION_METRICS, id)) {
    throw new Error(
      `Unknown experiment decision metric "${id}". Choose one of: ${Object.keys(DECISION_METRICS).join(", ")}.`,
    );
  }
  return id;
}

function normalizeCeiling(value, label, maximum) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > maximum)
    throw new Error(`Experiment ${label} must be a positive integer of at most ${maximum}.`);
  return numeric;
}

/**
 * A budget is optional, but when one arm declares it every arm in the group must declare the same
 * one or the comparison is reported as not budget-matched rather than silently ranked.
 */
export function normalizeExperimentBudget(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Experiment budget must be an object.");
  const maxWallTimeMs = normalizeCeiling(value.maxWallTimeMs, "maxWallTimeMs", MAX_WALL_TIME_MS);
  const maxTotalTokens = normalizeCeiling(value.maxTotalTokens, "maxTotalTokens", MAX_TOTAL_TOKENS);
  if (maxWallTimeMs == null && maxTotalTokens == null)
    throw new Error("An experiment budget must declare maxWallTimeMs, maxTotalTokens, or both.");
  return { maxWallTimeMs, maxTotalTokens };
}

/**
 * Scoring-time disqualification, not run-time termination. The orchestrator does not abort a task
 * when it crosses a ceiling; this records that it did so the arm can be excluded from the decision
 * while its evidence stays inspectable.
 */
export function classifyTaskBudget(budget, { wallTimeMs, totalTokens }) {
  if (!budget) return { status: "not-declared", exceeded: false, reasons: [] };
  const reasons = [];
  let measured = false;
  if (budget.maxWallTimeMs != null && wallTimeMs != null) {
    measured = true;
    if (wallTimeMs > budget.maxWallTimeMs)
      reasons.push(`wall time ${wallTimeMs}ms exceeded the declared ${budget.maxWallTimeMs}ms ceiling`);
  }
  if (budget.maxTotalTokens != null && totalTokens != null) {
    measured = true;
    if (totalTokens > budget.maxTotalTokens)
      reasons.push(`${totalTokens} tokens exceeded the declared ${budget.maxTotalTokens} token ceiling`);
  }
  if (reasons.length) return { status: "exceeded", exceeded: true, reasons };
  return { status: measured ? "within" : "unmeasured", exceeded: false, reasons: [] };
}

function distinct(values) {
  return [...new Set(values.map((value) => JSON.stringify(value ?? null)))];
}

function comparabilityIssues(variants) {
  const issues = [];
  if (
    variants.some((variant) => variant.decisionMetricDrift) ||
    distinct(variants.map((variant) => variant.decisionMetric)).length > 1
  )
    issues.push("Variants declared different decision metrics.");
  if (variants.some((variant) => variant.budgetDrift))
    issues.push("A variant's own tasks declared different budgets.");
  if (distinct(variants.map((variant) => variant.frozenBaseSha)).length > 1)
    issues.push("Variants ran from different frozen base commits.");
  if (distinct(variants.flatMap((variant) => variant.taskBriefHashes)).length > 1)
    issues.push("Variants ran against different task briefs.");
  if (distinct(variants.flatMap((variant) => variant.acceptanceDefinitions)).length > 1)
    issues.push("Variants used different acceptance criteria.");
  if (distinct(variants.flatMap((variant) => variant.verificationDefinitions)).length > 1)
    issues.push("Variants used different verification commands.");
  if (distinct(variants.map((variant) => variant.budget)).length > 1)
    issues.push("Variants declared different budgets, so the arms were not given equal allowances.");
  return issues;
}

function rank(entries, direction) {
  const sorted = [...entries].sort((left, right) =>
    direction === "higher" ? right.value - left.value : left.value - right.value,
  );
  if (sorted.length < 2) return { leader: null, note: "A leader needs at least two eligible variants." };
  if (sorted[0].value === sorted[1].value)
    return { leader: null, note: "The leading variants tied on the declared decision metric." };
  return { leader: { variantId: sorted[0].variantId, value: sorted[0].value }, note: null };
}

/**
 * Groups the controlled variants by experiment group and names a leader only when the arms are
 * actually comparable. A disqualified or unmeasured arm still appears with its recorded value; it
 * is excluded from the ranking rather than hidden.
 */
export function buildExperimentDecisions(variants) {
  const groups = new Map();
  for (const variant of variants) {
    const group = groups.get(variant.groupId) ?? [];
    group.push(variant);
    groups.set(variant.groupId, group);
  }
  return [...groups.entries()]
    .map(([groupId, members]) => {
      const metricId = members[0].decisionMetric ?? DEFAULT_DECISION_METRIC;
      const metric = DECISION_METRICS[metricId] ?? DECISION_METRICS[DEFAULT_DECISION_METRIC];
      const issues = comparabilityIssues(members);
      const scored = members.map((variant) => {
        const value = metric.value(variant);
        const ineligible =
          variant.sampleCount === 0
            ? "The variant has no recorded tasks."
            : value == null
              ? "The declared decision metric has no recorded value for this variant."
              : variant.budgetStatus === "exceeded"
                ? "The variant exceeded its declared budget."
                : null;
        return {
          variantId: variant.variantId,
          sampleCount: variant.sampleCount,
          value,
          budgetStatus: variant.budgetStatus,
          budgetExceededTaskIds: variant.budgetExceededTaskIds,
          eligible: ineligible == null,
          ineligibleReason: ineligible,
        };
      });
      const eligible = scored.filter((entry) => entry.eligible);
      const ranked = issues.length
        ? { leader: null, note: "The variants are not comparable, so no leader is declared." }
        : rank(eligible, metric.direction);
      return {
        groupId,
        decisionMetric: metricId,
        metricLabel: metric.label,
        metricDescription: metric.describe,
        direction: metric.direction,
        comparable: issues.length === 0,
        comparabilityIssues: issues,
        variants: scored.sort((left, right) => left.variantId.localeCompare(right.variantId)),
        leader: ranked.leader,
        note: ranked.note,
      };
    })
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
}
