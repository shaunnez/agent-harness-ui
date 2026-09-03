import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReport, loadCampaignArtifacts } from "../evals/lib/report.mjs";

// WP5 (docs/model-evaluation-plan.md section 5): the report is a pure function of a campaign's
// manifest, judge output, variant map, and the live evaluations summary, so it is exercised here
// against a constructed fixture manifest shaped exactly like `buildManifestEntry` in
// `evals/lib/campaign.mjs` (WP3) produces — no live campaign, judge run (WP4 has not landed
// yet), or server required.

const BASELINE_ID = "codex-hybrid";

const BASELINE_MATRIX = {
  triage: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  scouts: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  grill: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  specification: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  plan: { model: "gpt-5.6-sol", reasoning: "high" },
  implement: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  repair: { model: "gpt-5.6-sol", reasoning: "high" },
  "dev-review": { model: "gpt-5.6-sol", reasoning: "high" },
  test: { model: "gpt-5.6-luna", reasoning: "xhigh" },
  "final-review": { model: "gpt-5.6-luna", reasoning: "medium" },
};

function withOverride(role, policy) {
  return { ...BASELINE_MATRIX, [role]: policy };
}

const IMPLEMENT_OPUS_MATRIX = withOverride("implement", { model: "claude-opus-5", reasoning: "high" });
const PLAN_SONNET_MATRIX = withOverride("plan", { model: "claude-sonnet-5", reasoning: "xhigh" });
const TEST_FAST_MATRIX = withOverride("test", { model: "gpt-5.6-luna", reasoning: "medium" });
const REPAIR_PRONE_MATRIX = withOverride("dev-review", { model: "claude-haiku-5", reasoning: "low" });

const GATE_STAGES = ["dev-review", "test", "final-review"];

function makeGates(verdicts) {
  return verdicts.map((verdict, index) => ({
    stage: GATE_STAGES[index],
    verdict,
    candidateRevision: 1,
    evaluatedAt: "2026-09-03T00:00:00.000Z",
  }));
}

let taskCounter = 0;
function nextTaskId() {
  taskCounter += 1;
  return `AH-${String(taskCounter).padStart(3, "0")}`;
}

/** Builds one manifest run entry, matching `buildManifestEntry` (evals/lib/campaign.mjs) exactly. */
function makeRun({
  caseId,
  variantId,
  terminalState,
  matrix,
  requestedMatrix = matrix,
  repairCount = 0,
  gateVerdicts = ["PASS", "PASS", "PASS"],
  wallTimeMs = null,
  cost = null,
  outputTokens = null,
  bundleLabel = null,
  taskId = nextTaskId(),
}) {
  return {
    caseId,
    variantId,
    taskId,
    terminalState,
    finalStatus: terminalState,
    finalStage: "final-review",
    workPackageCount: 1,
    attemptsByStage: {},
    repairCount,
    gates: makeGates(gateVerdicts),
    usage: wallTimeMs == null && cost == null && outputTokens == null ? null : { inputTokens: 100, cachedInputTokens: 0, outputTokens, cost, credits: null },
    wallTimeMs,
    requestedPolicyMatrix: requestedMatrix,
    policyMatrix: matrix,
    candidate: bundleLabel ? { id: "c1", revisionNumber: 1, headRevision: "deadbeef", status: "ready" } : null,
    bundleLabel,
    runnerApprovals: [],
    recordedAt: "2026-09-03T00:00:00.000Z",
  };
}

function buildFixtureManifest() {
  const runs = [];

  // --- "implement-opus" (role: implement): 4 comparable pairs, a clean adopt. ---
  for (const caseId of ["c1", "c2", "c3", "c4"]) {
    runs.push(
      makeRun({
        caseId,
        variantId: BASELINE_ID,
        terminalState: "awaiting-human-approval",
        matrix: BASELINE_MATRIX,
        repairCount: 0,
        wallTimeMs: 100_000,
        cost: 1.0,
        outputTokens: 1000,
        bundleLabel: `${caseId}-base`,
      }),
    );
    runs.push(
      makeRun({
        caseId,
        variantId: "implement-opus",
        terminalState: "awaiting-human-approval",
        matrix: IMPLEMENT_OPUS_MATRIX,
        repairCount: 0,
        wallTimeMs: 70_000, // 30% lower: satisfies the wall-time win threshold
        cost: 0.75, // 25% lower
        outputTokens: 800,
        bundleLabel: `${caseId}-opus`,
      }),
    );
  }

  // --- "plan-sonnet" (role: plan): blind score drops by 1.0 on average -> rejected. ---
  for (const caseId of ["c5", "c6"]) {
    runs.push(
      makeRun({
        caseId,
        variantId: BASELINE_ID,
        terminalState: "awaiting-human-approval",
        matrix: BASELINE_MATRIX,
        wallTimeMs: 100_000,
        cost: 1.0,
        outputTokens: 1000,
        bundleLabel: `${caseId}-base`,
      }),
    );
    runs.push(
      makeRun({
        caseId,
        variantId: "plan-sonnet",
        terminalState: "awaiting-human-approval",
        matrix: PLAN_SONNET_MATRIX,
        wallTimeMs: 90_000, // cheaper and faster ...
        cost: 0.5,
        outputTokens: 700,
        bundleLabel: `${caseId}-sonnet`,
      }),
    );
  }

  // --- "test-fast" (role: test): a single pair, decent numbers, but too few pairs -> inconclusive. ---
  runs.push(
    makeRun({
      caseId: "c7",
      variantId: BASELINE_ID,
      terminalState: "awaiting-human-approval",
      matrix: BASELINE_MATRIX,
      wallTimeMs: 100_000,
      cost: 1.0,
      outputTokens: 1000,
      bundleLabel: "c7-base",
    }),
  );
  runs.push(
    makeRun({
      caseId: "c7",
      variantId: "test-fast",
      terminalState: "awaiting-human-approval",
      matrix: TEST_FAST_MATRIX,
      wallTimeMs: 75_000,
      cost: 0.8,
      outputTokens: 900,
      bundleLabel: "c7-fast",
    }),
  );

  // --- "repair-prone" (role: dev-review): repair count rises on two cases -> rejected, "regardless of cost". ---
  for (const caseId of ["c8", "c9"]) {
    runs.push(
      makeRun({
        caseId,
        variantId: BASELINE_ID,
        terminalState: "awaiting-human-approval",
        matrix: BASELINE_MATRIX,
        repairCount: 0,
        gateVerdicts: ["PASS", "PASS", "PASS"],
        wallTimeMs: 100_000,
        cost: 1.0,
        outputTokens: 1000,
        bundleLabel: `${caseId}-base`,
      }),
    );
    runs.push(
      makeRun({
        caseId,
        variantId: "repair-prone",
        terminalState: "awaiting-human-approval",
        matrix: REPAIR_PRONE_MATRIX,
        repairCount: 1,
        gateVerdicts: ["REPAIR", "PASS", "PASS"], // dev-review failed its first attempt
        wallTimeMs: 80_000, // much cheaper/faster, but must still be rejected
        cost: 0.6,
        outputTokens: 850,
        bundleLabel: `${caseId}-repair-prone`,
      }),
    );
  }

  // --- Confound: a case where every variant fails to finish. ---
  const allFailedTask = nextTaskId();
  runs.push({
    ...makeRun({ caseId: "all-failed-case", variantId: BASELINE_ID, terminalState: "failed", matrix: BASELINE_MATRIX, taskId: allFailedTask }),
  });
  runs.push(
    makeRun({ caseId: "all-failed-case", variantId: "implement-opus", terminalState: "blocked", matrix: IMPLEMENT_OPUS_MATRIX }),
  );

  // --- Confound: a run marked timeout. ---
  runs.push(makeRun({ caseId: "timeout-case", variantId: BASELINE_ID, terminalState: "timeout", matrix: BASELINE_MATRIX }));

  // --- Confound: stored policy matrix drifted from what was requested. ---
  runs.push(
    makeRun({
      caseId: "drift-case",
      variantId: BASELINE_ID,
      terminalState: "awaiting-human-approval",
      matrix: { ...BASELINE_MATRIX, triage: { model: "some-other-model", reasoning: "high" } },
      requestedMatrix: BASELINE_MATRIX,
      bundleLabel: "drift-base",
    }),
  );

  return {
    schemaVersion: 1,
    campaignId: "core-fixture",
    suiteId: "core",
    runs,
  };
}

function buildVariantMap(manifest) {
  const variantMap = {};
  for (const run of manifest.runs) variantMap[run.taskId] = run.variantId;
  // Deliberately corrupt one entry to exercise the variant-map confound check.
  const mismatchRun = manifest.runs.find((run) => run.caseId === "c2" && run.variantId === "implement-opus");
  variantMap[mismatchRun.taskId] = "plan-sonnet";
  return { variantMap, mismatchTaskId: mismatchRun.taskId };
}

function findRoleSwap(report, variantId) {
  const swap = report.perRoleSwap.find((entry) => entry.variantId === variantId);
  assert.ok(swap, `expected a per-role-swap entry for ${variantId}`);
  return swap;
}

function findRecommendation(report, role) {
  const rec = report.recommendations.find((entry) => entry.role === role);
  assert.ok(rec, `expected a recommendation row for role ${role}`);
  return rec;
}

test("buildReport requires a baselineId", () => {
  assert.throws(() => buildReport({ manifest: { runs: [] } }), /baselineId/);
});

test("buildReport: completion table counts every run and how many finished", () => {
  const manifest = buildFixtureManifest();
  const { variantMap } = buildVariantMap(manifest);
  const { json } = buildReport({ manifest, variantMap, baselineId: BASELINE_ID });
  assert.equal(json.completion.total, manifest.runs.length);
  const expectedFinished = manifest.runs.filter((run) => run.terminalState === "awaiting-human-approval").length;
  assert.equal(json.completion.reachedApproval, expectedFinished);
  assert.ok(json.completion.rows.some((row) => row.caseId === "timeout-case" && row.status === "timeout"));
});

test("buildReport: a clean win on cost/time with no quality loss is classified adopt", () => {
  const manifest = buildFixtureManifest();
  const { variantMap } = buildVariantMap(manifest);
  const { json } = buildReport({ manifest, variantMap, baselineId: BASELINE_ID });

  const swap = findRoleSwap(json, "implement-opus");
  assert.deepEqual(swap.roles, ["implement"]);
  assert.deepEqual(swap.modelsSwappedIn, ["claude-opus-5"]);
  // One of the four pairs (all-failed-case) is present but not comparable; the rest are.
  assert.equal(swap.comparablePairCount, 4);
  assert.deepEqual(swap.notComparableCases, ["all-failed-case"]);
  assert.equal(swap.deltas.blindScoreDelta, null); // no judge output and no evaluationSummary supplied
  assert.equal(swap.deltas.repairCountDelta, 0);
  assert.ok(swap.deltas.wallTimeMsDelta < 0);
  assert.equal(swap.classification.action, "adopt");

  const rec = findRecommendation(json, "implement");
  assert.equal(rec.action, "adopt");
  assert.equal(rec.bestSwapModel, "claude-opus-5");
  assert.equal(rec.sampleSupportsAction, true);
});

test("buildReport: a blind-score drop of 0.5 or more rejects the swap regardless of cost/time wins", () => {
  const manifest = buildFixtureManifest();
  const { variantMap } = buildVariantMap(manifest);
  const judgeByLabel = new Map([
    ["c5-base", { score: 4 }],
    ["c5-sonnet", { score: 3 }],
    ["c6-base", { score: 4 }],
    ["c6-sonnet", { score: 3 }],
  ]);
  const { json } = buildReport({ manifest, variantMap, judgeByLabel, baselineId: BASELINE_ID });

  const swap = findRoleSwap(json, "plan-sonnet");
  assert.deepEqual(swap.roles, ["plan"]);
  assert.equal(swap.deltas.blindScoreDelta, -1);
  assert.equal(swap.classification.action, "rejected");
  assert.match(swap.classification.reason, /blind score dropped/);

  const rec = findRecommendation(json, "plan");
  assert.equal(rec.action, "rejected");
});

test("buildReport: fewer than four comparable pairs is inconclusive even with good numbers", () => {
  const manifest = buildFixtureManifest();
  const { variantMap } = buildVariantMap(manifest);
  const { json } = buildReport({ manifest, variantMap, baselineId: BASELINE_ID });

  const swap = findRoleSwap(json, "test-fast");
  assert.equal(swap.comparablePairCount, 1);
  assert.equal(swap.classification.action, "inconclusive");
  assert.match(swap.classification.reason, /at least four/);

  const rec = findRecommendation(json, "test");
  assert.equal(rec.action, "inconclusive");
  assert.equal(rec.sampleSupportsAction, false);
});

test("buildReport: repair count rising on more than one case rejects, regardless of cost", () => {
  const manifest = buildFixtureManifest();
  const { variantMap } = buildVariantMap(manifest);
  const { json } = buildReport({ manifest, variantMap, baselineId: BASELINE_ID });

  const swap = findRoleSwap(json, "repair-prone");
  assert.equal(swap.deltas.repairIncreaseCases, 2);
  assert.equal(swap.classification.action, "rejected");
  assert.match(swap.classification.reason, /repair count rose/);
  // The swap was materially cheaper and faster, which must not override the rejection.
  assert.ok(swap.deltas.apiEstimateDelta < 0);

  const rec = findRecommendation(json, "dev-review");
  assert.equal(rec.action, "rejected");
});

test("buildReport: per-case section lists every case with every variant that ran it", () => {
  const manifest = buildFixtureManifest();
  const { variantMap } = buildVariantMap(manifest);
  const { json } = buildReport({ manifest, variantMap, baselineId: BASELINE_ID });

  const c1 = json.perCase.find((entry) => entry.caseId === "c1");
  assert.ok(c1);
  assert.deepEqual(
    c1.variants.map((v) => v.variantId).sort(),
    [BASELINE_ID, "implement-opus"],
  );
});

test("buildReport: confounds surface all-failed cases, timeouts, policy drift, and variant-map mismatches", () => {
  const manifest = buildFixtureManifest();
  const { variantMap, mismatchTaskId } = buildVariantMap(manifest);
  const { json } = buildReport({ manifest, variantMap, baselineId: BASELINE_ID });

  // "timeout-case" has only a baseline run, which itself timed out, so it also counts as a case
  // where every variant present failed to finish.
  assert.deepEqual(json.confounds.allFailedCases.sort(), ["all-failed-case", "timeout-case"]);
  assert.equal(json.confounds.timeoutRuns.length, 1);
  assert.equal(json.confounds.timeoutRuns[0].caseId, "timeout-case");
  assert.equal(json.confounds.policyDriftRuns.length, 1);
  assert.equal(json.confounds.policyDriftRuns[0].caseId, "drift-case");
  assert.equal(json.confounds.variantMapMismatches.length, 1);
  assert.equal(json.confounds.variantMapMismatches[0].taskId, mismatchTaskId);
  assert.equal(json.confounds.variantMapMismatches[0].recordedAs, "plan-sonnet");
});

test("buildReport: a missing judge file means no blind score, not a crash", () => {
  const manifest = buildFixtureManifest();
  const { variantMap } = buildVariantMap(manifest);
  // No judgeByLabel at all: every run's blindScore must come back null, never throw.
  const { json } = buildReport({ manifest, variantMap, baselineId: BASELINE_ID });
  const allFailedEntry = json.perCase.find((entry) => entry.caseId === "all-failed-case");
  for (const variant of allFailedEntry.variants) assert.equal(variant.blindScore, null);
});

test("buildReport: a live evaluations-summary blind score takes priority over judge/*.json", () => {
  const manifest = buildFixtureManifest();
  const { variantMap } = buildVariantMap(manifest);
  const judgeByLabel = new Map([["c1-base", { score: 2 }]]);
  const evaluationSummary = {
    experiments: {
      variants: [{ groupId: "c1", variantId: BASELINE_ID, averageBlindScore: 5 }],
    },
  };
  const { json } = buildReport({ manifest, variantMap, judgeByLabel, evaluationSummary, baselineId: BASELINE_ID });
  const c1 = json.perCase.find((entry) => entry.caseId === "c1");
  const baselineRow = c1.variants.find((variant) => variant.variantId === BASELINE_ID);
  assert.equal(baselineRow.blindScore, 5);
});

test("buildReport: renders markdown with every required section in order", () => {
  const manifest = buildFixtureManifest();
  const { variantMap } = buildVariantMap(manifest);
  const { markdown } = buildReport({ manifest, variantMap, baselineId: BASELINE_ID });
  const sectionOrder = [
    "## 1. Completion",
    "## 2. Per-role swap versus baseline",
    "## 3. Per case",
    "## 4. Confounds",
    "## 5. Recommendation table",
  ];
  let cursor = -1;
  for (const heading of sectionOrder) {
    const index = markdown.indexOf(heading);
    assert.ok(index > cursor, `expected "${heading}" to appear after the previous section`);
    cursor = index;
  }
  assert.ok(markdown.includes("implement-opus"));
  assert.ok(markdown.includes("claude-opus-5"));
});

test("loadCampaignArtifacts reads manifest.json, variant-map.json, and judge/*.json from disk", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "eval-report-"));
  try {
    const campaignDir = path.join(dataRoot, "campaign-a");
    await mkdir(path.join(campaignDir, "judge"), { recursive: true });
    await writeFile(path.join(campaignDir, "manifest.json"), JSON.stringify({ schemaVersion: 1, campaignId: "campaign-a", suiteId: "core", runs: [] }), "utf8");
    await writeFile(path.join(campaignDir, "variant-map.json"), JSON.stringify({ "AH-001": "baseline" }), "utf8");
    await writeFile(path.join(campaignDir, "judge", "aaa.json"), JSON.stringify({ score: 4, criteria: [], defects: [], notes: "" }), "utf8");
    await writeFile(path.join(campaignDir, "judge", "bbb.json"), "not valid json", "utf8");

    const { manifest, variantMap, judgeByLabel } = await loadCampaignArtifacts(campaignDir);
    assert.equal(manifest.campaignId, "campaign-a");
    assert.deepEqual(variantMap, { "AH-001": "baseline" });
    assert.deepEqual(judgeByLabel.get("aaa"), { score: 4, criteria: [], defects: [], notes: "" });
    assert.equal(judgeByLabel.get("bbb"), null); // malformed judge output: recorded as absent, not thrown
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("loadCampaignArtifacts tolerates a missing variant-map.json and judge/ directory", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "eval-report-"));
  try {
    const campaignDir = path.join(dataRoot, "campaign-b");
    await mkdir(campaignDir, { recursive: true });
    await writeFile(path.join(campaignDir, "manifest.json"), JSON.stringify({ schemaVersion: 1, campaignId: "campaign-b", suiteId: "core", runs: [] }), "utf8");

    const { variantMap, judgeByLabel } = await loadCampaignArtifacts(campaignDir);
    assert.deepEqual(variantMap, {});
    assert.equal(judgeByLabel.size, 0);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
