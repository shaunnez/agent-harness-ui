import assert from "node:assert/strict";
import test from "node:test";
import { BACKJUMP_LIMIT } from "../server/failure-routing.mjs";
import { FailureDiagnosisOrchestrator } from "../server/orchestrator-failure-diagnosis.mjs";

function diagnosisOutput(classification, rewindTo = "implement") {
  return `## Classification\n\n${classification}\n\n<failure-diagnosis>\n${JSON.stringify({
    classification,
    rewindTo,
    rationale: "The failing assertion exercises a surface the upstream stage never considered.",
    evidence: ["server/mailbox.mjs:183"],
    confidence: 0.76,
  })}\n</failure-diagnosis>`;
}

function makeTask({ profile = "standard", backjumps = 0 } = {}) {
  const candidate = {
    id: "C1",
    revisionNumber: 2,
    headRevision: "a".repeat(40),
    worktreePath: "/tmp/wt",
    status: "repair_required",
    revisions: [],
  };
  return {
    id: "AH-1",
    title: "Mailbox visibility",
    description: "Delegated connections are missing.",
    workflow: "implement",
    priority: "high",
    status: "repair-required",
    currentStage: "dev-review",
    workflowProfile: { selected: profile, reason: "test" },
    attachments: [],
    decisions: [],
    artifacts: [],
    workPackages: [{ id: "S1", status: "integrated", ownedPaths: ["server/mailbox.mjs"] }],
    candidates: [candidate],
    completedStages: ["triage", "scouts", "synthesis", "grill", "specification", "plan", "implement"],
    attemptsByStage: { implement: 1, plan: 1 },
    stageRunLimits: {},
    events: [],
    gateFreshness: {},
    topologyTrace: {
      nodesExecuted: [],
      nodesSkipped: [],
      edgesTaken: Array.from({ length: backjumps }, () => ({
        from: "test",
        to: "plan",
        kind: "backjump",
      })),
      routingDecisions: [],
    },
    runs: [
      {
        id: "RUN-1",
        stage: "dev-review",
        kind: "review",
        status: "completed",
        candidateId: "C1",
        candidateRevision: 2,
        completedAt: "2026-08-01T12:01:00.000Z",
        gateResult: {
          stage: "dev-review",
          verdict: "REPAIR",
          candidateId: "C1",
          candidateRevision: 2,
          summary: "Blocking defect",
          findings: [
            {
              kind: "candidate-defect",
              severity: "P1",
              title: "Visibility predicate drops delegated rows",
              detail: "The predicate never sees delegated connections.",
              blocking: true,
              file: "server/mailbox.mjs",
              line: 183,
              reproductionEvidence: "npm test -- mailbox",
              candidateId: "C1",
              candidateRevision: 2,
            },
          ],
        },
      },
    ],
  };
}

function harness(task, finalText) {
  const retained = [];
  const store = {
    async get() {
      return task;
    },
    async update(_id, mutate) {
      mutate(task);
      return task;
    },
  };
  const orchestrator = new FailureDiagnosisOrchestrator({
    store,
    executeAgent: async () => ({
      finalText,
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 },
      runtimeEvents: [],
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
      contextManifest: { stage: "implement", sources: [] },
    }),
    retainAgentResult: async (_id, stage, result, options) => {
      retained.push({ stage, name: options.name, content: result.finalText });
    },
  });
  return { orchestrator, retained, task };
}

// --- the default: nothing changes when the candidate really is wrong ---------------

test("an implementation defect hands control back to the untouched repair path", async () => {
  const task = makeTask();
  const { orchestrator, retained } = harness(task, diagnosisOutput("IMPLEMENTATION_DEFECT"));
  assert.equal(await orchestrator._diagnoseFailure("AH-1"), true);
  assert.equal(task.status, "repair-required", "the repair path still owns the next step");
  assert.equal(task.candidates[0].status, "repair_required", "the candidate is not discarded");
  assert.deepEqual(task.topologyTrace.edgesTaken, [], "attributing to the candidate is not a backjump");
  assert.equal(task.topologyTrace.routingDecisions[0].classification, "IMPLEMENTATION_DEFECT");
  assert.equal(retained[0].name, "failure-diagnosis.md");
});

test("the fast profile skips attribution entirely and records the skip", async () => {
  const task = makeTask({ profile: "fast" });
  const { orchestrator, retained } = harness(task, "this stub must never be read");
  assert.equal(await orchestrator._diagnoseFailure("AH-1"), true);
  assert.equal(retained.length, 0, "no model call, so no artifact");
  assert.deepEqual(task.topologyTrace.nodesSkipped, [
    {
      node: "failure-diagnosis",
      reason: "Fast profile routes its single automatic repair directly, without paying for attribution.",
    },
  ]);
});

// --- the point of the phase: a plan defect rewinds instead of repairing ------------

test("a plan defect rewinds to planning without burning an implementation retry", async () => {
  const task = makeTask();
  const before = task.attemptsByStage.implement;
  const { orchestrator } = harness(task, diagnosisOutput("PLAN_DEFECT", "plan"));

  assert.equal(await orchestrator._diagnoseFailure("AH-1"), false, "there is nothing to repair");
  assert.equal(task.currentStage, "plan");
  assert.equal(task.status, "awaiting-spec-approval");
  assert.equal(task.candidates[0].status, "superseded");
  assert.equal(
    task.attemptsByStage.implement,
    before,
    "rewinding to planning must not consume an implementation attempt",
  );
  assert.equal(task.workPackages[0].status, "planned", "packages return to planned for the new plan");
  assert.deepEqual(task.completedStages, ["triage", "scouts", "synthesis", "grill", "specification"]);
  assert.equal(task.topologyTrace.edgesTaken.at(-1).kind, "backjump");
  assert.equal(task.topologyTrace.edgesTaken.at(-1).to, "plan");
  assert.equal(task.topologyTrace.routingDecisions.at(-1).rewindTo, "plan");
  assert.ok(task.stageRunLimits.plan >= task.attemptsByStage.plan + 1, "planning gets room to rerun");
});

test("the router overrules a rewind target the agent proposed for itself", async () => {
  const task = makeTask();
  // The agent says SPECIFICATION_GAP but asks to rewind only as far as the plan.
  const { orchestrator } = harness(task, diagnosisOutput("SPECIFICATION_GAP", "plan"));
  await orchestrator._diagnoseFailure("AH-1");
  assert.equal(task.currentStage, "specification", "the table decides, not the agent");
  assert.equal(task.topologyTrace.edgesTaken.at(-1).to, "specification");
  assert.equal(
    task.completedStages.includes("specification"),
    false,
    "a specification rewind invalidates the specification itself",
  );
});

test("an investigation gap rewinds all the way to gathering facts", async () => {
  const task = makeTask();
  const { orchestrator } = harness(task, diagnosisOutput("INVESTIGATION_GAP", "scouts"));
  await orchestrator._diagnoseFailure("AH-1");
  assert.equal(task.currentStage, "triage");
  assert.deepEqual(task.completedStages, ["triage"]);
});

test("an environment failure blocks for a human rather than rewinding", async () => {
  const task = makeTask();
  const { orchestrator } = harness(task, diagnosisOutput("ENVIRONMENT_FAILURE", "test"));
  assert.equal(await orchestrator._diagnoseFailure("AH-1"), false);
  assert.equal(task.status, "blocked");
  assert.match(task.error, /ENVIRONMENT_FAILURE/);
  assert.equal(
    task.topologyTrace.edgesTaken.filter((edge) => edge.kind === "backjump").length,
    0,
    "a machine problem costs the task no budget",
  );
});

// --- the loop that must not be infinite -------------------------------------------

test("the backjump budget caps total rewinds and then asks for a human", async () => {
  const task = makeTask({ backjumps: BACKJUMP_LIMIT });
  const { orchestrator } = harness(task, diagnosisOutput("PLAN_DEFECT", "plan"));
  assert.equal(await orchestrator._diagnoseFailure("AH-1"), false);
  assert.equal(task.status, "blocked");
  assert.match(task.error, /already rewound 2 times/);
  assert.equal(task.currentStage, "dev-review", "an inadmissible rewind does not move the task");
  assert.equal(task.candidates[0].status, "repair_required", "nor discard its candidate");
  assert.match(task.topologyTrace.routingDecisions.at(-1).rationale, /^Refused:/);
});

test("an exhausted budget still lets an implementation repair through", async () => {
  const task = makeTask({ backjumps: BACKJUMP_LIMIT + 3 });
  const { orchestrator } = harness(task, diagnosisOutput("IMPLEMENTATION_DEFECT"));
  assert.equal(await orchestrator._diagnoseFailure("AH-1"), true);
  assert.equal(task.status, "repair-required");
});

test("a malformed diagnosis fails closed rather than guessing a route", async () => {
  const task = makeTask();
  const { orchestrator } = harness(task, "## Classification\n\nProbably the plan, I think.");
  await assert.rejects(
    () => orchestrator._diagnoseFailure("AH-1"),
    /required failure-diagnosis JSON block/,
  );
  assert.equal(task.status, "repair-required", "the task is left exactly as it was found");
  assert.equal(task.currentStage, "dev-review");
});

test("the retained artifact says plainly when the router overruled the agent", async () => {
  const task = makeTask();
  const { orchestrator, retained } = harness(task, diagnosisOutput("SPECIFICATION_GAP", "plan"));
  await orchestrator._diagnoseFailure("AH-1");
  assert.match(retained[0].content, /Router overruled the proposal/);
  assert.match(retained[0].content, /rewinding to specification, not plan/);
});
