import assert from "node:assert/strict";
import test from "node:test";
import { buildEvaluationSummary } from "../server/evaluation.mjs";

function makeExperimentTask(overrides = {}) {
  return {
    id: "AH-1",
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    updatedAt: "2026-08-01T00:05:00.000Z",
    artifacts: [],
    attemptsByStage: {},
    candidates: [],
    usage: {},
    evaluation: null,
    experiment: {
      groupId: "g1",
      variantId: "v1",
      frozenBaseSha: "a".repeat(40),
      taskBriefHash: "hash",
      policyMatrix: {},
      acceptanceCriteria: ["done"],
      verificationCommands: ["npm test"],
    },
    ...overrides,
  };
}

test("counts a merged-to-target task as terminal for wall-time reporting", () => {
  const task = makeExperimentTask({ status: "merged-to-target" });
  const summary = buildEvaluationSummary([task]);
  const variant = summary.experiments.variants.find(
    (item) => item.groupId === "g1" && item.variantId === "v1",
  );
  assert.ok(variant, "the controlled variant is reported");
  assert.equal(
    variant.wallTimeMs,
    5 * 60 * 1_000,
    "merged-to-target falls back to updatedAt like other terminal statuses",
  );
});

test("does not report wall time for a task still awaiting a non-terminal stage", () => {
  const task = makeExperimentTask({ status: "ready-for-review" });
  const summary = buildEvaluationSummary([task]);
  const variant = summary.experiments.variants.find(
    (item) => item.groupId === "g1" && item.variantId === "v1",
  );
  assert.ok(variant);
  assert.equal(
    variant.wallTimeMs,
    null,
    "a non-terminal status has no authoritative end time to fall back to",
  );
});

test("historical observations include Claude model runs and exclude synthetic handoffs", () => {
  const task = makeExperimentTask({
    experiment: null,
    status: "completed",
    artifacts: [
      {
        id: "claude-plan",
        runId: "run-claude-plan",
        stage: "plan",
        agentRole: "plan",
        model: "claude-opus-5-5",
        reasoning: "xhigh",
        usage: {
          inputTokens: 100,
          cachedInputTokens: 40,
          outputTokens: 20,
          totalTokens: 120,
          cost: 0.12,
          credits: null,
        },
      },
      {
        id: "assembly",
        stage: "implement",
        agentRole: "implement",
        model: "gpt-5.6-luna",
        reasoning: "not-recorded",
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: null,
          credits: null,
        },
      },
      {
        id: "scout-aggregate",
        stage: "scouts",
        agentRole: "scouts",
        model: "deterministic-aggregation",
        reasoning: null,
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: null,
          credits: null,
        },
      },
    ],
  });
  const summary = buildEvaluationSummary([task]);
  assert.deepEqual(
    summary.observations.variants.map((variant) => variant.model),
    ["claude-opus-5-5"],
  );
  assert.equal(summary.observations.variants[0].runs, 1);
  assert.equal(summary.observations.variants[0].cost, 0.12);
});

function makeDecisionTask({ variantId, taskId, gates, experiment = {}, ...overrides }) {
  return makeExperimentTask({
    id: taskId,
    status: "completed",
    completedAt: "2026-08-01T00:05:00.000Z",
    artifacts: (gates ?? []).map((verdict, index) => ({
      id: `gate-${index}`,
      runId: `run-${index}`,
      stage: "dev-review",
      agentRole: "dev-review",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
      gateResult: { verdict },
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })),
    experiment: {
      groupId: "g1",
      variantId,
      frozenBaseSha: "a".repeat(40),
      taskBriefHash: "hash",
      policyMatrix: {},
      acceptanceCriteria: ["done"],
      verificationCommands: ["npm test"],
      decisionMetric: "first-pass-gate-success-rate",
      budget: null,
      ...experiment,
    },
    ...overrides,
  });
}

function manifestRun(status, headRevision = "head1") {
  return {
    executionKind: "full-manifest",
    headRevision,
    candidateId: "C1",
    candidateRevision: 1,
    rows: [{ id: "test", command: "npm test", status, exitCode: status === "passed" ? 0 : 1 }],
    status,
    declaredCommandIds: ["lint", "test"],
    executedCommandIds: ["lint", "test"],
  };
}

function makeDeliveryTask({ variantId, taskId, status, gates, decisionMetric }) {
  return makeDecisionTask({
    variantId,
    taskId,
    gates,
    experiment: decisionMetric === undefined ? {} : { decisionMetric },
    candidates: [
      { id: "C1", revisionNumber: 1, headRevision: "head1", verificationRuns: [manifestRun(status)] },
    ],
  });
}

test("a delivery-metric experiment is decided on deterministic delivery, not gate passes", () => {
  // The arm that delivers fails its gates; the arm that passes every gate delivers nothing.
  // A declared delivery metric cannot be replaced by the more flattering gate rate.
  const summary = buildEvaluationSummary([
    makeDeliveryTask({
      variantId: "v1",
      taskId: "AH-1",
      status: "passed",
      gates: ["REPAIR"],
      decisionMetric: "deterministic-delivery-rate",
    }),
    makeDeliveryTask({
      variantId: "v2",
      taskId: "AH-2",
      status: "failed",
      gates: ["PASS"],
      decisionMetric: "deterministic-delivery-rate",
    }),
  ]);
  const [decision] = summary.experiments.decisions;
  assert.equal(decision.decisionMetric, "deterministic-delivery-rate");
  assert.deepEqual(decision.leader, { variantId: "v1", value: 1 });
});

test("a finalized arm that never produces a candidate is a delivery failure", () => {
  const summary = buildEvaluationSummary([
    makeDeliveryTask({
      variantId: "v1",
      taskId: "AH-1",
      status: "passed",
      gates: ["PASS"],
      decisionMetric: "deterministic-delivery-rate",
    }),
    makeDecisionTask({
      variantId: "v2",
      taskId: "AH-2",
      gates: ["PASS"],
      experiment: { decisionMetric: "deterministic-delivery-rate" },
    }),
  ]);
  const [decision] = summary.experiments.decisions;
  const unscored = decision.variants.find((variant) => variant.variantId === "v2");
  assert.equal(unscored.value, 0);
  assert.equal(unscored.eligible, true);
});

test("names the leader on the declared decision metric alone", () => {
  const summary = buildEvaluationSummary([
    makeDecisionTask({ variantId: "v1", taskId: "AH-1", gates: ["PASS"] }),
    makeDecisionTask({ variantId: "v2", taskId: "AH-2", gates: ["REPAIR"] }),
  ]);
  const [decision] = summary.experiments.decisions;
  assert.equal(decision.decisionMetric, "first-pass-gate-success-rate");
  assert.equal(decision.comparable, true);
  assert.deepEqual(decision.leader, { variantId: "v1", value: 1 });
});

test("declares no leader when the arms tie on the decision metric", () => {
  const summary = buildEvaluationSummary([
    makeDecisionTask({ variantId: "v1", taskId: "AH-1", gates: ["PASS"] }),
    makeDecisionTask({ variantId: "v2", taskId: "AH-2", gates: ["PASS"] }),
  ]);
  const [decision] = summary.experiments.decisions;
  assert.equal(decision.leader, null);
  assert.match(decision.note, /tied/);
});

test("disqualifies a variant that exceeded its declared wall-time budget", () => {
  // Both arms pass their gate, so only the budget breach separates them.
  const budget = { maxWallTimeMs: 60_000, maxTotalTokens: null };
  const summary = buildEvaluationSummary([
    makeDecisionTask({
      variantId: "v1",
      taskId: "AH-1",
      gates: ["PASS"],
      experiment: { budget },
      completedAt: "2026-08-01T00:00:30.000Z",
    }),
    makeDecisionTask({
      variantId: "v2",
      taskId: "AH-2",
      gates: ["PASS"],
      experiment: { budget },
      completedAt: "2026-08-01T00:10:00.000Z",
    }),
  ]);
  const [decision] = summary.experiments.decisions;
  const slow = decision.variants.find((variant) => variant.variantId === "v2");
  assert.equal(slow.budgetStatus, "exceeded");
  assert.equal(slow.eligible, false);
  assert.deepEqual(slow.budgetExceededTaskIds, ["AH-2"]);
  assert.equal(decision.leader, null, "one eligible arm is not a comparison");
});

test("refuses to rank arms that were given different budgets", () => {
  const summary = buildEvaluationSummary([
    makeDecisionTask({
      variantId: "v1",
      taskId: "AH-1",
      gates: ["PASS"],
      experiment: { budget: { maxWallTimeMs: 600_000, maxTotalTokens: null } },
    }),
    makeDecisionTask({
      variantId: "v2",
      taskId: "AH-2",
      gates: ["REPAIR"],
      experiment: { budget: { maxWallTimeMs: 60_000, maxTotalTokens: null } },
    }),
  ]);
  const [decision] = summary.experiments.decisions;
  assert.equal(decision.comparable, false);
  assert.equal(decision.leader, null);
  assert.ok(decision.comparabilityIssues.some((issue) => /equal allowances/.test(issue)));
});

test("reports the recorded value for an arm the decision metric cannot score", () => {
  const summary = buildEvaluationSummary([
    makeDecisionTask({ variantId: "v1", taskId: "AH-1", gates: ["PASS"] }),
    makeDecisionTask({ variantId: "v2", taskId: "AH-2", gates: [] }),
  ]);
  const [decision] = summary.experiments.decisions;
  const unscored = decision.variants.find((variant) => variant.variantId === "v2");
  assert.equal(unscored.value, null);
  assert.equal(unscored.eligible, false);
  assert.match(unscored.ineligibleReason, /no recorded value/);
});

function variantOf(summary, groupId = "g1", variantId = "v1") {
  return summary.experiments.variants.find(
    (item) => item.groupId === groupId && item.variantId === variantId,
  );
}

function candidateWith(verificationRuns, headRevision = "head1") {
  verificationRuns = verificationRuns.map((run) => ({
    candidateId: "C1",
    candidateRevision: 1,
    rows: [
      { id: "test", command: "npm test", status: run.status, exitCode: run.status === "passed" ? 0 : 1 },
    ],
    ...run,
  }));
  return { id: "C1", revisionNumber: 1, headRevision, verificationRuns };
}

test("deterministic delivery counts a full-manifest pass on the exact final revision", () => {
  const task = makeExperimentTask({
    status: "completed",
    candidates: [
      candidateWith([
        {
          executionKind: "full-manifest",
          headRevision: "head1",
          candidateId: "C1",
          candidateRevision: 1,
          rows: [{ id: "test", command: "npm test", status: "passed", exitCode: 0 }],
          status: "passed",
          declaredCommandIds: ["lint", "test"],
          executedCommandIds: ["lint", "test"],
        },
      ]),
    ],
  });
  const variant = variantOf(buildEvaluationSummary([task]));
  assert.deepEqual(variant.deterministicOutcomes, {
    passed: 1,
    failed: 0,
    incomplete: 0,
    unknown: 0,
  });
  assert.equal(variant.deterministicDeliveryRate, 1);
  assert.equal(variant.deterministicEvidenceSamples, 1);
});

test("a manifest execution against a superseded revision is not delivery evidence", () => {
  const task = makeExperimentTask({
    status: "completed",
    candidates: [
      candidateWith(
        [
          {
            executionKind: "full-manifest",
            headRevision: "stale",
            status: "passed",
            declaredCommandIds: ["test"],
            executedCommandIds: ["test"],
          },
        ],
        "head2",
      ),
    ],
  });
  const variant = variantOf(buildEvaluationSummary([task]));
  assert.equal(variant.deterministicOutcomes.unknown, 1);
  assert.equal(
    variant.deterministicDeliveryRate,
    0,
    "a finished trial without admissible evidence did not deliver",
  );
});

test("a focused execution is never admissible as deterministic delivery", () => {
  const task = makeExperimentTask({
    status: "completed",
    candidates: [
      candidateWith([
        {
          executionKind: "focused",
          headRevision: "head1",
          candidateId: "C1",
          candidateRevision: 1,
          rows: [{ id: "test", command: "npm test", status: "passed", exitCode: 0 }],
          status: "passed",
          declaredCommandIds: ["test"],
          executedCommandIds: ["test"],
        },
      ]),
    ],
  });
  const variant = variantOf(buildEvaluationSummary([task]));
  assert.equal(variant.deterministicOutcomes.unknown, 1);
  assert.equal(variant.deterministicOutcomes.passed, 0);
});

test("a pass that skipped a declared command is incomplete, not delivered", () => {
  const task = makeExperimentTask({
    status: "completed",
    candidates: [
      candidateWith([
        {
          executionKind: "full-manifest",
          headRevision: "head1",
          candidateId: "C1",
          candidateRevision: 1,
          rows: [{ id: "test", command: "npm test", status: "passed", exitCode: 0 }],
          status: "passed",
          declaredCommandIds: ["lint", "test", "build"],
          executedCommandIds: ["lint", "test"],
        },
      ]),
    ],
  });
  const variant = variantOf(buildEvaluationSummary([task]));
  assert.equal(variant.deterministicOutcomes.incomplete, 1);
  assert.equal(variant.deterministicOutcomes.passed, 0);
  assert.equal(variant.deterministicDeliveryRate, 0);
});

test("pooling two briefs under one variant is labelled mixed-identity", () => {
  const summary = buildEvaluationSummary([
    makeExperimentTask({ id: "AH-1", status: "completed" }),
    makeExperimentTask({
      id: "AH-2",
      status: "completed",
      experiment: {
        groupId: "g1",
        variantId: "v1",
        frozenBaseSha: "b".repeat(40),
        taskBriefHash: "other-hash",
        policyMatrix: {},
        acceptanceCriteria: ["done"],
        verificationCommands: ["npm test"],
      },
    }),
  ]);
  const variant = variantOf(summary);
  assert.equal(variant.comparability.status, "mixed-identity");
  assert.equal(variant.comparability.briefHashCount, 2);
  assert.equal(variant.comparability.baseShaCount, 2);
  assert.deepEqual(variant.frozenBaseShas.length, 2, "every pooled base is reported, not just the first");
  assert.ok(
    variant.comparability.reasons.some((reason) => reason.includes("task briefs")),
    "the reason names the pooled briefs",
  );
});

test("one brief, base, policy and acceptance definition is comparable", () => {
  const variant = variantOf(buildEvaluationSummary([makeExperimentTask({ status: "completed" })]));
  assert.equal(variant.comparability.status, "comparable");
  assert.deepEqual(variant.comparability.reasons, []);
});

test("a run that executed a policy other than the selected one contaminates the variant", () => {
  const task = makeExperimentTask({
    status: "completed",
    runs: [
      {
        stage: "repair",
        policyRole: "repair",
        selectedModel: "gpt-5.6-luna",
        selectedReasoning: "xhigh",
        effectiveModel: "gpt-5.6-sol",
        effectiveReasoning: "high",
        policyEscalationReason: "Verified P1 candidate defect from dev-review",
      },
    ],
  });
  const variant = variantOf(buildEvaluationSummary([task]));
  assert.equal(variant.policyDivergences.length, 1);
  assert.equal(variant.policyDivergences[0].role, "repair");
  assert.equal(variant.policyDivergences[0].effective, "gpt-5.6-sol:high");
  assert.equal(variant.comparability.status, "mixed-identity");
});

test("a run whose effective policy matches its selection is not a divergence", () => {
  const task = makeExperimentTask({
    status: "completed",
    runs: [
      {
        stage: "implement",
        policyRole: "implement",
        selectedModel: "gpt-5.6-luna",
        selectedReasoning: "xhigh",
        effectiveModel: "gpt-5.6-luna",
        effectiveReasoning: "xhigh",
        policyEscalationReason: null,
      },
    ],
  });
  const variant = variantOf(buildEvaluationSummary([task]));
  assert.deepEqual(variant.policyDivergences, []);
  assert.equal(variant.comparability.status, "comparable");
});
