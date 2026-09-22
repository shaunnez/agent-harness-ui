import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadEvaluationCase } from "../scripts/evaluation/case-contract.mjs";
import { H05_CODEX_COMPARISON, H05_CODEX_COMPARISON_6 } from "../scripts/evaluation/h05-codex-comparison.mjs";
import {
  buildEvaluationSummary,
  normalizeEvaluationInput,
  normalizeExperimentInput,
} from "../server/evaluation.mjs";
import { trialResources } from "../server/evaluation-outcomes.mjs";
import { makeFocusedTestSummary, makeRuntimeRun } from "./orchestrator-test-support.mjs";

test("the default case retains the exact historical H02 public brief and rubric", async () => {
  const selected = await loadEvaluationCase();
  assert.equal(selected.item.id, "H02");
  assert.equal(selected.workflowProfile, "high-risk");
  assert.equal(selected.grader, "evaluations/graders/h02.mjs");
  assert.equal(selected.graderOutput, "file");
  assert.equal(selected.checkIds.length, 11);
  assert.equal(
    selected.contract,
    await readFile(new URL("../evaluations/cases/h02-public-contract.md", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    selected.rubric,
    JSON.parse(await readFile(new URL("../evaluations/rubric-v1.json", import.meta.url), "utf8")),
  );
});

test("H05 selects its own acceptance contract without reducing delivery review allowance", async () => {
  const selected = await loadEvaluationCase("H05");
  assert.equal(selected.workflowProfile, "standard");
  assert.equal(selected.grader, "evaluations/graders/h05.mjs");
  assert.equal(selected.graderOutput, "directory");
  assert.equal(selected.checkIds.length, 7);
  assert.ok(selected.checkIds.includes("actual-policy-editor"));
  assert.match(selected.contract, /discovered Claude/);
  assert.equal(selected.rubric.version, "delivery-rubric-h05-v1");
  assert.equal(selected.rubric.maxWallTimeMs, 3_600_000);
  assert.equal(selected.rubric.maxTotalTokens, 30_000_000);
  assert.equal(selected.rubric.maxProviderInvocations, 1);
  assert.match(selected.rubric.criteria[1], /catalog projection/);
  assert.doesNotMatch(selected.rubric.criteria[1], /manual default/);
  // A caller cannot change another preparation's returned contract.
  selected.checkIds.length = 0;
  assert.equal((await loadEvaluationCase("H05")).checkIds.length, 7);
});

test("selected but unqualified cases cannot enter the Harness-only runner", async () => {
  for (const id of ["M01", "P03", "H01", "H03", "unknown", "../H05"]) {
    await assert.rejects(loadEvaluationCase(id), /no qualified runner integration/);
  }
});

test("H05 Codex comparison changes only Implement and Repair between its two arms", () => {
  const { policies, trials, allowedModels, allowedProviders, trialConcurrency } = H05_CODEX_COMPARISON;
  assert.deepEqual(
    trials.map(({ id, variant }) => ({ id, variant })),
    [
      { id: "A", variant: "sol-implement" },
      { id: "B", variant: "luna-implement" },
    ],
  );
  assert.equal(trialConcurrency, 2);
  assert.deepEqual(allowedProviders, ["codex"]);
  assert.deepEqual(allowedModels, ["gpt-5.6-sol", "gpt-5.6-luna"]);
  assert.deepEqual(policies["sol-implement"].implement, {
    model: "gpt-5.6-sol",
    reasoning: "high",
  });
  assert.deepEqual(policies["sol-implement"].repair, policies["sol-implement"].implement);
  assert.deepEqual(policies["luna-implement"].implement, {
    model: "gpt-5.6-luna",
    reasoning: "high",
  });
  assert.deepEqual(policies["luna-implement"].repair, policies["luna-implement"].implement);
  for (const stage of [
    "triage",
    "scouts",
    "grill",
    "specification",
    "plan",
    "dev-review",
    "test",
    "final-review",
  ])
    assert.deepEqual(policies["sol-implement"][stage], policies["luna-implement"][stage]);
  assert.deepEqual(policies["sol-implement"].test, {
    model: "gpt-5.6-luna",
    reasoning: "medium",
  });
  for (const matrix of Object.values(policies))
    assert.ok(Object.values(matrix).every(({ model }) => !model.startsWith("claude-")));
});

test("H05 GPT-6 migration comparison keeps the same roles and excludes earlier models", () => {
  const { policies, trials, allowedModels, allowedProviders, defaultModel } = H05_CODEX_COMPARISON_6;
  assert.deepEqual(trials, H05_CODEX_COMPARISON.trials);
  assert.deepEqual(allowedModels, ["gpt-6-sol", "gpt-6-luna"]);
  assert.deepEqual(allowedProviders, ["codex"]);
  assert.equal(defaultModel, "gpt-6-luna");
  for (const stage of Object.keys(policies["sol-implement"])) {
    const sol = policies["sol-implement"][stage];
    const luna = policies["luna-implement"][stage];
    assert.deepEqual(
      sol,
      stage === "implement" || stage === "repair" ? { model: "gpt-6-sol", reasoning: "high" } : luna,
    );
    assert.ok(allowedModels.includes(sol.model));
    assert.ok(allowedModels.includes(luna.model));
  }
});

test("external provider receipts count helper calls once and preserve unknown consumption", () => {
  const input = task("provider-accounting", {
    runs: [{ model: "gpt-5.6-sol", usage: { totalTokens: 50, cost: 1 } }],
    evaluation: {
      trial: {
        providerInvocations: [
          { usage: { totalTokens: 50, cost: 1 } },
          { usage: { totalTokens: 10, cost: 0.1 } },
        ],
      },
    },
  });
  assert.equal(trialResources(input).totalTokens, 60);
  assert.equal(trialResources(input).attempts, 2);
  input.evaluation.trial.providerInvocations.push({ usage: null });
  assert.equal(trialResources(input).totalTokens, null);
  assert.equal(trialResources(input).cost, null);
  assert.equal(trialResources(input).knownCost, 1.1);
});

function task(id, overrides = {}) {
  return {
    id,
    status: "failed",
    startedAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:01:00Z",
    artifacts: [],
    runs: [],
    candidates: [],
    usage: { totalTokens: 100, cost: 1 },
    experiment: {
      groupId: "integrity",
      variantId: "a",
      frozenBaseSha: "a".repeat(40),
      taskBriefHash: "brief",
      policyMatrix: {},
      acceptanceCriteria: ["works"],
      verificationCommands: ["npm test", "npm run lint"],
      decisionMetric: "deterministic-delivery-rate",
      budget: { maxWallTimeMs: 120000, maxTotalTokens: 1000 },
    },
    ...overrides,
  };
}
function delivered(id) {
  return task(id, {
    status: "awaiting-human-approval",
    candidates: [
      {
        id: "candidate",
        revisionNumber: 1,
        headRevision: "b".repeat(40),
        verificationRuns: [
          {
            executionKind: "full-manifest",
            status: "passed",
            candidateId: "candidate",
            candidateRevision: 1,
            headRevision: "b".repeat(40),
            declaredCommandIds: ["test", "lint"],
            executedCommandIds: ["test", "lint"],
            rows: [
              { id: "test", command: "npm test", status: "passed", exitCode: 0 },
              { id: "lint", command: "npm run lint", status: "passed", exitCode: 0 },
            ],
          },
        ],
      },
    ],
  });
}
function summary(tasks) {
  return buildEvaluationSummary(tasks).experiments;
}

test("early delivery failures stay in the denominator", () => {
  const [variant] = summary([delivered("success"), task("early-1"), task("early-2")]).variants;
  assert.equal(variant.deterministicDeliveryRate, 1 / 3);
});

test("policy divergence cannot win the experiment", () => {
  const winner = delivered("contaminated");
  winner.runs = [
    {
      stage: "repair",
      selectedModel: "gpt-5.6-luna",
      selectedReasoning: "high",
      effectiveModel: "gpt-6-astra",
      effectiveReasoning: "high",
    },
  ];
  const loser = task("failure");
  loser.experiment.variantId = "b";
  const [decision] = summary([winner, loser]).decisions;
  assert.equal(decision.leader, null);
  assert.equal(decision.variants.find((v) => v.variantId === "a").eligible, false);
});

test("omitting a frozen command is not a pass even when the run declares its own subset", () => {
  const candidate = delivered("omitted");
  const run = candidate.candidates[0].verificationRuns[0];
  run.declaredCommandIds = run.executedCommandIds = ["test"];
  run.rows.pop();
  assert.equal(summary([candidate]).variants[0].deterministicDeliveryRate, 0);
});

function controlled(id) {
  const value = delivered(id);
  value.currentStage = "approval";
  value.candidates[0].status = "awaiting_human_approval";
  value.runs = ["dev-review", "test", "final-review"].map((stage) => ({
    ...makeRuntimeRun({
      id: `gate-${stage}`,
      stage,
      candidateId: "candidate",
      candidateRevision: 1,
      test:
        stage === "test" ? makeFocusedTestSummary({ candidateId: "candidate", candidateRevision: 1 }) : null,
    }),
    model: null,
    reasoning: null,
    provider: "deterministic",
    candidateHeadRevision: "b".repeat(40),
  }));
  value.experiment.decisionMetric = "autonomous-accepted-delivery-rate";
  value.experiment.evaluationLimits = { maxAgentRuns: 24 };
  value.experiment.evaluationContract = {
    caseId: "vertical",
    caseVersion: "v1",
    graderVersion: "g1",
    rubricVersion: "r1",
    harnessVersion: "h1",
    environmentVersion: "e1",
    executionVersion: "x1",
    checkIds: ["persist", "display"],
  };
  value.evaluation = {
    trial: {
      status: "completed",
      completedAt: value.updatedAt,
      humanRescue: false,
      acceptance: {
        candidateId: "candidate",
        candidateRevision: 1,
        headRevision: "b".repeat(40),
        caseVersion: "v1",
        graderVersion: "g1",
        rubricVersion: "r1",
        outcome: "accepted",
        rubricPassed: true,
        checks: [
          { id: "persist", passed: true },
          { id: "display", passed: true },
        ],
      },
    },
  };
  return value;
}

test("only an independent complete grade earns autonomous acceptance", () => {
  const accepted = controlled("accepted");
  const noGrade = controlled("ungraded");
  noGrade.evaluation.trial.acceptance = null;
  const failedEarly = controlled("early");
  failedEarly.candidates = [];
  failedEarly.evaluation.trial.acceptance = null;
  const [variant] = summary([accepted, noGrade, failedEarly]).variants;
  assert.equal(variant.acceptedDeliveryRate, 1 / 3);
  assert.equal(variant.trialOutcomes.ungraded, 1);
  assert.equal(variant.trialOutcomes.failed, 1);
  assert.equal(summary([accepted, noGrade]).decisions[0].variants[0].eligible, false);
});

for (const [name, change] of [
  [
    "workflow failed after passing verification",
    (value) => {
      value.status = "failed";
    },
  ],
  [
    "workflow stopped before approval",
    (value) => {
      value.status = "ready-for-final-review";
    },
  ],
  [
    "missing final review",
    (value) => {
      value.runs = value.runs.filter((run) => run.stage !== "final-review");
    },
  ],
  [
    "stale final review",
    (value) => {
      value.runs.at(-1).candidateRevision = 0;
    },
  ],
  [
    "failed final review",
    (value) => {
      value.runs.at(-1).status = "failed";
    },
  ],
  [
    "review of a different SHA",
    (value) => {
      value.runs.at(-1).candidateHeadRevision = "c".repeat(40);
    },
  ],
  [
    "review without a recorded SHA",
    (value) => {
      delete value.runs.at(-1).candidateHeadRevision;
    },
  ],
  [
    "forged fresh projection",
    (value) => {
      value.gateFreshness = { "final-review": { fresh: true } };
      value.runs = [];
    },
  ],
  [
    "active run reservation",
    (value) => {
      value.activeRunReservationId = "still-running";
    },
  ],
  [
    "stale candidate",
    (value) => {
      value.candidates[0].headRevision = "c".repeat(40);
    },
  ],
  [
    "human rescue",
    (value) => {
      value.evaluation.trial.humanRescue = true;
    },
  ],
  [
    "failed independent check",
    (value) => {
      value.evaluation.trial.acceptance.checks[0].passed = false;
    },
  ],
  [
    "failed rubric",
    (value) => {
      value.evaluation.trial.acceptance.rubricPassed = false;
    },
  ],
  [
    "changed grader",
    (value) => {
      value.evaluation.trial.acceptance.graderVersion = "g2";
    },
  ],
  [
    "exceeded allowance",
    (value) => {
      value.usage.totalTokens = 1001;
    },
  ],
]) {
  test(`${name} cannot earn acceptance`, () => {
    const value = controlled(name);
    change(value);
    assert.equal(summary([value]).variants[0].acceptedDeliveryRate, 0);
  });
}

test("pending and cancelled trials block ranking rather than silently disappearing", () => {
  for (const status of ["pending", "cancelled"]) {
    const waiting = controlled(status);
    waiting.experiment.variantId = "b";
    if (status === "pending") waiting.evaluation = null;
    else waiting.evaluation.trial.status = "cancelled";
    const report = summary([controlled("done"), waiting]);
    assert.equal(report.decisions[0].leader, null);
    assert.equal(report.decisions[0].comparable, false);
    assert.equal(report.variants[1].trialOutcomes[status], 1);
  }
});

test("adjudicated invalid trials remain in operational outcomes and resource totals", () => {
  const invalid = controlled("invalid");
  invalid.evaluation.trial.status = "invalid";
  const [variant] = summary([controlled("done"), invalid]).variants;
  assert.equal(variant.acceptedDeliveryRate, 1);
  assert.equal(variant.operationalAcceptanceRate, 0.5);
  assert.equal(variant.trialOutcomes.invalid, 1);
  assert.equal(variant.apiEstimate, 2);
  assert.equal(variant.apiEstimatePerAcceptance, 2);
});

test("a partly priced policy has no comparable total or cost per acceptance", () => {
  const value = controlled("partial");
  value.runs = [
    ...value.runs,
    { model: "gpt-5.6-sol", reasoning: "high", usage: { totalTokens: 100, cost: 1 } },
    { model: "gpt-6-astra", reasoning: "high", usage: { totalTokens: 100, cost: null } },
  ];
  const [variant] = summary([value]).variants;
  assert.equal(variant.apiEstimate, null);
  assert.equal(variant.apiEstimateKnownSubtotal, 1);
  assert.equal(variant.apiEstimatePerAcceptance, null);
  assert.deepEqual(variant.costCoverage, { pricedAttempts: 1, totalAttempts: 2 });
});

test("failed attempts without artifacts still consume the budget", () => {
  const value = controlled("failed-cost");
  value.runs = [
    { model: "gpt-5.6-sol", usage: { totalTokens: 700, cost: 1 } },
    { model: "gpt-5.6-sol", status: "failed", usage: { totalTokens: 700, cost: 2 } },
  ];
  const [variant] = summary([value]).variants;
  assert.equal(variant.budgetStatus, "exceeded");
  assert.equal(variant.apiEstimate, 3);
  assert.equal(variant.acceptedDeliveryRate, 0);
});

test("missing one budget dimension does not prove the allowance was met", () => {
  const value = controlled("unknown-usage");
  value.runs = [{ model: "gpt-5.6-sol", status: "failed", usage: null }];
  const report = summary([value]);
  assert.equal(report.variants[0].budgetStatus, "unmeasured");
  assert.equal(report.decisions[0].variants[0].eligible, false);
});

test("changing the harness environment or workflow invalidates a comparison", () => {
  const other = controlled("other");
  other.experiment.variantId = "b";
  other.experiment.evaluationContract.executionVersion = "different-tools";
  const [decision] = summary([controlled("original"), other]).decisions;
  assert.equal(decision.comparable, false);
  assert.equal(decision.leader, null);
});

test("the effective policy is compared with the frozen matrix, not just self-reported selection", () => {
  const value = delivered("changed-selection");
  value.experiment.policyMatrix = { plan: { model: "gpt-5.6-sol", reasoning: "high" } };
  value.runs = [
    {
      stage: "plan",
      model: "gpt-6-astra",
      reasoning: "high",
      selectedModel: "gpt-6-astra",
      selectedReasoning: "high",
    },
  ];
  assert.equal(summary([value]).variants[0].comparability.status, "mixed-identity");
});

test("changing argv behind the same command IDs invalidates frozen verification", () => {
  const value = delivered("changed-command");
  value.experiment.verificationManifest = {
    commands: [{ id: "test", command: ["npm", "test"], timeoutMs: 1000, report: null }],
  };
  value.candidates[0].verificationRuns[0].declaredCommands = [
    { id: "test", command: ["true"], timeoutMs: 1000, report: null },
  ];
  assert.equal(summary([value]).variants[0].deterministicDeliveryRate, 0);
});

test("external trial receipt validates candidate and frozen grader at the write boundary", () => {
  const value = controlled("boundary");
  const receipt = {
    ...value.evaluation.trial,
    reason: "Qualified",
    evidence: "/results/trial.json",
    evaluator: "external-v1",
  };
  assert.ok(normalizeEvaluationInput({ trial: receipt }, null, value).trial.acceptance);
  assert.throws(
    () =>
      normalizeEvaluationInput(
        { trial: { ...receipt, acceptance: { ...receipt.acceptance, headRevision: "stale" } } },
        null,
        value,
      ),
    /final candidate/,
  );
  assert.throws(
    () => normalizeEvaluationInput({ trial: { ...receipt, status: "invalid" } }, null, value),
    /apparatus/,
  );
  assert.throws(
    () => normalizeEvaluationInput({ trial: receipt }, null, { ...value, status: "running" }),
    /Stop the trial/,
  );
  assert.throws(
    () =>
      normalizeEvaluationInput(
        { trial: { ...receipt, acceptance: { ...receipt.acceptance, checks: [] } } },
        null,
        value,
      ),
    /every frozen/,
  );
});

test("controlled subjective scores follow their candidate and become stale after repair", () => {
  const value = delivered("quality");
  value.evaluation = normalizeEvaluationInput({ score: 5, outcome: "accepted", kind: "blind" }, null, value);
  assert.equal(summary([value]).variants[0].averageBlindScore, 5);
  value.candidates[0].headRevision = "c".repeat(40);
  assert.equal(summary([value]).variants[0].averageBlindScore, null);
});

test("experiment normalization freezes complete command definitions and grader identity", () => {
  const value = controlled("normalize");
  const manifest = {
    version: 1,
    commands: [
      { id: "test", command: ["npm", "test"] },
      { id: "lint", command: ["npm", "run", "lint"] },
    ],
  };
  const normalized = normalizeExperimentInput(
    { ...value.experiment, verificationManifest: manifest },
    value.experiment,
  );
  assert.equal(normalized.verificationManifest.commands[0].timeoutMs, 600000);
  assert.equal(normalized.evaluationContract.graderVersion, "g1");
  assert.throws(
    () =>
      normalizeExperimentInput(
        { ...value.experiment, verificationManifest: { version: 1, commands: [manifest.commands[0]] } },
        value.experiment,
      ),
    /complete manifest/,
  );
});

test("dispatch allowance stops new agent calls after time, tokens or attempts run out", async () => {
  const { evaluationAllowance, normalizeEvaluationLimits } = await import(
    "../server/evaluation-allowance.mjs"
  );
  const value = controlled("bounded");
  const now = Date.parse(value.startedAt) + 10;
  value.experiment.evaluationLimits = normalizeEvaluationLimits({ maxAgentRuns: 2 }, value.experiment.budget);
  assert.equal(evaluationAllowance(value, now).remainingMs, 119990);
  assert.throws(() => evaluationAllowance(value, now + 120000), /exhausted/);
  value.runs = [{ model: "gpt-5.6-sol", completedAt: value.updatedAt, usage: { totalTokens: 1000 } }];
  assert.throws(() => evaluationAllowance(value, now), /exhausted/);
  value.runs = [{ model: "gpt-5.6-sol" }, { model: "gpt-5.6-sol" }];
  assert.throws(() => evaluationAllowance(value, now), /exhausted/);
  value.runs = [{ model: "gpt-5.6-sol", completedAt: value.updatedAt, usage: null }];
  assert.throws(() => evaluationAllowance(value, now), /missing prior usage/);
  delete value.experiment.evaluationLimits;
  assert.equal(evaluationAllowance(value, now), null);
});

test("the orchestrator refuses provider dispatch after the frozen invocation allowance", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { JsonTaskStore, TaskOrchestrator, waitUntil } = await import("./orchestrator-test-support.mjs");
  const directory = await mkdtemp(path.join(os.tmpdir(), "eval-allowance-"));
  const store = new JsonTaskStore(path.join(directory, "tasks.json"));
  await store.init();
  const created = await store.create({
    title: "Investigate compatibility",
    description: "Preserve existing behavior",
    repositoryPath: directory,
    workflow: "investigate",
    priority: "medium",
  });
  await store.update(created.id, (draft) => {
    draft.experiment = {
      budget: { maxWallTimeMs: 60000, maxTotalTokens: 10000 },
      evaluationLimits: { maxAgentRuns: 1 },
    };
  });
  let calls = 0;
  const orchestrator = new TaskOrchestrator(store, {
    getStatus: async () => ({ available: true, authenticated: true }),
    runCodex: async () => {
      calls += 1;
      return {
        finalText: "Repository evidence",
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      };
    },
  });
  try {
    await orchestrator.start(created.id);
    await waitUntil(async () => !orchestrator.isRunning(created.id));
    const final = await store.get(created.id);
    assert.equal(calls, 1);
    assert.match(final.error, /Scout coverage was incomplete/);
    assert.ok(final.scoutDispatch.selected.every((scout) => /allowance exhausted/.test(scout.error)));
  } finally {
    await orchestrator.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
