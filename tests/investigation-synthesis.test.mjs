import assert from "node:assert/strict";
import test from "node:test";
import { buildEvaluationSummary, normalizeTopologyTrace } from "../server/evaluation.mjs";
import { INVESTIGATION_PIPELINE, buildStagePrompt } from "../server/prompts.mjs";
import {
  assertTopologyTraceValid,
  recordEdge,
  recordNodeExecuted,
  recordNodeSkipped,
  recordRoutingDecision,
} from "../server/topology-trace.mjs";

function artifact(stage, name, content) {
  return {
    id: `${stage}-1`,
    runId: `run-${stage}`,
    stage,
    name,
    content,
    createdAt: "2026-08-01T00:00:00.000Z",
    usage: {},
  };
}

function taskWith(artifacts) {
  return {
    id: "AH-1",
    title: "Mailbox visibility",
    description: "Delegated connections are missing from the mailbox list.",
    workflow: "implement",
    priority: "high",
    workflowProfile: { selected: "standard", reason: "Default." },
    attachments: [],
    decisions: [],
    artifacts,
    workPackages: [],
  };
}

// --- pipeline shape -------------------------------------------------------------

test("synthesis sits between the scouts and the grill", () => {
  assert.deepEqual(INVESTIGATION_PIPELINE, ["triage", "scouts", "synthesis", "grill"]);
});

test("the synthesis stage is told to produce meaning, not facts, and asked for the contract", () => {
  const prompt = buildStagePrompt(
    taskWith([artifact("scouts", "repository-scout.md", "Scout facts.")]),
    "synthesis",
  );
  assert.match(prompt, /The scouts answered facts\. Your job is meaning/);
  assert.match(prompt, /<investigation-result>/);
  assert.match(prompt, /Work read-only/);
  // It reasons over retained evidence rather than re-exploring the repository.
  assert.match(prompt, /no more than 3 repository commands/);
});

// --- downstream context routing -------------------------------------------------

test("once synthesis has run, grill reads its conclusion instead of the scout aggregate", () => {
  const prompt = buildStagePrompt(
    taskWith([
      artifact("triage", "triage.md", "Triage verdict."),
      artifact("scouts", "repository-scout.md", "Raw aggregated scout facts."),
      artifact("synthesis", "investigation-synthesis.md", "H1 at 82% confidence."),
    ]),
    "grill",
  );
  assert.match(prompt, /investigation-synthesis\.md/);
  assert.doesNotMatch(prompt, /Raw aggregated scout facts/);
});

test("a run that skipped synthesis still hands the grill the scout aggregate", () => {
  const prompt = buildStagePrompt(
    taskWith([
      artifact("triage", "triage.md", "Triage verdict."),
      artifact("scouts", "repository-scout.md", "Raw aggregated scout facts."),
    ]),
    "grill",
  );
  assert.match(prompt, /Raw aggregated scout facts/);
  assert.doesNotMatch(prompt, /investigation-synthesis\.md/);
});

test("specification prefers the synthesis conclusion and keeps the decision brief", () => {
  const prompt = buildStagePrompt(
    taskWith([
      artifact("scouts", "repository-scout.md", "Raw aggregated scout facts."),
      artifact("synthesis", "investigation-synthesis.md", "H1 at 82% confidence."),
      artifact("grill", "decision-brief.md", "Recorded decisions."),
    ]),
    "specification",
  );
  assert.match(prompt, /investigation-synthesis\.md/);
  assert.match(prompt, /decision-brief\.md/);
  assert.doesNotMatch(prompt, /Raw aggregated scout facts/);
});

// --- topology trace writers -----------------------------------------------------

test("the trace writers build a record the reporting layer accepts", () => {
  const draft = {};
  recordNodeExecuted(draft, "triage");
  recordNodeExecuted(draft, "scouts");
  recordEdge(draft, "triage", "scouts");
  recordNodeSkipped(draft, "synthesis", "fast profile has one hypothesis by construction");
  recordEdge(draft, "test", "plan", "backjump");
  recordRoutingDecision(draft, {
    at: "test",
    classification: "PLAN_DEFECT",
    rewindTo: "plan",
    rationale: "The plan never touched the failing predicate.",
  });

  assertTopologyTraceValid(draft);
  const trace = normalizeTopologyTrace(draft.topologyTrace);
  assert.deepEqual(trace.nodesExecuted, ["triage", "scouts"]);
  assert.deepEqual(trace.nodesSkipped, [
    { node: "synthesis", reason: "fast profile has one hypothesis by construction" },
  ]);
  assert.equal(trace.edgesTaken.length, 2);
  assert.equal(trace.routingDecisions[0].classification, "PLAN_DEFECT");
});

test("the trace writers initialise a missing trace rather than throwing", () => {
  const draft = { topologyTrace: null };
  recordNodeExecuted(draft, "synthesis");
  assert.deepEqual(normalizeTopologyTrace(draft.topologyTrace).nodesExecuted, ["synthesis"]);
});

test("a stage that ran twice is recorded twice, because it did", () => {
  const draft = {};
  recordNodeExecuted(draft, "plan");
  recordNodeExecuted(draft, "plan");
  const summary = buildEvaluationSummary([
    {
      id: "AH-1",
      status: "merged-to-target",
      startedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:04:00.000Z",
      updatedAt: "2026-08-01T00:04:00.000Z",
      artifacts: [],
      attemptsByStage: {},
      candidates: [],
      usage: {},
      evaluation: null,
      topologyTrace: draft.topologyTrace,
      experiment: {
        groupId: "g1",
        variantId: "v1",
        topologyId: "topology-baseline-v1",
        topologyVersion: 1,
        frozenBaseSha: "a".repeat(40),
        taskBriefHash: "hash",
        policyMatrix: {},
        acceptanceCriteria: ["done"],
        verificationCommands: ["npm test"],
      },
    },
  ]);
  assert.equal(summary.experiments.variants[0].nodeExecutionCounts.plan, 2);
});

test("an assertion on the write path catches a writer that emits a bad edge kind", () => {
  const draft = {};
  recordEdge(draft, "plan", "implement", "teleport");
  assert.throws(() => assertTopologyTraceValid(draft), /edge kind must be one of/);
});
