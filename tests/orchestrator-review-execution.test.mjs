import test from "node:test";
import {
  assert,
  gateOutput,
  harnessEvidence,
  JsonTaskStore,
  makeGateResult,
  makeRuntimeRun,
  mkdtemp,
  os,
  path,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  rm,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

test("malformed focused Test ingestion persists the exact reason and blocks approval", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-malformed-test-evidence-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject malformed focused Test evidence",
      description: "Malformed row and timestamp fields must fail closed from ingestion through approval.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 2,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/ah-005-c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_test",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        },
      ];
    });

    let merged = false;
    const _malformedRowOutput = `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm test",
      status: "passed",
      rows: [
        {
          id: { value: "row-1" },
          candidateId: "C1",
          candidateRevision: 2,
          command: "npm test",
          status: "passed",
          title: "focused test",
          artifactReferences: [],
          assertions: [],
          failureDetails: null,
        },
      ],
    })}</focused-test-evidence>`;
    const _malformedTimestampOutput = `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm test",
      status: "passed",
      startedAt: { timestamp: "2026-08-01T12:00:00.000Z" },
      completedAt: "2026-08-01T12:01:00.000Z",
      rows: [
        {
          id: "row-1",
          candidateId: "C1",
          candidateRevision: 2,
          command: "npm test",
          status: "passed",
          title: "focused test",
          artifactReferences: [],
          assertions: [],
          failureDetails: null,
        },
      ],
    })}</focused-test-evidence>`;
    // Now asserts the harness fails closed on evidence *it* produced rather than on a model's.
    // The model is no longer the source, but `validateFocusedTestEvidence` still stands between
    // the harness and a gate, so a verification bug cannot become a silent pass.
    //
    // The reason codes moved with the source, and that is not an assertion being loosened.
    // `contradictory_evidence` was reachable here only by *parsing model text*, which this path
    // no longer does; what remains checkable about harness-built evidence is its candidate
    // binding, so these are the two failures that are still possible: a row bound to a
    // different revision, and evidence that never claimed a binding at all.
    const malformedEvidence = [
      (candidate) =>
        harnessEvidence(candidate, {
          rows: [{ ...harnessEvidence(candidate).rows[0], candidateRevision: candidate.revisionNumber + 1 }],
        }),
      (candidate) => harnessEvidence(candidate, { bindingExplicit: false }),
    ];
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [{ id: "test", command: ["npm", "test"] }],
      }),
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: {
        async verifyCandidate() {},
        async recoverCandidate() {},
        async merge() {
          merged = true;
        },
      },
      runVerification: async ({ candidate }) => malformedEvidence.shift()(candidate),
      runCodex: async () => ({
        finalText: "## Verdict\n\nPASS\n\n## Checks\n\nThe harness reported one passing command.",
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "test"), true);
    const afterMalformedRow = await waitForStatus(store, task.id, "ready-for-test");
    assert.equal(
      afterMalformedRow.runs.find((run) => run.stage === "test").evidenceError.code,
      "mixed_evidence",
    );

    assert.equal(await orchestrator.start(task.id, "test"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-test");
    const testRuns = finished.runs.filter((run) => run.stage === "test");
    assert.equal(testRuns.length, 2);
    assert.equal(testRuns.at(-1).evidenceError.code, "missing_binding");
    assert.equal(testRuns.at(-1).evidenceError.copy, RUNTIME_FRESHNESS_REASONS.missing_binding);
    assert.equal(finished.gateFreshness.test.sourceRunId, testRuns.at(-1).id);
    assert.equal(finished.gateFreshness.test.reasonCode, "missing_binding");

    await store.update(task.id, (draft) => {
      draft.status = "awaiting-human-approval";
      // Local merge is opt-in now; this test drives that path deliberately.
      draft.approvalCompletion = "local-merge";
      draft.currentStage = "approval";
      draft.candidates.at(-1).status = "awaiting_human_approval";
      draft.runs.push(
        makeRuntimeRun({ id: "RUN-DEV-FRESH-AFTER-MALFORMED-TEST" }),
        makeRuntimeRun({
          id: "RUN-FINAL-FRESH-AFTER-MALFORMED-TEST",
          stage: "final-review",
          gateResult: makeGateResult({ stage: "final-review" }),
        }),
      );
      refreshGateFreshness(draft);
    });

    await assert.rejects(
      () => orchestrator.approveMerge(task.id),
      // Same assertion, matching the reason copy for the failure harness-built evidence can
      // actually have — a missing candidate binding rather than contradictory parsed fields.
      /cannot be approved.*Test is not fresh.*explicit candidateId/i,
    );
    assert.equal(merged, false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("persists exact structured-evidence reason codes through a failed review run", async () => {
  const cases = [
    { name: "old revision", output: gateOutput(1), code: "revision_change" },
    {
      name: "mixed findings",
      output: gateOutput(2, "PASS", [
        {
          severity: "P2",
          title: "Old revision",
          detail: "Retained historical finding.",
          candidateId: "C1",
          candidateRevision: 1,
        },
      ]),
      code: "mixed_evidence",
    },
    {
      name: "unsupported finding field type",
      output: gateOutput(2, "PASS", [
        {
          severity: "P2",
          title: 42,
          detail: "A numeric title must not be normalized into persisted evidence.",
          candidateId: "C1",
          candidateRevision: 2,
        },
      ]),
      code: "contradictory_evidence",
      verifyApprovalBlocked: true,
    },
    {
      name: "unsupported finding severity",
      output: gateOutput(2, "PASS", [
        {
          severity: "critical",
          title: "Unsupported severity",
          detail: "The severity is outside the persisted gate schema.",
          candidateId: "C1",
          candidateRevision: 2,
        },
      ]),
      code: "contradictory_evidence",
      verifyApprovalBlocked: true,
    },
    {
      name: "empty finding title",
      output: gateOutput(2, "PASS", [
        {
          severity: "P2",
          title: "   ",
          detail: "The title is required by the persisted gate schema.",
          candidateId: "C1",
          candidateRevision: 2,
        },
      ]),
      code: "contradictory_evidence",
      verifyApprovalBlocked: true,
    },
    {
      name: "invalid verdict",
      output: gateOutput(2).replace('"verdict":"PASS"', '"verdict":"UNKNOWN"'),
      code: "contradictory_evidence",
      verifyApprovalBlocked: true,
    },
  ];

  for (const item of cases) {
    const directory = await mkdtemp(path.join(os.tmpdir(), `agent-harness-evidence-${item.code}-`));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: `Reject ${item.name}`,
        description: "Persist the exact structured evidence failure.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        draft.candidates = [
          {
            id: "C1",
            revisionNumber: 2,
            baseRevision: "a".repeat(40),
            baseBranch: "main",
            headRevision: "b".repeat(40),
            branch: "agent-harness/ah-005-c1",
            repositoryRoot: directory,
            worktreePath: directory,
            status: "under_review",
            createdAt: "2026-08-01T12:00:00.000Z",
            updatedAt: "2026-08-01T12:00:00.000Z",
            revisions: [],
          },
        ];
      });
      const orchestrator = new TaskOrchestrator(store, {
        getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
        worktreeManager: { verifyCandidate: async () => {} },
        runCodex: async () => ({
          finalText: item.output,
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        }),
      });

      assert.equal(await orchestrator.start(task.id, "review"), true);
      const finished = await waitForStatus(store, task.id, "review-retry-required");
      const run = finished.runs.find((entry) => entry.stage === "dev-review");
      assert.equal(run.evidenceError.code, item.code, item.name);
      assert.equal(run.evidenceError.copy, RUNTIME_FRESHNESS_REASONS[item.code], item.name);
      assert.equal(run.freshness.reasonCode, item.code, item.name);
      assert.equal(finished.gateFreshness["dev-review"].reasonCode, item.code, item.name);
      assert.match(finished.events.at(-1).title, /rerun required/i, item.name);
      assert.match(
        finished.events.at(-1).detail,
        new RegExp(RUNTIME_FRESHNESS_REASONS[item.code]),
        item.name,
      );
      assert.equal(finished.candidates.at(-1).revisionNumber, 2, item.name);
      assert.equal(finished.candidates.at(-1).status, "review_retry_required", item.name);
      assert.equal(finished.reviewRetries.length, 1, item.name);
      if (item.verifyApprovalBlocked) {
        await store.update(task.id, (draft) => {
          draft.status = "awaiting-human-approval";
          // Local merge is opt-in now; this test drives that path deliberately.
          draft.approvalCompletion = "local-merge";
          draft.currentStage = "approval";
          draft.candidates.at(-1).status = "awaiting_human_approval";
        });
        await assert.rejects(
          () => orchestrator.approveMerge(task.id),
          /cannot be approved.*Development Review is not fresh.*contradictory/i,
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("candidate command failure overrides a Development Review PASS and remains rerunnable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-review-command-failure-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reject unsupported review pass",
      description: "Candidate command telemetry must override narrative PASS.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/review-command-failure",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_review",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        },
      ];
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: { verifyCandidate: async () => {} },
      runCodex: async ({ onEvent }) => {
        onEvent?.({
          type: "activity",
          tone: "warning",
          title: "Repository command returned a warning",
          detail: "backend/.venv/bin/python -m pytest tests/unit",
          commandFailed: true,
          runtimeScope: "candidate",
          toolCall: {
            id: "cmd-failed",
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 1",
          },
        });
        return {
          finalText: gateOutput(1),
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    const finished = await waitForStatus(store, task.id, "review-retry-required");
    const run = finished.runs.find((entry) => entry.stage === "dev-review");
    const artifact = finished.artifacts.find((entry) => entry.id === run.artifactId);
    assert.equal(run.gateResult.reportedVerdict, "PASS");
    assert.equal(run.gateResult.verdict, "REPAIR");
    assert.equal(run.evidenceError.code, "review_tooling_failure");
    assert.equal(run.freshness.reasonCode, "review_tooling_failure");
    assert.equal(run.toolCalls[0].commandFailed, true);
    assert.equal(run.toolCalls[0].runtimeScope, "candidate");
    assert.equal(run.toolCalls[0].result, "Exit code 1");
    assert.equal(artifact.gateResult.verdict, "REPAIR");
    assert.equal(finished.candidates[0].status, "review_retry_required");
    assert.equal(finished.reviewRetries.length, 1);
    assert.match(finished.events.at(-1).title, /rerun required/i);

    assert.equal(await orchestrator.start(task.id, "review"), true);
    let repeated = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const current = await store.get(task.id);
      if (
        current.status === "review-retry-required" &&
        current.attemptsByStage["dev-review"] === 2 &&
        current.activeRunIds.length === 0
      ) {
        repeated = current;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(repeated);
    assert.equal(repeated.status, "review-retry-required");
    assert.equal(repeated.reviewRetries.length, 2);
    assert.equal(repeated.stageRunLimits["dev-review"], 2, "the same failure stops after one bounded retry");
    assert.match(repeated.error, /human must inspect/i);
    assert.equal(
      await orchestrator.start(task.id, "review"),
      false,
      "another review requires an explicit human retry grant",
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("stops Development Review when it exceeds the hard repository-command budget", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-review-command-budget-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Bound review cost",
      description: "A reviewer must not inventory the repository.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/review-command-budget",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_review",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        },
      ];
    });
    const orchestrator = new TaskOrchestrator(store, {
      worktreeManager: { verifyCandidate: async () => {} },
      runCodex: async ({ onEvent }) => {
        for (let index = 1; index <= 9; index += 1) {
          onEvent?.({
            type: "activity",
            tone: "info",
            title: "Inspecting repository",
            detail: `git show file-${index}`,
            toolCall: {
              id: `cmd-${index}`,
              name: "command_execution",
              category: "repository-command",
              phase: "started",
              result: null,
            },
          });
        }
        return {
          finalText: gateOutput(1),
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    const failed = await waitForStatus(store, task.id, "failed");
    assert.match(failed.error, /hard 4-command review budget/i);
    assert.equal(failed.runs.at(-1).status, "failed");
    assert.ok(failed.events.some((event) => event.title === "Review command budget exceeded"));
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("reviewer command failure never authorizes candidate Repair even when the reviewer reports REPAIR", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-review-command-repair-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Repair a candidate despite failed review telemetry",
      description: "A command failure blocks promotion without erasing an exact REPAIR finding.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.candidates = [
        {
          id: "C1",
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: "b".repeat(40),
          branch: "agent-harness/review-command-repair",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_review",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        },
      ];
    });

    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: { verifyCandidate: async () => {} },
      runCodex: async ({ onEvent }) => {
        onEvent?.({
          type: "activity",
          tone: "warning",
          title: "Repository command returned a warning",
          detail: "npm test",
          commandFailed: true,
          runtimeScope: "candidate",
          toolCall: {
            id: "cmd-failed",
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 1",
          },
        });
        return {
          finalText: gateOutput(1, "REPAIR", [
            {
              severity: "P1",
              title: "Candidate defect",
              detail: "Repair the exact candidate before promotion.",
              candidateId: "C1",
              candidateRevision: 1,
            },
          ]),
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    const retryReady = await waitForStatus(store, task.id, "review-retry-required");
    assert.equal(retryReady.gateFreshness["dev-review"].reasonCode, "review_tooling_failure");
    assert.equal(retryReady.runs.at(-1).gateResult.verdict, "REPAIR");
    assert.equal(retryReady.runs.at(-1).gateResult.findings[0].blocking, true);
    assert.equal(retryReady.runs.at(-1).toolCalls[0].commandFailed, true);
    assert.equal(retryReady.candidates[0].status, "review_retry_required");
    assert.equal(await orchestrator.start(task.id, "repair"), false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
