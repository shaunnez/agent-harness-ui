import test from "node:test";
import {
  assert,
  JsonTaskStore,
  makeArtifact,
  makeFocusedTestSummary,
  makeGateResult,
  makeRuntimeRun,
  makeRuntimeTask,
  mkdtemp,
  os,
  path,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  rm,
  TaskOrchestrator,
} from "./orchestrator-test-support.mjs";

test("refreshes the pricing registry without rewriting legacy task estimates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-pricing-verifier-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reprice recorded usage",
      description: "Keep historical API-rate estimates aligned with the verified rate card.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      model: "gpt-5.6-luna",
      reasoning: "low",
    });
    await store.update(task.id, (draft) => {
      const usage = {
        inputTokens: 200_000,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
        totalTokens: 1_200_000,
      };
      draft.usage = usage;
      draft.artifacts.push({
        id: "priced-artifact",
        stage: "triage",
        name: "triage.md",
        kind: "markdown",
        content: "Recorded usage",
        createdAt: new Date().toISOString(),
        model: "gpt-5.6-luna",
        reasoning: "low",
        usage,
      });
    });
    let call;
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: async (options) => {
        call = options;
        return {
          finalText: `<pricing-rates>${JSON.stringify({
            "gpt-5.6-sol": { short: { input: 5, cachedInput: 0.5, cacheWrite: 6.25, output: 30 } },
            "gpt-5.6-terra": { short: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 } },
            "gpt-5.6-luna": { short: { input: 0.25, cachedInput: 0.03, cacheWrite: 0.3, output: 1.3 } },
          })}</pricing-rates>`,
          usage: { inputTokens: 1_000, cachedInputTokens: 800, outputTokens: 100, totalTokens: 1_100 },
        };
      },
    });

    const result = await orchestrator.verifyPricing();
    assert.equal(call.sandbox, "read-only");
    assert.equal(call.reasoning, "low");
    assert.match(call.prompt, /official OpenAI documentation only/);
    assert.equal(result.settings.pricing.rates["gpt-5.6-sol"].short.output, 30);
    assert.match(result.settings.pricing.verifiedBy, /read-only verification agent/);
    assert.equal(result.usage.cachedInputTokens, 800);
    const historical = await store.get(task.id);
    assert.equal(historical.artifacts[0].usage.cost, undefined);
    assert.equal(historical.usage.cost, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("classifies cross-layer persisted candidate conflicts as mixed evidence before target comparison", () => {
  const cases = [
    {
      name: "stale run with current summary",
      run: makeRuntimeRun({
        candidateRevision: 1,
        gateResult: makeGateResult({ candidateRevision: 2 }),
      }),
      artifacts: [],
    },
    {
      name: "current run with stale summary",
      run: makeRuntimeRun({
        candidateRevision: 2,
        gateResult: makeGateResult({ candidateRevision: 1 }),
      }),
      artifacts: [],
    },
    {
      name: "current run and summary with stale artifact",
      run: makeRuntimeRun({ artifactId: "ART-STALE" }),
      artifacts: [
        makeArtifact({
          id: "ART-STALE",
          candidateRevision: 1,
          gateResult: makeGateResult({ candidateRevision: 2 }),
        }),
      ],
    },
  ];

  for (const item of cases) {
    const task = makeRuntimeTask({ runs: [item.run], artifacts: item.artifacts });
    refreshGateFreshness(task);

    assert.equal(task.gateFreshness["dev-review"].fresh, false, item.name);
    assert.equal(task.gateFreshness["dev-review"].reasonCode, "mixed_evidence", item.name);
    assert.equal(
      task.gateFreshness["dev-review"].reasonCopy,
      RUNTIME_FRESHNESS_REASONS.mixed_evidence,
      item.name,
    );
    assert.deepEqual(
      task.gateFreshness["dev-review"].staleReason,
      {
        code: "mixed_evidence",
        copy: RUNTIME_FRESHNESS_REASONS.mixed_evidence,
      },
      item.name,
    );
    assert.equal(item.run.freshness.reasonCode, "mixed_evidence", `${item.name}: run audit state`);
  }
});

test("merge approval fails closed for malformed persisted errors and failed-row metadata", async () => {
  const cases = [
    {
      name: "unknown Dev Review evidence error",
      expectedStage: "Development Review",
      mutate(runs) {
        runs[0].evidenceError = { code: "unknown_schema_error", copy: "Unknown schema error." };
      },
    },
    {
      name: "missing Test failedRowIds",
      expectedStage: "Test",
      mutate(runs) {
        delete runs[1].test.failedRowIds;
      },
    },
    {
      name: "mismatched Test failedRowIds",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.failedRowIds = ["row-missing"];
      },
    },
    {
      name: "malformed Test summary binding marker",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.bindingExplicit = "true";
      },
    },
    {
      name: "malformed Test row binding marker",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.rows[0].bindingExplicit = "not-a-boolean";
      },
    },
    {
      name: "malformed Test start timestamp",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.startedAt = { timestamp: "2026-08-01T12:00:00.000Z" };
      },
    },
    {
      name: "malformed Test completion timestamp",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.completedAt = ["2026-08-01T12:01:00.000Z"];
      },
    },
    {
      name: "invalid Test start timestamp string",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.startedAt = "not-a-timestamp";
      },
    },
    {
      name: "empty Test completion timestamp string",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.completedAt = "";
      },
    },
    {
      name: "non-canonical Test start timestamp string",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].test.startedAt = "2026-08-01T12:00:00Z";
      },
    },
    {
      name: "missing Dev Review schema version",
      expectedStage: "Development Review",
      mutate(runs) {
        delete runs[0].gateResult.schemaVersion;
      },
    },
    {
      name: "unsupported Test schema version",
      expectedStage: "Test",
      mutate(runs) {
        runs[1].gateResult.schemaVersion = 999;
      },
    },
    {
      name: "malformed Final Review evaluation timestamp",
      expectedStage: "Final Review",
      mutate(runs) {
        runs[2].gateResult.evaluatedAt = { timestamp: "2026-08-01T12:01:00.000Z" };
      },
    },
    {
      name: "Test repair with misleading failure prose",
      expectedStage: "Test",
      expectedReason: "repair_required",
      mutate(runs) {
        runs[1].gateResult = makeGateResult({
          stage: "test",
          verdict: "REPAIR",
          reportedVerdict: "REPAIR",
          blockingReasons: ["A test command failed, according to this human-readable copy."],
        });
      },
    },
  ];

  for (const item of cases) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-malformed-gate-approval-"));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: `Reject ${item.name}`,
        description: "Malformed persisted candidate evidence must block merge approval.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = "awaiting-human-approval";
        // Local merge is opt-in now; this test drives that path deliberately.
        draft.approvalCompletion = "local-merge";
        draft.currentStage = "approval";
        draft.candidates = [
          {
            id: "C1",
            revisionNumber: 2,
            baseRevision: "a".repeat(40),
            baseBranch: "main",
            headRevision: "b".repeat(40),
            status: "awaiting_human_approval",
          },
        ];
        const runs = [
          makeRuntimeRun({ id: "RUN-DEV-MALFORMED-APPROVAL" }),
          makeRuntimeRun({
            id: "RUN-TEST-MALFORMED-APPROVAL",
            stage: "test",
            kind: "test",
            gateResult: makeGateResult({ stage: "test" }),
            test: makeFocusedTestSummary(),
          }),
          makeRuntimeRun({
            id: "RUN-FINAL-MALFORMED-APPROVAL",
            stage: "final-review",
            gateResult: makeGateResult({ stage: "final-review" }),
          }),
        ];
        item.mutate(runs);
        draft.runs = runs;
        refreshGateFreshness(draft);
        if (
          item.expectedStage === "Test" ||
          item.name.includes("schema") ||
          item.name.includes("timestamp")
        ) {
          const stage = {
            "Development Review": "dev-review",
            Test: "test",
            "Final Review": "final-review",
          }[item.expectedStage];
          assert.equal(
            draft.gateFreshness[stage].reasonCode,
            item.expectedReason ?? "contradictory_evidence",
            item.name,
          );
        }
      });

      let merged = false;
      const orchestrator = new TaskOrchestrator(store, {
        worktreeManager: {
          async merge() {
            merged = true;
          },
        },
      });
      await assert.rejects(
        () => orchestrator.approveMerge(task.id),
        new RegExp(`cannot be approved.*${item.expectedStage} is not fresh`, "i"),
      );
      const rejected = await store.get(task.id);
      assert.equal(rejected.mergeIntent, null, item.name);
      assert.equal(merged, false, item.name);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("merge approval fails closed for cross-layer mixed candidate evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-mixed-gate-approval-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject cross-layer mixed evidence",
      description: "Conflicting persisted candidate identities must block merge approval.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
      // Local merge is opt-in now; this test drives that path deliberately.
      draft.approvalCompletion = "local-merge";
      draft.currentStage = "approval";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          status: "awaiting_human_approval",
        },
      ];
      draft.runs = [
        makeRuntimeRun({
          id: "RUN-DEV-MIXED-APPROVAL",
          gateResult: makeGateResult({ candidateRevision: 1 }),
        }),
        makeRuntimeRun({
          id: "RUN-TEST-MIXED-APPROVAL",
          stage: "test",
          kind: "test",
          gateResult: makeGateResult({ stage: "test" }),
          test: makeFocusedTestSummary(),
        }),
        makeRuntimeRun({
          id: "RUN-FINAL-MIXED-APPROVAL",
          stage: "final-review",
          gateResult: makeGateResult({ stage: "final-review" }),
        }),
      ];
      refreshGateFreshness(draft);
      assert.equal(draft.gateFreshness["dev-review"].reasonCode, "mixed_evidence");
      assert.equal(draft.gateFreshness["dev-review"].reasonCopy, RUNTIME_FRESHNESS_REASONS.mixed_evidence);
    });

    let merged = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        async merge() {
          merged = true;
        },
      },
    });
    await assert.rejects(
      () => orchestrator.approveMerge(task.id),
      /cannot be approved.*Development Review is not fresh/i,
    );
    const rejected = await store.get(task.id);
    assert.equal(rejected.gateFreshness["dev-review"].reasonCode, "mixed_evidence");
    assert.equal(rejected.mergeIntent, null);
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
