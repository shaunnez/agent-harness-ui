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
  const variant = summary.experiments.variants.find((item) => item.groupId === "g1" && item.variantId === "v1");
  assert.ok(variant, "the controlled variant is reported");
  assert.equal(variant.wallTimeMs, 5 * 60 * 1_000, "merged-to-target falls back to updatedAt like other terminal statuses");
});

test("does not report wall time for a task still awaiting a non-terminal stage", () => {
  const task = makeExperimentTask({ status: "ready-for-review" });
  const summary = buildEvaluationSummary([task]);
  const variant = summary.experiments.variants.find((item) => item.groupId === "g1" && item.variantId === "v1");
  assert.ok(variant);
  assert.equal(variant.wallTimeMs, null, "a non-terminal status has no authoritative end time to fall back to");
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
        usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, totalTokens: 120, cost: 0.12, credits: null },
      },
      {
        id: "assembly",
        stage: "implement",
        agentRole: "implement",
        model: "gpt-5.6-luna",
        reasoning: "not-recorded",
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, cost: null, credits: null },
      },
      {
        id: "scout-aggregate",
        stage: "scouts",
        agentRole: "scouts",
        model: "deterministic-aggregation",
        reasoning: null,
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0, cost: null, credits: null },
      },
    ],
  });
  const summary = buildEvaluationSummary([task]);
  assert.deepEqual(summary.observations.variants.map((variant) => variant.model), ["claude-opus-5"]);
  assert.equal(summary.observations.variants[0].runs, 1);
  assert.equal(summary.observations.variants[0].cost, 0.12);
});
