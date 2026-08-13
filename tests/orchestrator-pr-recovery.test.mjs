import test from "node:test";
import {
  assert,
  attachRunArtifact,
  createApprovalReadyTask,
  JsonTaskStore,
  makeArtifact,
  makeFocusedTestSummary,
  makeGateResult,
  makePersistedFinding,
  makeRuntimeRun,
  makeRuntimeTask,
  makeTestRow,
  mkdtemp,
  os,
  path,
  pullRequestObservation,
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

test("raises an exact-candidate GitHub PR and completes only after polling observes its merge", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-pr-lifecycle-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await createApprovalReadyTask(store, directory, "Raise a governed PR");
    let state = "open";
    const pullRequestManager = {
      async publish({ candidate, intent }) {
        assert.equal(candidate.headRevision, "b".repeat(40));
        assert.equal(intent.note, "Approved for GitHub review.");
        return pullRequestObservation({ state: "open" });
      },
      async inspect(intent) {
        assert.equal(intent.number, 84);
        return pullRequestObservation({ state });
      },
    };
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { async verifyCandidate() {} },
      pullRequestManager,
    });

    const opened = await orchestrator.approvePullRequest(task.id, "Approved for GitHub review.");
    assert.equal(opened.status, "awaiting-pr-merge");
    assert.equal(opened.candidates.at(-1).status, "pull_request_open");
    assert.equal(opened.pullRequestIntent.status, "open");
    assert.equal(opened.pullRequestIntent.number, 84);
    assert.equal(opened.approvals.length, 1);
    assert.match(opened.artifacts.at(-1).content, /github\.com\/acme\/widgets\/pull\/84/i);
    assert.equal(opened.completedStages.includes("approval"), false);

    const openedUpdatedAt = opened.updatedAt;
    await orchestrator.pollPullRequests();
    const stillOpen = await store.get(task.id);
    assert.equal(stillOpen.status, "awaiting-pr-merge");
    assert.equal(stillOpen.pullRequestIntent.consecutivePollFailures, 0);
    assert.equal(
      stillOpen.updatedAt,
      openedUpdatedAt,
      "poll telemetry must not masquerade as semantic task progress",
    );

    state = "merged";
    await orchestrator.pollPullRequests();
    const completed = await store.get(task.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.candidates.at(-1).status, "merged");
    assert.equal(completed.pullRequestIntent.status, "merged");
    assert.equal(completed.pullRequestIntent.mergeCommitRevision, "c".repeat(40));
    assert.equal(completed.completedStages.includes("approval"), true);
    assert.match(completed.events.at(-1).title, /GitHub PR merged/i);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("retains open PR state across transient polling errors and blocks a closed-unmerged PR", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-pr-polling-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await createApprovalReadyTask(store, directory, "Poll a governed PR");
    let inspection = "error";
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { async verifyCandidate() {} },
      pullRequestManager: {
        async publish() {
          return pullRequestObservation({ state: "open" });
        },
        async inspect() {
          if (inspection === "error") throw new Error("GitHub is temporarily unavailable.");
          return pullRequestObservation({ state: "closed" });
        },
      },
    });
    await orchestrator.approvePullRequest(task.id);
    const openedUpdatedAt = (await store.get(task.id)).updatedAt;

    await orchestrator.pollPullRequests();
    const unavailable = await store.get(task.id);
    assert.equal(unavailable.status, "awaiting-pr-merge");
    assert.equal(unavailable.pullRequestIntent.status, "open");
    assert.equal(unavailable.pullRequestIntent.consecutivePollFailures, 1);
    assert.match(unavailable.pullRequestIntent.lastError, /temporarily unavailable/i);
    assert.equal(unavailable.updatedAt, openedUpdatedAt);

    inspection = "closed";
    await orchestrator.pollPullRequests();
    const closed = await store.get(task.id);
    assert.equal(closed.status, "blocked");
    assert.equal(closed.blocker.code, "pull-request-closed");
    assert.equal(closed.pullRequestIntent.status, "closed");
    assert.equal(closed.completedStages.includes("approval"), false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("merge approval fails closed when persisted Test verdicts contradict", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-stale-approval-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject stale approval",
      description: "Status fields cannot override authoritative gate freshness.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
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
      const devReview = makeRuntimeRun({ id: "RUN-DEV", stage: "dev-review", artifactId: "ART-DEV" });
      const testRun = makeRuntimeRun({
        id: "RUN-TEST",
        stage: "test",
        kind: "test",
        artifactId: "ART-TEST",
        gateResult: makeGateResult({ stage: "test", verdict: "PASS", reportedVerdict: "REPAIR" }),
      });
      const finalReview = makeRuntimeRun({
        id: "RUN-FINAL",
        stage: "final-review",
        artifactId: "ART-FINAL",
        gateResult: makeGateResult({ stage: "final-review" }),
      });
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 2,
        bindingExplicit: true,
        command: "npm test",
        status: "passed",
        rows: [makeTestRow()],
      };
      draft.runs = [devReview, testRun, finalReview];
      draft.artifacts = [
        makeArtifact({ id: "ART-DEV" }),
        makeArtifact({ id: "ART-TEST", stage: "test", gateResult: testRun.gateResult, focusedTest }),
        makeArtifact({ id: "ART-FINAL", stage: "final-review", gateResult: finalReview.gateResult }),
      ];
      attachRunArtifact(draft, "RUN-TEST", draft.artifacts[1]);
      refreshGateFreshness(draft);
    });

    const beforeApproval = await store.get(task.id);
    assert.equal(beforeApproval.gateFreshness["dev-review"].fresh, true);
    assert.equal(beforeApproval.gateFreshness.test.fresh, false);
    assert.equal(beforeApproval.gateFreshness.test.reasonCode, "contradictory_evidence");
    assert.equal(beforeApproval.gateFreshness["final-review"].fresh, true);
    assert.equal(
      beforeApproval.runs.find((run) => run.id === "RUN-TEST").gateResult.reportedVerdict,
      "REPAIR",
    );

    let merged = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        async merge() {
          merged = true;
        },
      },
    });

    await assert.rejects(() => orchestrator.approveMerge(task.id), /cannot be approved.*not fresh/i);
    const rejected = await store.get(task.id);
    assert.equal(rejected.status, "awaiting-human-approval");
    assert.equal(rejected.mergeIntent, null);
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("merge approval fails closed when persisted gate findings are malformed", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-malformed-finding-approval-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject malformed gate findings",
      description: "Persisted finding shapes must not authorize a merge.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
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
      const malformedFinding = makePersistedFinding({ severity: "p0" });
      const devReview = makeRuntimeRun({
        id: "RUN-DEV-MALFORMED",
        stage: "dev-review",
        gateResult: makeGateResult({ stage: "dev-review", findings: [malformedFinding] }),
      });
      const testRun = makeRuntimeRun({
        id: "RUN-TEST-MALFORMED",
        stage: "test",
        kind: "test",
        artifactId: "ART-TEST-MALFORMED",
        gateResult: makeGateResult({ stage: "test", findings: [malformedFinding] }),
      });
      const finalReview = makeRuntimeRun({
        id: "RUN-FINAL-MALFORMED",
        stage: "final-review",
        gateResult: makeGateResult({ stage: "final-review", findings: [malformedFinding] }),
      });
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 2,
        bindingExplicit: true,
        command: "npm test",
        status: "passed",
        rows: [makeTestRow()],
      };
      const testArtifact = makeArtifact({
        id: "ART-TEST-MALFORMED",
        stage: "test",
        gateResult: testRun.gateResult,
        focusedTest,
      });
      draft.runs = [devReview, testRun, finalReview];
      draft.artifacts = [testArtifact];
      attachRunArtifact(draft, testRun.id, testArtifact);
      refreshGateFreshness(draft);
    });

    const beforeApproval = await store.get(task.id);
    for (const stage of ["dev-review", "test", "final-review"]) {
      assert.equal(beforeApproval.gateFreshness[stage].fresh, false, stage);
      assert.equal(beforeApproval.gateFreshness[stage].reasonCode, "contradictory_evidence", stage);
    }

    let merged = false;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        async merge() {
          merged = true;
        },
      },
    });
    await assert.rejects(() => orchestrator.approveMerge(task.id), /cannot be approved.*not fresh/i);
    const rejected = await store.get(task.id);
    assert.equal(rejected.mergeIntent, null);
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("blocks a failed pending merge and idempotently reconciles the retained approval intent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-merge-recovery-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Recover merge",
      description: "Finalize a merge that completed before task persistence.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
    });
    await store.update(task.id, (draft) => {
      draft.status = "merging";
      draft.currentStage = "approval";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "feature",
          baseRef: "refs/heads/feature",
          headRevision: "b".repeat(40),
          branch: "agent-harness/ah-001-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "awaiting_human_approval",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        },
      ];
      draft.mergeIntent = {
        candidateId: "C1",
        candidateRevision: 1,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        targetRef: "refs/heads/feature",
        note: "Approved before restart.",
        status: "pending",
        startedAt: new Date().toISOString(),
        completedAt: null,
        error: null,
      };
      const devReview = makeRuntimeRun({
        id: "RUN-DEV-RECOVERY",
        stage: "dev-review",
        candidateRevision: 1,
        artifactId: "ART-DEV-RECOVERY",
        gateResult: makeGateResult({ candidateRevision: 1 }),
      });
      const testRun = makeRuntimeRun({
        id: "RUN-TEST-RECOVERY",
        stage: "test",
        kind: "test",
        candidateRevision: 1,
        artifactId: "ART-TEST-RECOVERY",
        gateResult: makeGateResult({ stage: "test", candidateRevision: 1 }),
      });
      const finalReview = makeRuntimeRun({
        id: "RUN-FINAL-RECOVERY",
        stage: "final-review",
        candidateRevision: 1,
        artifactId: "ART-FINAL-RECOVERY",
        gateResult: makeGateResult({ stage: "final-review", candidateRevision: 1 }),
      });
      const focusedTest = {
        candidateId: "C1",
        candidateRevision: 1,
        bindingExplicit: true,
        command: "npm test",
        status: "passed",
        rows: [makeTestRow({ candidateRevision: 1 })],
      };
      draft.runs = [devReview, testRun, finalReview];
      draft.artifacts = [
        makeArtifact({ id: "ART-DEV-RECOVERY", candidateRevision: 1, gateResult: devReview.gateResult }),
        makeArtifact({
          id: "ART-TEST-RECOVERY",
          stage: "test",
          candidateRevision: 1,
          gateResult: testRun.gateResult,
          focusedTest,
        }),
        makeArtifact({
          id: "ART-FINAL-RECOVERY",
          stage: "final-review",
          candidateRevision: 1,
          gateResult: finalReview.gateResult,
        }),
      ];
      attachRunArtifact(draft, testRun.id, draft.artifacts[1]);
      refreshGateFreshness(draft);
    });
    let mergeCalls = 0;
    let mergeStateCalls = 0;
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        mergeState: async () => {
          mergeStateCalls += 1;
          if (mergeStateCalls === 1)
            throw new Error("Known fast-forward failure after approval intent was recorded.");
          return "merged";
        },
        merge: async () => {
          mergeCalls += 1;
        },
      },
    });

    await orchestrator.recoverMergeIntents();
    const blocked = await store.get(task.id);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blocker.code, "merge-reconciliation");
    assert.equal(blocked.mergeIntent.status, "failed");
    assert.match(blocked.mergeIntent.error, /Known fast-forward failure/);

    await orchestrator.reconcileMerge(task.id);
    await orchestrator.reconcileMerge(task.id);
    const recovered = await store.get(task.id);
    assert.equal(recovered.status, "merged-to-target");
    assert.equal(recovered.mergeIntent.status, "completed");
    assert.equal(recovered.mergeIntent.note, "Approved before restart.");
    assert.equal(recovered.mergeIntent.reconciliationAttempts, 1);
    assert.equal(recovered.approvals.filter((approval) => approval.stage === "approval").length, 1);
    assert.equal(mergeCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refreshes a target-diverged candidate as a new revision and invalidates downstream gates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-refresh-candidate-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Refresh candidate",
      description: "Replay an approved candidate onto the latest target.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const oldBase = "a".repeat(40);
    const oldHead = "b".repeat(40);
    const targetHead = "c".repeat(40);
    const refreshedHead = "d".repeat(40);
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "approval";
      draft.error = "The recorded target ref diverged while recovering a pending merge.";
      draft.blocker = { code: "target-diverged", detail: draft.error, detectedAt: new Date().toISOString() };
      draft.completedStages = [
        "triage",
        "scouts",
        "grill",
        "specification",
        "plan",
        "implement",
        "dev-review",
        "test",
        "final-review",
      ];
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: oldBase,
          baseBranch: "main",
          baseRef: "refs/heads/main",
          headRevision: oldHead,
          branch: "agent-harness/ah-001-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "awaiting_human_approval",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [
            { number: 1, headRevision: oldHead, reason: "assembly", createdAt: new Date().toISOString() },
          ],
        },
      ];
      draft.mergeIntent = { status: "failed", error: draft.error };
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: {
        refreshCandidate: async () => ({
          previousBaseRevision: oldBase,
          previousHeadRevision: oldHead,
          targetRevision: targetHead,
          headRevision: refreshedHead,
          files: ["src/change.ts"],
          summary: "1 file changed",
        }),
      },
    });

    await orchestrator.refreshCandidate(task.id);
    const refreshed = await store.get(task.id);
    const candidate = refreshed.candidates[0];
    assert.equal(refreshed.status, "ready-for-review");
    assert.equal(refreshed.currentStage, "dev-review");
    assert.equal(refreshed.error, null);
    assert.equal(refreshed.blocker, null);
    assert.equal(refreshed.mergeIntent, null);
    assert.equal(candidate.revisionNumber, 2);
    assert.equal(candidate.baseRevision, targetHead);
    assert.equal(candidate.headRevision, refreshedHead);
    assert.equal(candidate.revisions.at(-1).reason, "target-refresh");
    assert.equal(refreshed.mergeIntent, null);
    assert.equal(refreshed.mergeIntentHistory.length, 1);
    assert.equal(refreshed.mergeIntentHistory[0].status, "failed");
    assert.equal(refreshed.mergeIntentHistory[0].supersededByCandidateRevision, 2);
    assert.deepEqual(refreshed.completedStages, [
      "triage",
      "scouts",
      "grill",
      "specification",
      "plan",
      "implement",
    ]);
    assert.match(refreshed.events.at(-1).detail, /must pass every candidate-bound gate again/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("blocks a candidate gate on target drift before reserving an attempt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-gate-target-drift-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Pause stale candidate gate",
      description: "Do not spend a review attempt after the target advances.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = 2;
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          baseRef: "refs/heads/main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/stale-candidate",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_review",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        },
      ];
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { mergeState: async () => "diverged" },
    });

    await assert.rejects(
      () => orchestrator.start(task.id, "review"),
      /Refresh the candidate before spending another candidate-bound gate attempt/,
    );
    const blocked = await store.get(task.id);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blocker.code, "target-diverged");
    assert.equal(blocked.attemptsByStage["dev-review"], 2);
    assert.equal(blocked.activeRunKind, null);
    assert.match(blocked.events.at(-1).detail, /No gate attempt was spent/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
