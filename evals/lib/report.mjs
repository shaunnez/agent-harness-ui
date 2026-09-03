// Campaign report (WP5, docs/model-evaluation-plan.md section 5): reads a completed campaign's
// `manifest.json` (WP3, `evals/lib/campaign.mjs`), `judge/*.json` (WP4, per-candidate blind
// scores), `variant-map.json`, and the live `GET /api/evaluations/summary`, and renders the
// five sections section 5's WP5 entry names in order: completion, per-role swap versus
// baseline, per case, confounds, and a recommendation table built from section 6.2's decision
// rules. `report.mjs` is a pure function of its inputs so it can be exercised against a
// constructed fixture manifest with no live campaign or judge run required (WP4 has not landed
// yet; a run with no `judge/<label>.json` simply carries no blind-score data instead of
// crashing, per section 5's own "Done when").
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// Section 5, WP4: the three gates whose verdicts feed "first-pass gate rate".
const GATE_STAGES = ["dev-review", "test", "final-review"];
// Section 5, WP3 step 4: the only "the harness finished this run" terminal status. Every other
// terminal status (`blocked`, `failed`, `cancelled`, `timeout`) means the run did not finish.
const FINISHED_STATE = "awaiting-human-approval";

async function readJsonFileOrDefault(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

/** Reads every `judge/<label>.json` into a `Map<label, parsed | null>`. A malformed file (or one
 * that fails to parse) is recorded as `null` rather than thrown — the plan requires a missing or
 * invalid judge file to mean "no blind-score column", never a crash. */
async function loadJudgeOutputs(judgeDir) {
  const byLabel = new Map();
  let entries;
  try {
    entries = await readdir(judgeDir);
  } catch (error) {
    if (error.code === "ENOENT") return byLabel;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const label = entry.slice(0, -".json".length);
    try {
      byLabel.set(label, JSON.parse(await readFile(path.join(judgeDir, entry), "utf8")));
    } catch {
      byLabel.set(label, null);
    }
  }
  return byLabel;
}

/** Reads the three files a campaign directory (`.data/evaluations/<campaignId>/`) holds after
 * WP3 (and, once it has run, WP4). `judge/` may not exist at all yet. */
export async function loadCampaignArtifacts(campaignDir) {
  const manifest = JSON.parse(await readFile(path.join(campaignDir, "manifest.json"), "utf8"));
  const variantMap = await readJsonFileOrDefault(path.join(campaignDir, "variant-map.json"), {});
  const judgeByLabel = await loadJudgeOutputs(path.join(campaignDir, "judge"));
  return { manifest, variantMap, judgeByLabel };
}

function buildSummaryIndex(evaluationSummary) {
  const index = new Map();
  for (const variant of evaluationSummary?.experiments?.variants ?? []) {
    // `server/evaluation.mjs`'s `controlledSummary` groups by `${experiment.groupId}|${experiment.variantId}`,
    // and the runner (WP3) sets `experiment.groupId = kase.caseId`, so this key is exactly
    // `caseId|variantId` — one row per case x variant pair, same as a manifest run.
    index.set(`${variant.groupId}|${variant.variantId}`, variant);
  }
  return index;
}

/** The live summary is the authoritative source once a blind evaluation has been posted
 * (`POST /api/tasks/:id/evaluation`, kind "blind"); `judge/<label>.json` is the fallback so the
 * report still shows a score when the campaign has judge output but nothing has posted it yet
 * (or the live API is unreachable when the report is generated). */
function blindScoreFor(run, { judgeByLabel, summaryIndex }) {
  const fromSummary = summaryIndex.get(`${run.caseId}|${run.variantId}`)?.averageBlindScore;
  if (typeof fromSummary === "number") return fromSummary;
  const judged = run.bundleLabel ? judgeByLabel.get(run.bundleLabel) : null;
  const score = Number(judged?.score);
  return Number.isInteger(score) && score >= 1 && score <= 5 ? score : null;
}

/** Fraction of gate stages that passed on their first recorded attempt, for one run. `run.gates`
 * (built by `buildManifestEntry` in `evals/lib/campaign.mjs`) preserves the chronological order
 * gate artifacts were recorded in, so the first entry per stage is that stage's first attempt. */
function firstPassGateRate(run) {
  const seen = new Set();
  let attempts = 0;
  let passes = 0;
  for (const gate of run.gates ?? []) {
    if (!GATE_STAGES.includes(gate.stage) || seen.has(gate.stage)) continue;
    seen.add(gate.stage);
    attempts += 1;
    if (gate.verdict === "PASS") passes += 1;
  }
  return attempts ? passes / attempts : null;
}

function runMetrics(run, ctx) {
  return {
    caseId: run.caseId,
    variantId: run.variantId,
    taskId: run.taskId,
    terminalState: run.terminalState,
    finished: run.terminalState === FINISHED_STATE,
    blindScore: blindScoreFor(run, ctx),
    repairCount: run.repairCount ?? 0,
    firstPassGateRate: firstPassGateRate(run),
    wallTimeMs: run.wallTimeMs ?? null,
    apiEstimate: run.usage?.cost ?? null,
    outputTokens: run.usage?.outputTokens ?? null,
  };
}

/** The resolved ten-role matrix a variant actually used, read straight off any of its manifest
 * runs rather than recomputed — every run for a variant carries the same matrix. Prefers the
 * matrix the task actually stored (`policyMatrix`) over the one requested, falling back to the
 * requested matrix when a run never reached a point where the task recorded one. */
function canonicalMatrixFor(variantId, runs) {
  const withStored = runs.find((run) => run.variantId === variantId && run.policyMatrix);
  if (withStored) return withStored.policyMatrix;
  const any = runs.find((run) => run.variantId === variantId && run.requestedPolicyMatrix);
  return any?.requestedPolicyMatrix ?? null;
}

function diffRoles(baselineMatrix, variantMatrix) {
  if (!baselineMatrix || !variantMatrix) return [];
  const roles = new Set([...Object.keys(baselineMatrix), ...Object.keys(variantMatrix)]);
  const diffs = [];
  for (const role of [...roles].sort()) {
    const baseline = baselineMatrix[role] ?? null;
    const swapped = variantMatrix[role] ?? null;
    if (JSON.stringify(baseline) !== JSON.stringify(swapped)) diffs.push({ role, baseline, swapped });
  }
  return diffs;
}

function pairsFor(variantId, baselineId, runsByCase) {
  const pairs = [];
  for (const [caseId, byVariant] of runsByCase) {
    const base = byVariant.get(baselineId);
    const swap = byVariant.get(variantId);
    if (!base || !swap) continue;
    pairs.push({ caseId, base, swap, comparable: base.finished && swap.finished });
  }
  return pairs;
}

function average(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

/** Section 5.2: paired differences (swap minus baseline) across every comparable case, averaged
 * per metric. A metric missing on either side of a pair (no blind score, no wall time, ...) is
 * excluded from that metric's average rather than treated as zero. */
function aggregateDeltas(comparablePairs) {
  const blindDeltas = [];
  const gateDeltas = [];
  const repairDeltas = [];
  const wallTimeDeltas = [];
  const apiDeltas = [];
  const outputTokenDeltas = [];
  let repairIncreaseCases = 0;
  for (const { base, swap } of comparablePairs) {
    if (typeof base.blindScore === "number" && typeof swap.blindScore === "number")
      blindDeltas.push(swap.blindScore - base.blindScore);
    if (typeof base.firstPassGateRate === "number" && typeof swap.firstPassGateRate === "number")
      gateDeltas.push(swap.firstPassGateRate - base.firstPassGateRate);
    repairDeltas.push(swap.repairCount - base.repairCount);
    if (swap.repairCount > base.repairCount) repairIncreaseCases += 1;
    if (base.wallTimeMs != null && swap.wallTimeMs != null) wallTimeDeltas.push(swap.wallTimeMs - base.wallTimeMs);
    if (base.apiEstimate != null && swap.apiEstimate != null) apiDeltas.push(swap.apiEstimate - base.apiEstimate);
    if (base.outputTokens != null && swap.outputTokens != null)
      outputTokenDeltas.push(swap.outputTokens - base.outputTokens);
  }
  return {
    blindScoreDelta: average(blindDeltas),
    blindScoreSamples: blindDeltas.length,
    firstPassGateRateDelta: average(gateDeltas),
    repairCountDelta: average(repairDeltas),
    repairIncreaseCases,
    wallTimeMsDelta: average(wallTimeDeltas),
    wallTimeBaselineAvg: average(comparablePairs.map((pair) => pair.base.wallTimeMs)),
    apiEstimateDelta: average(apiDeltas),
    apiEstimateBaselineAvg: average(comparablePairs.map((pair) => pair.base.apiEstimate)),
    outputTokensDelta: average(outputTokenDeltas),
  };
}

/** Section 6.2's decision rules, applied exactly. Rejection is checked first and applies
 * "regardless of cost"; everything else needs at least four comparable pairs plus every floor
 * check plus at least one win to be a candidate to adopt. */
function classifySwap({ comparableCount, deltas }) {
  const {
    blindScoreDelta,
    firstPassGateRateDelta,
    repairCountDelta,
    repairIncreaseCases,
    wallTimeMsDelta,
    wallTimeBaselineAvg,
    apiEstimateDelta,
    apiEstimateBaselineAvg,
  } = deltas;

  const blindDropsHalfPointOrMore = blindScoreDelta != null && blindScoreDelta <= -0.5;
  const repairRisesOnMoreThanOneCase = repairIncreaseCases > 1;
  if (blindDropsHalfPointOrMore || repairRisesOnMoreThanOneCase) {
    return {
      action: "rejected",
      reason: blindDropsHalfPointOrMore
        ? `blind score dropped by ${Math.abs(blindScoreDelta).toFixed(2)} on average (>= 0.5)`
        : `repair count rose on ${repairIncreaseCases} cases (more than one)`,
    };
  }

  const isAtLeast20PercentLower = (delta, baselineAvg) =>
    delta != null && baselineAvg != null && baselineAvg !== 0 && delta / baselineAvg <= -0.2;

  const hasEnoughPairs = comparableCount >= 4;
  const blindNotLower = blindScoreDelta == null || blindScoreDelta >= -0.25;
  const gateNotLower = firstPassGateRateDelta == null || firstPassGateRateDelta >= 0;
  const repairNotHigher = repairCountDelta == null || repairCountDelta <= 0;
  const meetsFloor = hasEnoughPairs && blindNotLower && gateNotLower && repairNotHigher;

  const hasWin =
    isAtLeast20PercentLower(apiEstimateDelta, apiEstimateBaselineAvg) ||
    isAtLeast20PercentLower(wallTimeMsDelta, wallTimeBaselineAvg) ||
    (blindScoreDelta != null && blindScoreDelta >= 0.5);

  if (meetsFloor && hasWin) return { action: "adopt", reason: "meets every floor check and at least one win threshold" };
  if (!hasEnoughPairs)
    return { action: "inconclusive", reason: `only ${comparableCount} comparable pair(s); section 6.2 requires at least four` };
  if (!meetsFloor) return { action: "inconclusive", reason: "a floor check (blind score, gate rate, or repair count) failed" };
  return { action: "inconclusive", reason: "no cost, wall-time, or quality win reached the 20%/0.5-point threshold" };
}

function buildCompletion(runs) {
  const rows = runs.map((run) => ({ caseId: run.caseId, variantId: run.variantId, status: run.terminalState }));
  return {
    rows,
    total: runs.length,
    reachedApproval: runs.filter((run) => run.terminalState === FINISHED_STATE).length,
  };
}

function buildPerCase(metrics) {
  const byCase = new Map();
  for (const metric of metrics) {
    if (!byCase.has(metric.caseId)) byCase.set(metric.caseId, []);
    byCase.get(metric.caseId).push(metric);
  }
  return [...byCase.entries()].map(([caseId, variants]) => ({ caseId, variants }));
}

function buildConfounds(runs, perCase, variantMap) {
  const allFailedCases = perCase.filter((entry) => entry.variants.every((v) => !v.finished)).map((entry) => entry.caseId);
  const timeoutRuns = runs
    .filter((run) => run.terminalState === "timeout")
    .map((run) => ({ caseId: run.caseId, variantId: run.variantId, taskId: run.taskId }));
  const policyDriftRuns = runs
    .filter(
      (run) =>
        run.policyMatrix &&
        run.requestedPolicyMatrix &&
        JSON.stringify(run.policyMatrix) !== JSON.stringify(run.requestedPolicyMatrix),
    )
    .map((run) => ({ caseId: run.caseId, variantId: run.variantId, taskId: run.taskId }));
  const variantMapMismatches = runs
    .filter((run) => variantMap[run.taskId] !== run.variantId)
    .map((run) => ({
      caseId: run.caseId,
      variantId: run.variantId,
      taskId: run.taskId,
      recordedAs: variantMap[run.taskId] ?? null,
    }));
  return { allFailedCases, timeoutRuns, policyDriftRuns, variantMapMismatches };
}

/** Section 5's recommendation table: one row per role that any variant swapped, picking the
 * best-classified swap for that role (adopt beats inconclusive beats rejected; ties broken by
 * the higher average blind-score delta). */
function buildRecommendations(perRoleSwap, baselineMatrix) {
  const byRole = new Map();
  for (const swap of perRoleSwap) {
    for (const diff of swap.diffs) {
      const list = byRole.get(diff.role) ?? [];
      list.push({ swap, diff });
      byRole.set(diff.role, list);
    }
  }
  const priority = { adopt: 0, inconclusive: 1, rejected: 2 };
  const recommendations = [];
  for (const [role, entries] of byRole) {
    const [best] = entries.slice().sort((a, b) => {
      const priorityDiff = priority[a.swap.classification.action] - priority[b.swap.classification.action];
      if (priorityDiff !== 0) return priorityDiff;
      const aScore = a.swap.deltas.blindScoreDelta ?? Number.NEGATIVE_INFINITY;
      const bScore = b.swap.deltas.blindScoreDelta ?? Number.NEGATIVE_INFINITY;
      return bScore - aScore;
    });
    recommendations.push({
      role,
      baselineModel: baselineMatrix?.[role]?.model ?? null,
      bestSwapVariantId: best.swap.variantId,
      bestSwapModel: best.diff.swapped?.model ?? null,
      action: best.swap.classification.action,
      reason: best.swap.classification.reason,
      sampleSupportsAction: best.swap.classification.action === "adopt" && best.swap.comparablePairCount >= 4,
    });
  }
  return recommendations.sort((a, b) => a.role.localeCompare(b.role));
}

function fmtScore(value) {
  return typeof value === "number" ? value.toFixed(2) : "n/a";
}
function fmtMs(value) {
  return typeof value === "number" ? `${(value / 1000).toFixed(1)}s` : "n/a";
}
function fmtPct(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "n/a";
}
function fmtCost(value) {
  return typeof value === "number" ? `$${value.toFixed(4)}` : "n/a";
}
function fmtTokens(value) {
  return typeof value === "number" ? String(Math.round(value)) : "n/a";
}
function listOrNone(items) {
  return items.length ? items.join(", ") : "none";
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Model evaluation report: ${report.campaignId}`, "");
  lines.push(
    `Generated ${report.generatedAt}. Suite \`${report.suiteId}\`. Baseline variant: \`${report.baselineId}\`.`,
    "",
  );

  lines.push("## 1. Completion", "");
  lines.push("| Case | Variant | Status |", "| --- | --- | --- |");
  for (const row of report.completion.rows) lines.push(`| ${row.caseId} | ${row.variantId} | ${row.status} |`);
  lines.push(
    "",
    `Reached \`awaiting-human-approval\`: ${report.completion.reachedApproval} / ${report.completion.total}`,
    "",
  );

  lines.push("## 2. Per-role swap versus baseline", "");
  if (!report.perRoleSwap.length) lines.push("No non-baseline variants were run in this campaign.", "");
  for (const swap of report.perRoleSwap) {
    const roleLabel = swap.roles.length ? swap.roles.join(" + ") : "(identical to baseline)";
    const modelLabel = swap.modelsSwappedIn.filter(Boolean).join(" + ") || "n/a";
    lines.push(`### \`${swap.variantId}\` — role: ${roleLabel}, model: ${modelLabel}`, "");
    const notComparableNote = swap.notComparableCases.length
      ? ` (not comparable: ${listOrNone(swap.notComparableCases)})`
      : "";
    lines.push(`Comparable pairs: ${swap.comparablePairCount}${notComparableNote}`, "");
    lines.push("| Metric | Delta vs baseline (swap − baseline) |", "| --- | --- |");
    lines.push(`| Blind score | ${fmtScore(swap.deltas.blindScoreDelta)} (n=${swap.deltas.blindScoreSamples}) |`);
    lines.push(`| First-pass gate rate | ${fmtPct(swap.deltas.firstPassGateRateDelta)} |`);
    lines.push(
      `| Repair count | ${fmtScore(swap.deltas.repairCountDelta)} (rose on ${swap.deltas.repairIncreaseCases} case(s)) |`,
    );
    lines.push(`| Wall time | ${fmtMs(swap.deltas.wallTimeMsDelta)} |`);
    lines.push(`| API estimate | ${fmtCost(swap.deltas.apiEstimateDelta)} |`);
    lines.push(`| Output tokens | ${fmtTokens(swap.deltas.outputTokensDelta)} |`);
    lines.push("", `**Classification: ${swap.classification.action}** — ${swap.classification.reason}`, "");
  }

  lines.push("## 3. Per case", "");
  for (const entry of report.perCase) {
    lines.push(`### ${entry.caseId}`, "");
    lines.push(
      "| Variant | Status | Blind score | Repairs | Wall time | API estimate |",
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const variant of entry.variants) {
      lines.push(
        `| ${variant.variantId} | ${variant.terminalState} | ${variant.blindScore ?? "n/a"} | ${variant.repairCount} | ${fmtMs(variant.wallTimeMs)} | ${fmtCost(variant.apiEstimate)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 4. Confounds", "");
  lines.push(`- Cases where every variant failed to finish: ${listOrNone(report.confounds.allFailedCases)}`);
  lines.push(
    `- Runs marked \`timeout\`: ${listOrNone(report.confounds.timeoutRuns.map((run) => `${run.caseId}/${run.variantId}`))}`,
  );
  lines.push(
    `- Runs where the stored policy matrix differs from the requested variant matrix: ${listOrNone(
      report.confounds.policyDriftRuns.map((run) => `${run.caseId}/${run.variantId}`),
    )}`,
  );
  lines.push(
    `- \`variant-map.json\` inconsistencies: ${listOrNone(
      report.confounds.variantMapMismatches.map(
        (run) => `${run.taskId} (recorded as ${run.recordedAs ?? "missing"}, expected ${run.variantId})`,
      ),
    )}`,
    "",
  );

  lines.push("## 5. Recommendation table", "");
  lines.push(
    "| Role | Baseline model | Best swap | Action | Sample supports action |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const rec of report.recommendations) {
    lines.push(
      `| ${rec.role} | ${rec.baselineModel ?? "n/a"} | ${rec.bestSwapModel ?? "n/a"} (\`${rec.bestSwapVariantId}\`) | ${rec.action} | ${rec.sampleSupportsAction ? "yes" : "no"} |`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Builds the report's data (`report.json`'s shape) and its rendered `report.md` text from a
 * campaign's manifest plus judge output, variant map, and the live evaluations summary.
 * `baselineId` must be supplied by the caller (the CLI's `--baseline` flag): it is not recorded
 * in `manifest.json` itself, only in the variants file the campaign was run with.
 */
export function buildReport({ manifest, judgeByLabel = new Map(), variantMap = {}, evaluationSummary = null, baselineId }) {
  if (!baselineId) throw new Error("buildReport requires a baselineId.");
  const runs = manifest.runs ?? [];
  const summaryIndex = buildSummaryIndex(evaluationSummary);
  const ctx = { judgeByLabel, summaryIndex };
  const metrics = runs.map((run) => runMetrics(run, ctx));

  const runsByCase = new Map();
  for (const metric of metrics) {
    if (!runsByCase.has(metric.caseId)) runsByCase.set(metric.caseId, new Map());
    runsByCase.get(metric.caseId).set(metric.variantId, metric);
  }

  const variantIds = [...new Set(runs.map((run) => run.variantId))];
  const baselineMatrix = canonicalMatrixFor(baselineId, runs);

  const perRoleSwap = variantIds
    .filter((variantId) => variantId !== baselineId)
    .map((variantId) => {
      const variantMatrix = canonicalMatrixFor(variantId, runs);
      const diffs = diffRoles(baselineMatrix, variantMatrix);
      const pairs = pairsFor(variantId, baselineId, runsByCase);
      const comparablePairs = pairs.filter((pair) => pair.comparable);
      const notComparableCases = pairs.filter((pair) => !pair.comparable).map((pair) => pair.caseId);
      const deltas = aggregateDeltas(comparablePairs);
      const classification = classifySwap({ comparableCount: comparablePairs.length, deltas });
      return {
        variantId,
        roles: diffs.map((diff) => diff.role),
        modelsSwappedIn: diffs.map((diff) => diff.swapped?.model ?? null),
        diffs,
        comparablePairCount: comparablePairs.length,
        notComparableCases,
        deltas,
        classification,
      };
    });

  const perCase = buildPerCase(metrics);
  const completion = buildCompletion(runs);
  const confounds = buildConfounds(runs, perCase, variantMap);
  const recommendations = buildRecommendations(perRoleSwap, baselineMatrix);

  const json = {
    campaignId: manifest.campaignId ?? null,
    suiteId: manifest.suiteId ?? null,
    generatedAt: new Date().toISOString(),
    baselineId,
    completion,
    perRoleSwap,
    perCase,
    confounds,
    recommendations,
  };

  return { json, markdown: renderMarkdown(json) };
}
