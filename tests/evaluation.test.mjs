import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvaluationSummary,
  normalizeExperimentInput,
  normalizeTopologyIdentity,
  normalizeTopologyTrace,
  UNSPECIFIED_TOPOLOGY_ID,
} from "../server/evaluation.mjs";

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
        model: "claude-opus-5",
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
    ["claude-opus-5"],
  );
  assert.equal(summary.observations.variants[0].runs, 1);
  assert.equal(summary.observations.variants[0].cost, 0.12);
});

test("an experiment records its topology identity and derives the version from the id suffix", () => {
  const experiment = normalizeExperimentInput(
    {
      groupId: "g1",
      variantId: "v1",
      topologyId: "topology-bug-localisation-v3",
      acceptanceCriteria: ["done"],
      verificationCommands: ["npm test"],
    },
    { taskBriefHash: "hash", policyMatrix: {}, frozenBaseSha: "a".repeat(40) },
  );
  assert.equal(experiment.topologyId, "topology-bug-localisation-v3");
  assert.equal(experiment.topologyVersion, 3);
});

test("an experiment without a topology is recorded as unspecified rather than rejected", () => {
  const experiment = normalizeExperimentInput(
    {
      groupId: "g1",
      variantId: "v1",
      acceptanceCriteria: ["done"],
      verificationCommands: ["npm test"],
    },
    { taskBriefHash: "hash", policyMatrix: {}, frozenBaseSha: "a".repeat(40) },
  );
  assert.equal(experiment.topologyId, UNSPECIFIED_TOPOLOGY_ID);
  assert.equal(experiment.topologyVersion, null);
});

test("a topology version that contradicts its id suffix is refused", () => {
  assert.throws(
    () => normalizeTopologyIdentity({ topologyId: "topology-shape-v2", topologyVersion: 5 }),
    /contradicts the version suffix/,
  );
  assert.throws(() => normalizeTopologyIdentity({ topologyId: "Topology Shape" }), /must look like/);
});

test("two runs sharing a variant label but different topologies are reported separately", () => {
  const control = makeExperimentTask({
    id: "AH-control",
    status: "merged-to-target",
    completedAt: "2026-08-01T00:04:00.000Z",
    experiment: {
      ...makeExperimentTask().experiment,
      topologyId: "topology-baseline-v1",
      topologyVersion: 1,
    },
    topologyTrace: {
      nodesExecuted: ["triage", "scouts", "plan", "implement"],
      nodesSkipped: [{ node: "synthesis", reason: "fast profile" }],
      edgesTaken: [{ from: "plan", to: "implement", kind: "advance" }],
    },
  });
  const variant = makeExperimentTask({
    id: "AH-variant",
    status: "merged-to-target",
    completedAt: "2026-08-01T00:04:00.000Z",
    experiment: {
      ...makeExperimentTask().experiment,
      topologyId: "topology-synthesis-v1",
      topologyVersion: 1,
    },
    topologyTrace: {
      nodesExecuted: ["triage", "scouts", "synthesis", "plan", "implement"],
      edgesTaken: [
        { from: "test", to: "plan", kind: "backjump" },
        { from: "plan", to: "plan", kind: "revise" },
      ],
      routingDecisions: [
        { at: "test", classification: "plan_defect", rewindTo: "plan", rationale: "missing surface" },
      ],
    },
  });

  const summary = buildEvaluationSummary([control, variant]);
  const variants = summary.experiments.variants;
  assert.equal(variants.length, 2);
  assert.deepEqual(
    variants.map((entry) => entry.topologyId),
    ["topology-baseline-v1", "topology-synthesis-v1"],
  );

  const baseline = variants[0];
  assert.equal(baseline.nodesExecuted, 4);
  assert.equal(baseline.nodesSkipped, 1);
  assert.equal(baseline.nodeSkipCounts.synthesis, 1);
  assert.equal(baseline.backjumpCount, 0);
  assert.deepEqual(baseline.failureClassifications, {});

  const synthesis = variants[1];
  assert.equal(synthesis.nodesExecuted, 5);
  assert.equal(synthesis.backjumpCount, 1);
  assert.equal(synthesis.reviseCount, 1);
  assert.equal(synthesis.routingDecisions, 1);
  assert.deepEqual(synthesis.failureClassifications, { PLAN_DEFECT: 1 });
  assert.equal(synthesis.invalidTopologyTraces, 0);
});

test("a task with no topology trace reports zeroed counters instead of failing", () => {
  const summary = buildEvaluationSummary([
    makeExperimentTask({ status: "merged-to-target", completedAt: "2026-08-01T00:04:00.000Z" }),
  ]);
  const variant = summary.experiments.variants[0];
  assert.equal(variant.topologyId, UNSPECIFIED_TOPOLOGY_ID);
  assert.equal(variant.nodesExecuted, 0);
  assert.equal(variant.edgesTaken, 0);
  assert.equal(variant.invalidTopologyTraces, 0);
  assert.deepEqual(variant.failureClassifications, {});
});

test("a malformed topology trace degrades to empty telemetry and is counted, not thrown", () => {
  const summary = buildEvaluationSummary([
    makeExperimentTask({
      status: "merged-to-target",
      completedAt: "2026-08-01T00:04:00.000Z",
      topologyTrace: { routingDecisions: [{ classification: "NOT_A_REAL_CLASSIFICATION" }] },
    }),
  ]);
  const variant = summary.experiments.variants[0];
  assert.equal(variant.invalidTopologyTraces, 1);
  assert.equal(variant.routingDecisions, 0);
});

test("an unknown edge kind is refused at the write site", () => {
  assert.throws(
    () => normalizeTopologyTrace({ edgesTaken: [{ from: "a", to: "b", kind: "teleport" }] }),
    /edge kind must be one of/,
  );
  assert.throws(
    () => normalizeTopologyTrace({ nodesExecuted: new Array(201).fill("triage") }),
    /at most 200 entries/,
  );
});
