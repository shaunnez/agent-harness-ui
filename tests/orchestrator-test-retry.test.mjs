import test from "node:test";
import {
  assert,
  attachRunArtifact,
  beginAgentRun,
  harnessEvidence,
  JsonTaskStore,
  makeArtifact,
  makeFocusedTestSummary,
  makeGateResult,
  makeRuntimeRun,
  makeRuntimeTask,
  makeTestRow,
  mkdtemp,
  os,
  path,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  rm,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

test("an exact failed Focused Test permits one explicit same-candidate rerun without authorizing repair", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-failed-test-command-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Repair an exact failed Focused Test",
      description:
        "Harness-observed failed Test evidence may receive one bounded human-authorized same-revision rerun.",
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
          branch: "agent-harness/failed-focused-test",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_test",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        },
      ];
    });
    let verificationCount = 0;
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: {
        verifyCandidate: async () => {},
        recoverCandidate: async () => false,
      },
      runVerification: async ({ candidate }) => {
        verificationCount += 1;
        const failedRow = {
          ...harnessEvidence(candidate).rows[0],
          status: "failed",
          assertions: [{ label: "exit code", actual: "1", expected: "0" }],
          failureDetails: "npm test exited 1.",
        };
        return harnessEvidence(candidate, { status: "failed", rows: [failedRow] });
      },
      runCodex: async ({ onEvent }) => {
        onEvent?.({
          type: "activity",
          tone: "warning",
          title: "Repository command returned a warning",
          detail: "rg optional-pattern",
          commandFailed: true,
          runtimeScope: "candidate",
          toolCall: {
            id: "cmd-interpreter-failed",
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 1",
          },
        });
        return {
          finalText: "## Interpretation\n\nThe harness-observed Test failed.",
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "test"), true);
    const repairReady = await waitForStatus(store, task.id, "repair-required");
    const testRun = repairReady.runs.find((run) => run.stage === "test");
    assert.equal(testRun.test.status, "failed");
    assert.equal(
      testRun.evidenceError.code,
      "review_tooling_failure",
      "failed interpreter telemetry remains retained",
    );
    assert.equal(testRun.toolCalls[0].commandFailed, true);
    assert.equal(repairReady.gateFreshness.test.reasonCode, "repair_required");
    assert.equal(repairReady.gateFreshness.test.focusedTest.status, "failed");
    assert.equal(repairReady.candidates.at(-1).status, "repair_required");

    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.attemptsByStage.test = draft.stageRunLimits.test;
      draft.candidates.at(-1).status = "ready_for_test";
    });

    assert.deepEqual(await orchestrator.retryTestOnSameCandidate(task.id), { started: true });
    const failedAgain = await waitForStatus(store, task.id, "repair-required");
    assert.equal(verificationCount, 2);
    assert.equal(failedAgain.sameCandidateTestRetries.length, 1);
    assert.equal(failedAgain.sameCandidateTestRetries[0].candidateRevision, 2);
    assert.equal(failedAgain.candidates[0].verificationRuns[0].retryDisposition, "human-rerun-requested");
    assert.equal(failedAgain.candidates[0].revisionNumber, 2);
    await assert.rejects(
      () => orchestrator.retryTestOnSameCandidate(task.id),
      /already used its one same-candidate Test retry/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("missing authoritative output retains the candidate and permits only the same gate rerun", async () => {
  const cases = [
    {
      stage: "dev-review",
      kind: "review",
      taskStatus: "review-retry-required",
      candidateStatus: "review_retry_required",
      label: "Development review",
    },
    // The test stage is deliberately absent. This case is "a model returned no authoritative
    // structured evidence", and for `test` that is no longer a possible failure: the harness
    // builds that evidence from commands it executed itself (#47), so there is no model answer
    // to be missing. The failure modes that remain for harness-built test evidence are covered
    // by "malformed focused Test ingestion" above and by tests/verification.test.mjs — which
    // also covers the new one, a repository that declares no verification commands at all.
    {
      stage: "final-review",
      kind: "final-review",
      taskStatus: "ready-for-final-review",
      candidateStatus: "ready_for_final_review",
      label: "Final review",
    },
  ];

  for (const item of cases) {
    const directory = await mkdtemp(path.join(os.tmpdir(), `agent-harness-${item.stage}-rerun-`));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: `Rerun malformed ${item.stage}`,
        description: "Malformed gate evidence must not create a candidate repair.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = item.taskStatus;
        draft.currentStage = item.stage;
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
            status: item.candidateStatus,
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
          finalText: "## Verdict\n\nPASS without the required structured evidence block.",
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        }),
      });

      assert.equal(await orchestrator.start(task.id, item.kind), true);
      let finished = await waitForStatus(store, task.id, item.taskStatus);
      assert.equal(finished.candidates.at(-1).revisionNumber, 2, item.stage);
      assert.equal(finished.candidates.at(-1).status, item.candidateStatus, item.stage);
      assert.equal(finished.attemptsByStage[item.stage], 1, item.stage);
      assert.equal(finished.runs.at(-1).evidenceError.code, "missing_authoritative_summary", item.stage);
      assert.equal(finished.runs.at(-1).freshness.reasonCode, "missing_authoritative_summary", item.stage);
      assert.equal(finished.events.at(-1).title, `${item.label} rerun required`, item.stage);
      assert.equal(
        finished.events.at(-1).detail,
        `C1 revision 2 could not accept the persisted gate evidence. ${RUNTIME_FRESHNESS_REASONS.missing_authoritative_summary}`,
        item.stage,
      );

      for (const otherKind of ["review", "test", "final-review", "repair"].filter(
        (kind) => kind !== item.kind,
      )) {
        assert.equal(await orchestrator.start(task.id, otherKind), false, `${item.stage}: ${otherKind}`);
      }
      assert.equal(await orchestrator.start(task.id, item.kind), true, `${item.stage}: same gate rerun`);
      finished = await waitForStatus(store, task.id, item.taskStatus);
      assert.equal(finished.candidates.at(-1).revisionNumber, 2, `${item.stage}: rerun revision`);
      assert.equal(finished.attemptsByStage[item.stage], 2, `${item.stage}: retained attempts`);
      assert.equal(
        finished.runs.filter((run) => run.stage === item.stage).length,
        2,
        `${item.stage}: retained runs`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});

test("filters focused Test rows to the exact candidate and retains invalid rows for audit", () => {
  const testRun = makeRuntimeRun({ id: "RUN-TEST", stage: "test", kind: "test", artifactId: "ART-TEST" });
  const testArtifact = makeArtifact({
    id: "ART-TEST",
    stage: "test",
    focusedTest: {
      candidateId: "C1",
      candidateRevision: 2,
      bindingExplicit: true,
      command: "npm test",
      status: "passed",
      rows: [
        makeTestRow({ id: "row-current", candidateId: "C1", candidateRevision: 2 }),
        makeTestRow({ id: "row-old", candidateId: "C1", candidateRevision: 1 }),
      ],
    },
  });
  const testTask = makeRuntimeTask({ runs: [testRun], artifacts: [testArtifact] });
  attachRunArtifact(testTask, testRun.id, testArtifact);
  assert.equal(testTask.gateFreshness.test.fresh, false);
  assert.equal(testTask.gateFreshness.test.reasonCode, "mixed_evidence");
  assert.deepEqual(testTask.gateFreshness.test.focusedTestRows, []);
  assert.equal(testTask.runs[0].test.rows.length, 2, "historical rows remain retained for audit");

  const exactTestRun = makeRuntimeRun({
    id: "RUN-TEST-EXACT",
    stage: "test",
    kind: "test",
    artifactId: "ART-TEST-EXACT",
  });
  const exactTestArtifact = makeArtifact({
    id: "ART-TEST-EXACT",
    stage: "test",
    focusedTest: {
      candidateId: "C1",
      candidateRevision: 2,
      bindingExplicit: true,
      command: "npm test",
      status: "passed",
      rows: [makeTestRow({ id: "row-exact-1" }), makeTestRow({ id: "row-exact-2" })],
    },
  });
  const exactTestTask = makeRuntimeTask({ runs: [exactTestRun], artifacts: [exactTestArtifact] });
  attachRunArtifact(exactTestTask, exactTestRun.id, exactTestArtifact);
  assert.equal(exactTestTask.gateFreshness.test.fresh, true);
  assert.deepEqual(
    exactTestTask.gateFreshness.test.focusedTestRows.map((row) => row.id),
    ["row-exact-1", "row-exact-2"],
  );

  const parentMixedRun = makeRuntimeRun({
    id: "RUN-TEST-PARENT-MIXED",
    stage: "test",
    kind: "test",
    artifactId: "ART-TEST-PARENT-MIXED",
  });
  const parentMixedArtifact = makeArtifact({
    id: "ART-TEST-PARENT-MIXED",
    stage: "test",
    focusedTest: {
      candidateId: "C1",
      candidateRevision: 2,
      bindingExplicit: true,
      command: "npm test",
      status: "passed",
      rows: [makeTestRow({ id: "row-other-candidate", candidateId: "C2" })],
    },
  });
  const parentMixedTask = makeRuntimeTask({ runs: [parentMixedRun], artifacts: [parentMixedArtifact] });
  attachRunArtifact(parentMixedTask, parentMixedRun.id, parentMixedArtifact);
  assert.equal(parentMixedTask.gateFreshness.test.reasonCode, "mixed_evidence");
  assert.deepEqual(parentMixedTask.gateFreshness.test.focusedTestRows, []);

  const failedTestRun = makeRuntimeRun({
    id: "RUN-TEST-FAILED",
    stage: "test",
    kind: "test",
    artifactId: "ART-TEST-FAILED",
  });
  const failedFocusedTest = {
    candidateId: "C1",
    candidateRevision: 2,
    bindingExplicit: true,
    command: "npm test",
    status: "failed",
    rows: [makeTestRow({ id: "row-failed", status: "failed" })],
  };
  const failedTestArtifact = makeArtifact({
    id: "ART-TEST-FAILED",
    stage: "test",
    gateResult: makeGateResult({
      stage: "test",
      verdict: "REPAIR",
      reportedVerdict: "REPAIR",
      blockingReasons: ["A verification command failed."],
    }),
    focusedTest: failedFocusedTest,
  });
  const failedTestTask = makeRuntimeTask({ runs: [failedTestRun], artifacts: [failedTestArtifact] });
  attachRunArtifact(failedTestTask, failedTestRun.id, failedTestArtifact);
  assert.equal(failedTestTask.gateFreshness.test.fresh, false);
  assert.equal(failedTestTask.gateFreshness.test.reasonCode, "repair_required");
  assert.equal(failedTestTask.gateFreshness.test.focusedTest.status, "failed");
  assert.deepEqual(
    failedTestTask.gateFreshness.test.focusedTestRows.map((row) => row.id),
    ["row-failed"],
  );

  const failedWithInterpreterCommandRun = makeRuntimeRun({
    id: "RUN-TEST-FAILED-INTERPRETER-COMMAND",
    stage: "test",
    kind: "test",
    artifactId: "ART-TEST-FAILED-INTERPRETER-COMMAND",
    gateResult: failedTestArtifact.gateResult,
    evidenceError: { code: "command_failure", copy: RUNTIME_FRESHNESS_REASONS.command_failure },
  });
  failedWithInterpreterCommandRun.toolCalls = [
    {
      id: "cmd-interpreter-failed",
      name: "command_execution",
      category: "repository-command",
      phase: "completed",
      result: "Exit code 1",
      commandFailed: true,
      runtimeScope: "candidate",
    },
  ];
  const failedWithInterpreterCommandArtifact = makeArtifact({
    id: "ART-TEST-FAILED-INTERPRETER-COMMAND",
    stage: "test",
    gateResult: failedTestArtifact.gateResult,
    focusedTest: failedFocusedTest,
  });
  failedWithInterpreterCommandArtifact.evidenceError = {
    code: "command_failure",
    copy: RUNTIME_FRESHNESS_REASONS.command_failure,
  };
  const failedWithInterpreterCommandTask = makeRuntimeTask({
    runs: [failedWithInterpreterCommandRun],
    artifacts: [failedWithInterpreterCommandArtifact],
  });
  attachRunArtifact(
    failedWithInterpreterCommandTask,
    failedWithInterpreterCommandRun.id,
    failedWithInterpreterCommandArtifact,
  );
  assert.equal(failedWithInterpreterCommandTask.gateFreshness.test.reasonCode, "repair_required");
  assert.equal(failedWithInterpreterCommandTask.gateFreshness.test.focusedTest.status, "failed");

  for (const blockingReason of [
    "A test command failed.",
    "Editorial guidance only; no execution failure is represented by this field.",
  ]) {
    const repairRun = makeRuntimeRun({
      id: `RUN-TEST-REPAIR-${blockingReason.slice(0, 8)}`,
      stage: "test",
      kind: "test",
      gateResult: makeGateResult({
        stage: "test",
        verdict: "REPAIR",
        reportedVerdict: "REPAIR",
        blockingReasons: [blockingReason],
      }),
      test: makeFocusedTestSummary(),
    });
    const repairTask = makeRuntimeTask({ runs: [repairRun] });
    refreshGateFreshness(repairTask);
    assert.equal(repairTask.gateFreshness.test.reasonCode, "repair_required", blockingReason);
  }
});

test("latest terminal exact-candidate attempt wins and older passes become superseded", () => {
  const first = makeRuntimeRun({
    id: "RUN-1",
    attempt: 1,
    artifactId: "ART-1",
    gateResult: makeGateResult(),
  });
  const second = makeRuntimeRun({
    id: "RUN-2",
    attempt: 2,
    artifactId: "ART-2",
    gateResult: makeGateResult({
      verdict: "REPAIR",
      reportedVerdict: "REPAIR",
      blockingReasons: ["P1: repair"],
    }),
  });
  const task = makeRuntimeTask({
    runs: [first, second],
    artifacts: [makeArtifact({ id: "ART-1" }), makeArtifact({ id: "ART-2", gateResult: second.gateResult })],
  });
  refreshGateFreshness(task);
  assert.equal(task.gateFreshness["dev-review"].sourceRunId, "RUN-2");
  assert.equal(task.gateFreshness["dev-review"].reasonCode, "repair_required");
  assert.equal(task.runs[0].freshness.reasonCode, "superseded_attempt");
  assert.equal(task.runs[1].freshness.reasonCode, "repair_required");
  assert.equal(task.artifacts[0].freshness.reasonCode, "superseded_attempt");
  assert.equal(task.artifacts[1].freshness.reasonCode, "repair_required");

  for (const { earlierAttempt, laterAttempt } of [
    { earlierAttempt: 2, laterAttempt: 1 },
    { earlierAttempt: 2, laterAttempt: 2 },
  ]) {
    const earlierPass = makeRuntimeRun({
      id: `RUN-EARLIER-${earlierAttempt}-${laterAttempt}`,
      attempt: earlierAttempt,
      gateResult: makeGateResult(),
    });
    const laterRepair = makeRuntimeRun({
      id: `RUN-LATER-${earlierAttempt}-${laterAttempt}`,
      attempt: laterAttempt,
      gateResult: makeGateResult({
        verdict: "REPAIR",
        reportedVerdict: "REPAIR",
        blockingReasons: ["P1: repair"],
      }),
    });
    // Attempts are assigned monotonically as runs are appended, so a repeated or
    // decreasing attempt means persisted order and attempt order disagree. Neither
    // signal may silently win: the gate fails closed and no run is authoritative.
    const conflictingAttemptTask = makeRuntimeTask({ runs: [earlierPass, laterRepair] });
    refreshGateFreshness(conflictingAttemptTask);
    assert.equal(conflictingAttemptTask.gateFreshness["dev-review"].sourceRunId, null);
    assert.equal(conflictingAttemptTask.gateFreshness["dev-review"].fresh, false);
    assert.equal(conflictingAttemptTask.gateFreshness["dev-review"].reasonCode, "ambiguous_attempt");
    assert.equal(laterRepair.id.length > 0, true);
  }

  const unrelated = makeRuntimeRun({
    id: "RUN-C2",
    candidateId: "C2",
    candidateRevision: 8,
    attempt: 99,
    artifactId: "ART-C2",
    gateResult: makeGateResult({ candidateId: "C2", candidateRevision: 8 }),
  });
  const exact = makeRuntimeRun({
    id: "RUN-EXACT",
    attempt: 1,
    artifactId: "ART-EXACT",
    gateResult: makeGateResult(),
  });
  const exactTask = makeRuntimeTask({
    runs: [exact, unrelated],
    artifacts: [
      makeArtifact({ id: "ART-EXACT" }),
      makeArtifact({
        id: "ART-C2",
        candidateId: "C2",
        candidateRevision: 8,
        gateResult: unrelated.gateResult,
      }),
    ],
  });
  refreshGateFreshness(exactTask);
  assert.equal(exactTask.gateFreshness["dev-review"].sourceRunId, "RUN-EXACT");
  assert.equal(exactTask.gateFreshness["dev-review"].fresh, true);

  const malformed = makeRuntimeRun({
    id: "RUN-MALFORMED",
    attempt: 2,
    candidateRevision: "2",
    artifactId: null,
  });
  const malformedTask = makeRuntimeTask({
    runs: [exact, malformed],
    artifacts: [makeArtifact({ id: "ART-EXACT" })],
  });
  refreshGateFreshness(malformedTask);
  assert.equal(malformedTask.gateFreshness["dev-review"].sourceRunId, "RUN-MALFORMED");
  assert.equal(malformedTask.gateFreshness["dev-review"].fresh, false);
  assert.equal(malformedTask.gateFreshness["dev-review"].reasonCode, "malformed_binding");
  assert.equal(malformedTask.runs[0].freshness.reasonCode, "superseded_attempt");

  const revisionTask = makeRuntimeTask({
    runs: [
      makeRuntimeRun({
        id: "RUN-R1",
        candidateRevision: 1,
        gateResult: makeGateResult({ candidateRevision: 1 }),
      }),
    ],
  });
  const nextRevisionRun = beginAgentRun(revisionTask, {
    id: "RUN-R2",
    kind: "review",
    stage: "dev-review",
    role: "dev-review",
    candidateId: "C1",
    candidateRevision: 2,
  });
  assert.equal(nextRevisionRun.attempt, 1, "attempt numbering is scoped to the exact candidate revision");
});

test("repair revision invalidates all candidate-bound gates while retaining evidence and lineage", () => {
  const stages = ["dev-review", "test", "final-review"];
  const runs = stages.map((stage) =>
    makeRuntimeRun({
      id: `RUN-${stage}`,
      stage,
      kind: stage === "test" ? "test" : "review",
      candidateRevision: 1,
      artifactId: `ART-${stage}`,
      gateResult: stage === "test" ? null : makeGateResult({ stage, candidateRevision: 1 }),
    }),
  );
  const testRun = runs.find((run) => run.stage === "test");
  const testArtifact = makeArtifact({
    id: "ART-test",
    stage: "test",
    candidateRevision: 1,
    gateResult: makeGateResult({ stage: "test", candidateRevision: 1 }),
    focusedTest: {
      candidateId: "C1",
      candidateRevision: 1,
      bindingExplicit: true,
      command: "npm test",
      status: "passed",
      rows: [makeTestRow({ candidateRevision: 1 })],
    },
  });
  const artifacts = runs.map((run) =>
    run.stage === "test"
      ? testArtifact
      : makeArtifact({
          id: run.artifactId,
          stage: run.stage,
          candidateRevision: 1,
          gateResult: makeGateResult({ stage: run.stage, candidateRevision: 1 }),
        }),
  );
  const events = runs.map((run) => ({
    id: `EVENT-${run.id}`,
    runId: run.id,
    stage: run.stage,
  }));
  events.push({
    id: "EVENT-LEGACY-DEV-REVIEW-PASS",
    at: "2026-08-01T12:02:00.000Z",
    category: "decision",
    tone: "success",
    stage: "dev-review",
    title: "Development review passed",
    detail: "C1 revision 1 advanced to the next gate.",
  });
  const task = makeRuntimeTask({
    candidateRevision: 1,
    runs,
    artifacts,
    events,
    revisions: [{ number: 1, reason: "assembly", headRevision: "a".repeat(40) }],
  });
  attachRunArtifact(task, testRun.id, testArtifact);
  refreshGateFreshness(task);
  assert.deepEqual(
    stages.map((stage) => task.gateFreshness[stage].fresh),
    [true, true, true],
  );

  task.candidates[0].revisionNumber = 2;
  task.candidates[0].revisions.push({ number: 2, reason: "repair", headRevision: "b".repeat(40) });
  refreshGateFreshness(task);

  for (const stage of stages) {
    assert.equal(task.gateFreshness[stage].reasonCode, "revision_change", stage);
  }
  assert.equal(
    task.runs.every((run) => run.freshness.reasonCode === "revision_change"),
    true,
  );
  assert.equal(
    task.artifacts.every((artifact) => artifact.freshness.reasonCode === "revision_change"),
    true,
  );
  assert.equal(
    task.events
      .filter((event) => event.runId)
      .every((event) => event.freshness.reasonCode === "revision_change"),
    true,
  );
  const legacyPassEvent = task.events.find((event) => event.id === "EVENT-LEGACY-DEV-REVIEW-PASS");
  assert.equal(legacyPassEvent.runId, undefined);
  assert.equal(legacyPassEvent.freshness.sourceRunId, null);
  assert.deepEqual(legacyPassEvent.freshness.target, { candidateId: "C1", candidateRevision: 2 });
  assert.equal(legacyPassEvent.freshness.reasonCode, "missing_binding");
  assert.equal(legacyPassEvent.freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.missing_binding);
  assert.equal(
    legacyPassEvent.title,
    "Development review passed",
    "historical event copy remains intact for audit",
  );
  assert.equal(
    legacyPassEvent.tone,
    "success",
    "historical execution tone remains intact in persisted evidence",
  );
  assert.equal(task.artifacts.length, 3);
  assert.equal(task.artifacts[0].content, "# retained evidence");
  assert.deepEqual(
    task.candidates[0].revisions.map((revision) => revision.reason),
    ["assembly", "repair"],
  );
  assert.equal(testRun.test.rows.length, 1);
});
