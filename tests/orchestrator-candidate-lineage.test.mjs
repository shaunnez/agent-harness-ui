import test from "node:test";
import {
  assert,
  CANONICAL_RUN_STAGES,
  DEFAULT_STAGE_RUN_LIMIT,
  gateOutput,
  JsonTaskStore,
  makeGateResult,
  makeRuntimeRun,
  makeRuntimeTask,
  makeTestRow,
  migrateRunActivityState,
  mkdtemp,
  os,
  parseFocusedTestEvidence,
  parseGateEvidence,
  path,
  RUNTIME_FRESHNESS_REASONS,
  readExplicitCandidateBinding,
  refreshGateFreshness,
  rm,
  stageRunLimitFor,
  TaskOrchestrator,
  validateFocusedTestEvidence,
} from "./orchestrator-test-support.mjs";

test("rejects generic candidate identity fields at every structured evidence boundary", () => {
  assert.deepEqual(readExplicitCandidateBinding({ id: "C1", revisionNumber: 2 }), {
    valid: false,
    candidateId: null,
    candidateRevision: null,
    code: "missing_binding",
    copy: RUNTIME_FRESHNESS_REASONS.missing_binding,
  });
  assert.throws(
    () =>
      parseFocusedTestEvidence(
        `<focused-test-evidence>{"id":"C1","revisionNumber":2,"command":"npm test","status":"passed","rows":[{"id":"row-1","status":"passed"}]}</focused-test-evidence>`,
      ),
    (error) => error.code === "missing_binding",
  );
  assert.throws(
    () =>
      parseGateEvidence(
        `<gate-evidence>{"id":"C1","revisionNumber":2,"verdict":"PASS","findings":[]}</gate-evidence>`,
        { id: "C1", revisionNumber: 2 },
        "dev-review",
      ),
    (error) => error.code === "missing_binding",
  );
  assert.equal(
    readExplicitCandidateBinding({ candidateId: "C1", candidateRevision: 0 }).code,
    "malformed_binding",
  );
  assert.equal(
    readExplicitCandidateBinding({ candidateId: "C1", candidateRevision: "2" }).code,
    "malformed_binding",
  );
  assert.equal(
    readExplicitCandidateBinding({ candidateId: "", candidateRevision: 2 }).code,
    "malformed_binding",
  );
});

test("rejects mixed candidate summaries with the exact stale reason", () => {
  const mixedGate = makeRuntimeRun({
    gateResult: makeGateResult({
      findings: [
        {
          severity: "P2",
          title: "C1 finding",
          detail: "Bound to C1.",
          candidateId: "C1",
          candidateRevision: 2,
        },
        {
          severity: "P2",
          title: "C2 finding",
          detail: "Bound to C2.",
          candidateId: "C2",
          candidateRevision: 2,
        },
      ],
    }),
  });
  const mixedGateTask = makeRuntimeTask({ runs: [mixedGate] });
  refreshGateFreshness(mixedGateTask);
  assert.equal(mixedGateTask.gateFreshness["dev-review"].reasonCode, "mixed_evidence");

  const mixedWithParentOnly = makeRuntimeRun({
    gateResult: makeGateResult({
      findings: [
        {
          severity: "P2",
          title: "C2 finding",
          detail: "Bound to C2.",
          candidateId: "C2",
          candidateRevision: 2,
        },
      ],
    }),
  });
  const parentMixedTask = makeRuntimeTask({ runs: [mixedWithParentOnly] });
  refreshGateFreshness(parentMixedTask);
  assert.equal(parentMixedTask.gateFreshness["dev-review"].reasonCode, "mixed_evidence");
});

test("rejects every non-null malformed or unknown persisted evidence error", () => {
  const cases = [
    { name: "unknown code", evidenceError: { code: "unknown_schema_error", copy: "Unknown schema error." } },
    { name: "primitive value", evidenceError: "malformed evidence error" },
    { name: "empty string", evidenceError: "" },
    { name: "zero", evidenceError: 0 },
    { name: "false", evidenceError: false },
    {
      name: "success code used as an error",
      evidenceError: { code: "fresh", copy: RUNTIME_FRESHNESS_REASONS.fresh },
    },
    {
      name: "known code with malformed copy",
      evidenceError: { code: "timeout", copy: "Different timeout copy." },
    },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({ id: `RUN-EVIDENCE-ERROR-${item.name}`, evidenceError: item.evidenceError });
    const task = makeRuntimeTask({ runs: [run] });
    refreshGateFreshness(task);

    assert.equal(task.gateFreshness["dev-review"].fresh, false, item.name);
    assert.equal(task.gateFreshness["dev-review"].reasonCode, "malformed_binding", item.name);
    assert.equal(
      task.gateFreshness["dev-review"].reasonCopy,
      RUNTIME_FRESHNESS_REASONS.malformed_binding,
      item.name,
    );
    assert.deepEqual(run.evidenceError, item.evidenceError, `${item.name}: retained for audit`);
  }

  const knownError = { code: "timeout", copy: RUNTIME_FRESHNESS_REASONS.timeout };
  const knownRun = makeRuntimeRun({ id: "RUN-EVIDENCE-ERROR-KNOWN", evidenceError: knownError });
  const knownTask = makeRuntimeTask({ runs: [knownRun] });
  refreshGateFreshness(knownTask);
  assert.equal(knownTask.gateFreshness["dev-review"].reasonCode, "timeout");
  assert.deepEqual(knownRun.evidenceError, knownError, "valid persisted error remains intact for audit");
});

test("migrates legacy and partial stage limits without changing attempt counters", () => {
  const task = makeRuntimeTask({ events: [] });
  task.stageRunLimit = 5;
  task.stageRunLimits = { implement: 7, test: 0, "dev-review": null };
  task.attemptsByStage = { implement: 4, test: 2, "dev-review": 1 };
  const state = { schemaVersion: 3, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.deepEqual(
    task.stageRunLimits,
    Object.fromEntries(
      CANONICAL_RUN_STAGES.map((stage) => [stage, stage === "implement" ? 7 : stage === "test" ? 0 : 5]),
    ),
  );
  assert.deepEqual(task.attemptsByStage, { implement: 4, test: 2, "dev-review": 1 });
  assert.equal(task.stageRunLimit, 5, "the legacy scalar remains available for compatibility");
  assert.equal(stageRunLimitFor(task, "implement"), 7);
  assert.equal(stageRunLimitFor(task, "test"), 0);
  assert.equal(stageRunLimitFor(task, "dev-review"), 5);
  assert.equal(stageRunLimitFor(task, "unknown"), DEFAULT_STAGE_RUN_LIMIT);

  const migrated = structuredClone(state);
  assert.equal(migrateRunActivityState(state), false, "a complete migration is idempotent");
  assert.deepEqual(state, migrated);

  const defaultedTask = makeRuntimeTask({ events: [] });
  const defaultedState = { schemaVersion: 3, tasks: [defaultedTask] };
  assert.equal(migrateRunActivityState(defaultedState), true);
  assert.deepEqual(
    defaultedTask.stageRunLimits,
    Object.fromEntries(CANONICAL_RUN_STAGES.map((stage) => [stage, DEFAULT_STAGE_RUN_LIMIT])),
  );
});

test("structured ingestion preserves mixed, revision-change, and candidate-mismatch reason codes", () => {
  const candidate = { id: "C1", revisionNumber: 2 };
  const oldRevision = gateOutput(1);
  const otherCandidate = gateOutput(2).replace('"candidateId":"C1"', '"candidateId":"C2"');
  const mixedGate = gateOutput(2, "PASS", [
    {
      severity: "P2",
      title: "Old revision",
      detail: "Retained historical finding.",
      candidateId: "C1",
      candidateRevision: 1,
    },
  ]);
  const mixedTest = `<focused-test-evidence>${JSON.stringify({
    candidateId: "C1",
    candidateRevision: 2,
    command: "npm test",
    status: "passed",
    rows: [makeTestRow(), makeTestRow({ id: "row-old", candidateRevision: 1 })],
  })}</focused-test-evidence>`;

  assert.throws(
    () => parseGateEvidence(oldRevision, candidate, "dev-review"),
    (error) => error.code === "revision_change",
  );
  assert.throws(
    () => parseGateEvidence(otherCandidate, candidate, "dev-review"),
    (error) => error.code === "candidate_mismatch",
  );
  assert.throws(
    () => parseGateEvidence(mixedGate, candidate, "dev-review"),
    (error) => error.code === "mixed_evidence",
  );
  assert.throws(
    () => parseFocusedTestEvidence(mixedTest),
    (error) => error.code === "mixed_evidence",
  );

  const parsedOldTest = parseFocusedTestEvidence(
    `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 1,
      command: "npm test",
      status: "passed",
      rows: [makeTestRow({ candidateRevision: 1 })],
    })}</focused-test-evidence>`,
  );
  assert.throws(
    () => validateFocusedTestEvidence(parsedOldTest, candidate),
    (error) => error.code === "revision_change",
  );
});

test("unresolvable attempt evidence fails closed and blocks approval", async () => {
  // Malformed, missing, repeated, or decreasing attempt evidence cannot identify an
  // authoritative terminal run. Every case fails closed rather than falling back to
  // persisted array position, which could otherwise resurrect an older PASS.
  for (const { earlierAttempt, laterAttempt, laterStatus, expectedReason } of [
    { earlierAttempt: 1, laterAttempt: null, laterStatus: "completed", expectedReason: "malformed_attempt" },
    { earlierAttempt: 1, laterAttempt: "2", laterStatus: "completed", expectedReason: "malformed_attempt" },
    { earlierAttempt: 2, laterAttempt: 1, laterStatus: "failed", expectedReason: "ambiguous_attempt" },
    { earlierAttempt: 2, laterAttempt: 2, laterStatus: "failed", expectedReason: "ambiguous_attempt" },
  ]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-legacy-attempt-"));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: "Reject superseded pass",
        description: "Persisted terminal order controls when attempt metadata is unavailable.",
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
          makeRuntimeRun({ id: "RUN-EARLIER-PASS", attempt: earlierAttempt, gateResult: makeGateResult() }),
          makeRuntimeRun({
            id: "RUN-LATER-TERMINAL",
            attempt: laterAttempt,
            status: laterStatus,
            gateResult: null,
          }),
        ];
        refreshGateFreshness(draft);
      });

      const persisted = await store.get(task.id);
      assert.equal(persisted.gateFreshness["dev-review"].sourceRunId, null);
      assert.equal(persisted.gateFreshness["dev-review"].fresh, false);
      assert.equal(persisted.gateFreshness["dev-review"].reasonCode, expectedReason);

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
      assert.equal(merged, false);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});
