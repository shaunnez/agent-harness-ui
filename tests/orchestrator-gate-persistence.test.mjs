import test from "node:test";
import {
  assert,
  attachRunArtifact,
  gateOutput,
  makeArtifact,
  makeFocusedTestSummary,
  makeGateResult,
  makePersistedFinding,
  makeRuntimeRun,
  makeRuntimeTask,
  makeTestRow,
  migrateRunActivityState,
  parseGateEvidence,
  RUN_ACTIVITY_EVENT_LIMIT,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  retainRunActivityEvents,
} from "./orchestrator-test-support.mjs";

test("binds gate evidence to the reserving execution provider", () => {
  const reservationFor = (provider) => ({
    "dev-review": {
      id: "RES-DEV",
      stage: "dev-review",
      kind: "review",
      ...(provider === undefined ? {} : { provider }),
      workflowAttempt: 1,
      candidateId: "C1",
      candidateRevision: 2,
      candidateHeadRevision: "abc123",
      authorizedRunScopes: [],
      reservedAt: "2026-08-01T11:59:00.000Z",
    },
  });

  const cases = [
    { name: "matching provider", runProvider: "codex", reservationProvider: "codex", fresh: true },
    {
      name: "absent run provider coalesces to the default",
      runProvider: undefined,
      reservationProvider: "codex",
      fresh: true,
    },
    {
      name: "absent reservation provider coalesces to the default",
      runProvider: undefined,
      reservationProvider: undefined,
      fresh: true,
    },
    {
      name: "matching non-default provider",
      runProvider: "claude",
      reservationProvider: "claude",
      fresh: true,
    },
    {
      name: "cross-provider gate evidence",
      runProvider: "claude",
      reservationProvider: "codex",
      fresh: false,
    },
    { name: "cross-provider reservation", runProvider: "codex", reservationProvider: "claude", fresh: false },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({ gateResult: makeGateResult() });
    if (item.runProvider === undefined) delete run.provider;
    else run.provider = item.runProvider;
    const task = makeRuntimeTask({ runs: [run] });
    task.stageRunReservations = reservationFor(item.reservationProvider);
    refreshGateFreshness(task);
    const freshness = task.gateFreshness["dev-review"];
    assert.equal(freshness.fresh, item.fresh, item.name);
    if (item.fresh) continue;
    assert.equal(freshness.reasonCode, "provider_mismatch", item.name);
    assert.equal(freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.provider_mismatch, item.name);
    assert.deepEqual(
      freshness.staleReason,
      {
        code: "provider_mismatch",
        copy: RUNTIME_FRESHNESS_REASONS.provider_mismatch,
      },
      item.name,
    );
    assert.equal(run.freshness.reasonCode, "provider_mismatch", `${item.name}: run audit state`);
  }
});

test("rejects incomplete or contradictory Dev and Final Review summaries", () => {
  for (const stage of ["dev-review", "final-review"]) {
    const valid = makeGateResult({ stage });
    const cases = [
      { name: "missing stage", gateResult: { ...valid, stage: undefined } },
      { name: "missing findings", gateResult: { ...valid, findings: undefined } },
      { name: "missing reported verdict", gateResult: { ...valid, reportedVerdict: undefined } },
      { name: "reported repair but evaluated pass", gateResult: { ...valid, reportedVerdict: "REPAIR" } },
      { name: "reported pass but evaluated repair", gateResult: { ...valid, verdict: "REPAIR" } },
    ];

    for (const item of cases) {
      const run = makeRuntimeRun({ id: `RUN-${stage}-${item.name}`, stage, gateResult: item.gateResult });
      const task = makeRuntimeTask({ runs: [run] });
      refreshGateFreshness(task);
      const freshness = task.gateFreshness[stage];
      assert.equal(freshness.fresh, false, `${stage}: ${item.name}`);
      assert.equal(freshness.reasonCode, "contradictory_evidence", `${stage}: ${item.name}`);
    }
  }
});

test("rejects malformed persisted finding shapes for every candidate-bound gate", () => {
  const cases = [
    {
      name: "unsupported severity",
      finding: makePersistedFinding({ severity: "p0" }),
      code: "contradictory_evidence",
    },
    { name: "empty title", finding: makePersistedFinding({ title: "   " }), code: "contradictory_evidence" },
    {
      name: "non-string detail",
      finding: makePersistedFinding({ detail: 42 }),
      code: "contradictory_evidence",
    },
    {
      name: "unsupported file type",
      finding: makePersistedFinding({ file: { path: "server/run-activity.mjs" } }),
      code: "contradictory_evidence",
    },
    {
      name: "unsupported line type",
      finding: makePersistedFinding({ line: "371" }),
      code: "contradictory_evidence",
    },
    {
      name: "unsupported binding marker type",
      finding: makePersistedFinding({ bindingExplicit: "true" }),
      code: "contradictory_evidence",
    },
    {
      name: "missing explicit finding binding",
      finding: makePersistedFinding({ candidateId: undefined, candidateRevision: undefined }),
      code: "missing_binding",
    },
  ];
  const focusedTest = {
    candidateId: "C1",
    candidateRevision: 2,
    bindingExplicit: true,
    command: "npm test",
    status: "passed",
    rows: [makeTestRow()],
  };

  for (const stage of ["dev-review", "test", "final-review"]) {
    for (const item of cases) {
      const gateResult = makeGateResult({ stage, findings: [item.finding] });
      const run = makeRuntimeRun({
        id: `RUN-${stage}-${item.name}`,
        stage,
        kind: stage === "test" ? "test" : "review",
        artifactId: stage === "test" ? `ART-${stage}-${item.name}` : null,
        gateResult,
      });
      const artifact =
        stage === "test" ? makeArtifact({ id: run.artifactId, stage, gateResult, focusedTest }) : null;
      const task = makeRuntimeTask({ runs: [run], artifacts: artifact ? [artifact] : [] });
      if (artifact) attachRunArtifact(task, run.id, artifact);
      else refreshGateFreshness(task);

      assert.equal(task.gateFreshness[stage].fresh, false, `${stage}: ${item.name}`);
      assert.equal(task.gateFreshness[stage].reasonCode, item.code, `${stage}: ${item.name}`);
      assert.deepEqual(run.gateResult.findings, [item.finding], `${stage}: ${item.name}: retained for audit`);
    }
  }
});

test("rejects mismatched and contradictory persisted Test gate summaries", () => {
  const focusedTest = {
    candidateId: "C1",
    candidateRevision: 2,
    bindingExplicit: true,
    command: "npm test",
    status: "passed",
    rows: [makeTestRow()],
  };
  const cases = [
    {
      name: "candidate mismatch",
      gateResult: makeGateResult({ stage: "test", candidateId: "C2" }),
      code: "mixed_evidence",
    },
    {
      name: "revision change",
      gateResult: makeGateResult({ stage: "test", candidateRevision: 1 }),
      code: "mixed_evidence",
    },
    {
      name: "wrong stage",
      gateResult: makeGateResult({ stage: "dev-review" }),
      code: "contradictory_evidence",
    },
    {
      name: "missing binding",
      gateResult: {
        ...makeGateResult({ stage: "test" }),
        candidateId: undefined,
        candidateRevision: undefined,
      },
      code: "missing_binding",
    },
    {
      name: "mixed findings",
      gateResult: makeGateResult({
        stage: "test",
        findings: [
          {
            severity: "P2",
            title: "Other candidate",
            detail: "This finding is not bound to the Test candidate.",
            candidateId: "C2",
            candidateRevision: 2,
            bindingExplicit: true,
          },
        ],
      }),
      code: "mixed_evidence",
    },
    {
      name: "reported repair but evaluated pass",
      gateResult: makeGateResult({ stage: "test", verdict: "PASS", reportedVerdict: "REPAIR" }),
      code: "contradictory_evidence",
    },
    {
      name: "reported pass but evaluated repair",
      gateResult: makeGateResult({ stage: "test", verdict: "REPAIR", reportedVerdict: "PASS" }),
      code: "contradictory_evidence",
    },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({
      id: `RUN-${item.code}`,
      stage: "test",
      kind: "test",
      gateResult: item.gateResult,
    });
    const artifact = makeArtifact({
      id: `ART-${item.code}`,
      stage: "test",
      gateResult: item.gateResult,
      focusedTest,
    });
    const task = makeRuntimeTask({ runs: [run], artifacts: [artifact] });
    attachRunArtifact(task, run.id, artifact);
    assert.equal(task.gateFreshness.test.fresh, false, item.name);
    assert.equal(task.gateFreshness.test.reasonCode, item.code, item.name);
    assert.deepEqual(run.gateResult, item.gateResult, `${item.name}: retained for audit`);
  }
});

test("retains decisions while capping aggregate high-volume events during migration", () => {
  const telemetry = Array.from({ length: RUN_ACTIVITY_EVENT_LIMIT }, (_, index) => ({
    id: `telemetry-${index}`,
    category: ["activity", "agent", "tool", "artifact"][index % 4],
  }));
  const task = makeRuntimeTask({
    events: [
      { id: "evicted-telemetry", category: "tool" },
      { id: "decision-before", category: "decision" },
      { id: "other-before", category: "audit" },
      ...telemetry,
      { id: "decision-after", category: "decision" },
    ],
  });
  const state = { schemaVersion: 3, tasks: [task] };

  assert.equal(retainRunActivityEvents(task.events).length, RUN_ACTIVITY_EVENT_LIMIT + 3);
  assert.equal(migrateRunActivityState(state), true);
  const ids = task.events.map((event) => event.id);
  assert.equal(ids.includes("evicted-telemetry"), false);
  assert.equal(ids.includes("decision-before"), true);
  assert.equal(ids.includes("decision-after"), true);
  assert.equal(ids.includes("other-before"), true);
  assert.equal(
    task.events.filter((event) => ["activity", "agent", "tool", "artifact"].includes(event.category)).length,
    RUN_ACTIVITY_EVENT_LIMIT,
  );
  assert.equal(task.events[0].id, "decision-before");
  assert.equal(task.events[1].id, "other-before");
  assert.equal(task.events[2].id, "telemetry-0");
  assert.equal(task.events.at(-1).id, "decision-after");

  const migrated = structuredClone(state);
  assert.equal(migrateRunActivityState(state), false, "retention and migration remain idempotent");
  assert.deepEqual(state, migrated);
});

test("retains missing binding as the exact reason when gate ingestion also changes the verdict", () => {
  const candidate = { id: "C1", revisionNumber: 2 };
  const parsed = parseGateEvidence(
    gateOutput(2, "PASS", [
      {
        severity: "P2",
        title: "Unbound retained finding",
        detail: "The finding omitted its explicit candidate identity.",
      },
    ]),
    candidate,
    "dev-review",
  );
  assert.equal(parsed.reportedVerdict, "PASS");
  assert.equal(parsed.verdict, "REPAIR");
  assert.equal(parsed.findings[0].bindingExplicit, false);

  const run = makeRuntimeRun({ gateResult: parsed });
  const task = makeRuntimeTask({ runs: [run] });
  refreshGateFreshness(task);
  assert.equal(task.gateFreshness["dev-review"].reasonCode, "missing_binding");
  assert.equal(task.gateFreshness["dev-review"].reasonCopy, RUNTIME_FRESHNESS_REASONS.missing_binding);
  assert.deepEqual(run.gateResult, parsed, "the unbound finding remains retained for audit");
});

test("requires persisted Test failedRowIds to match the exact failed-row set", () => {
  const passedSummary = makeFocusedTestSummary();
  const failedRow = makeTestRow({ id: "row-failed", status: "failed" });
  const cases = [
    { name: "missing failedRowIds", summary: { ...passedSummary, failedRowIds: undefined } },
    { name: "non-array failedRowIds", summary: { ...passedSummary, failedRowIds: "row-1" } },
    { name: "unknown failed row", summary: { ...passedSummary, failedRowIds: ["row-missing"] } },
    { name: "passed row reported failed", summary: { ...passedSummary, failedRowIds: ["row-1"] } },
    { name: "failed summary with all passed rows", summary: { ...passedSummary, status: "failed" } },
    {
      name: "failed row omitted",
      summary: makeFocusedTestSummary({ status: "failed", rows: [failedRow], failedRowIds: [] }),
    },
    {
      name: "duplicate failed row id",
      summary: makeFocusedTestSummary({
        status: "failed",
        rows: [failedRow],
        failedRowIds: ["row-failed", "row-failed"],
      }),
    },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({
      id: `RUN-FAILED-ROWS-${item.name}`,
      stage: "test",
      kind: "test",
      gateResult: makeGateResult({ stage: "test" }),
      test: item.summary,
    });
    const task = makeRuntimeTask({ runs: [run] });
    refreshGateFreshness(task);

    assert.equal(task.gateFreshness.test.fresh, false, item.name);
    assert.equal(task.gateFreshness.test.reasonCode, "contradictory_evidence", item.name);
    assert.deepEqual(run.test.failedRowIds, item.summary.failedRowIds, `${item.name}: retained for audit`);
  }

  const validFailedSummary = makeFocusedTestSummary({
    status: "failed",
    rows: [failedRow],
    failedRowIds: ["row-failed"],
  });
  const validFailedRun = makeRuntimeRun({
    id: "RUN-FAILED-ROWS-VALID",
    stage: "test",
    kind: "test",
    gateResult: makeGateResult({
      stage: "test",
      verdict: "REPAIR",
      reportedVerdict: "REPAIR",
      blockingReasons: ["A verification command failed."],
    }),
    test: validFailedSummary,
  });
  const validFailedTask = makeRuntimeTask({ runs: [validFailedRun] });
  refreshGateFreshness(validFailedTask);
  assert.equal(validFailedTask.gateFreshness.test.reasonCode, "repair_required");
  assert.deepEqual(
    validFailedTask.gateFreshness.test.focusedTestRows.map((row) => row.id),
    ["row-failed"],
  );

  const contradictoryFailedRun = makeRuntimeRun({
    id: "RUN-FAILED-ROWS-PASS-GATE",
    stage: "test",
    kind: "test",
    gateResult: makeGateResult({ stage: "test" }),
    test: validFailedSummary,
  });
  const contradictoryFailedTask = makeRuntimeTask({ runs: [contradictoryFailedRun] });
  refreshGateFreshness(contradictoryFailedTask);
  assert.equal(contradictoryFailedTask.gateFreshness.test.reasonCode, "contradictory_evidence");
});

test("rejects malformed persisted focused Test timestamps while retaining them for audit", () => {
  for (const [field, value] of [
    ["startedAt", { timestamp: "2026-08-01T12:00:00.000Z" }],
    ["completedAt", ["2026-08-01T12:01:00.000Z"]],
    ["startedAt", "not-a-timestamp"],
    ["completedAt", ""],
    ["startedAt", "2026-08-01T12:00:00Z"],
    ["completedAt", "2026-08-01T14:01:00.000+02:00"],
  ]) {
    const summary = { ...makeFocusedTestSummary(), [field]: value };
    const run = makeRuntimeRun({
      id: `RUN-MALFORMED-TEST-${field}`,
      stage: "test",
      kind: "test",
      gateResult: makeGateResult({ stage: "test" }),
      test: summary,
    });
    const task = makeRuntimeTask({ runs: [run] });

    refreshGateFreshness(task);

    assert.equal(task.gateFreshness.test.fresh, false, field);
    assert.equal(task.gateFreshness.test.reasonCode, "contradictory_evidence", field);
    assert.deepEqual(
      task.gateFreshness.test.focusedTestRows.map((row) => row.id),
      ["row-1"],
      `${field}: valid exact-candidate rows remain inspectable`,
    );
    assert.equal(
      task.gateFreshness.test.focusedTest[field],
      null,
      `${field}: malformed metadata is sanitized`,
    );
    assert.deepEqual(run.test[field], value, `${field}: malformed evidence remains retained`);
  }
});

test("rejects malformed persisted Test binding markers and preserves explicit false as missing", () => {
  const cases = [
    {
      name: "summary marker is not boolean",
      summary: { ...makeFocusedTestSummary(), bindingExplicit: "true" },
      code: "contradictory_evidence",
    },
    {
      name: "row marker is not boolean",
      summary: makeFocusedTestSummary({
        rows: [{ ...makeTestRow(), bindingExplicit: "not-a-boolean" }],
      }),
      code: "contradictory_evidence",
    },
    {
      name: "summary explicitly lacks a binding",
      summary: { ...makeFocusedTestSummary(), bindingExplicit: false },
      code: "missing_binding",
    },
    {
      name: "row explicitly lacks a binding",
      summary: makeFocusedTestSummary({
        rows: [{ ...makeTestRow(), bindingExplicit: false }],
      }),
      code: "missing_binding",
    },
  ];

  for (const item of cases) {
    const run = makeRuntimeRun({
      id: `RUN-TEST-BINDING-MARKER-${item.name}`,
      stage: "test",
      kind: "test",
      gateResult: makeGateResult({ stage: "test" }),
      test: item.summary,
    });
    const task = makeRuntimeTask({ runs: [run] });
    refreshGateFreshness(task);

    assert.equal(task.gateFreshness.test.fresh, false, item.name);
    assert.equal(task.gateFreshness.test.reasonCode, item.code, item.name);
    assert.deepEqual(run.test, item.summary, `${item.name}: retained for audit`);
  }
});

test("persists malformed attached Test binding markers as contradictory evidence", () => {
  for (const [name, focusedTest] of [
    ["summary marker", { ...makeFocusedTestSummary(), bindingExplicit: "true" }],
    [
      "row marker",
      makeFocusedTestSummary({ rows: [{ ...makeTestRow(), bindingExplicit: "not-a-boolean" }] }),
    ],
  ]) {
    const run = makeRuntimeRun({
      id: `RUN-ATTACHED-TEST-BINDING-${name}`,
      stage: "test",
      kind: "test",
      artifactId: `ART-ATTACHED-TEST-BINDING-${name}`,
      gateResult: null,
      test: null,
    });
    const artifact = makeArtifact({
      id: run.artifactId,
      stage: "test",
      gateResult: makeGateResult({ stage: "test" }),
      focusedTest,
    });
    const task = makeRuntimeTask({ runs: [run], artifacts: [artifact] });

    attachRunArtifact(task, run.id, artifact);

    assert.equal(task.gateFreshness.test.fresh, false, name);
    assert.equal(task.gateFreshness.test.reasonCode, "contradictory_evidence", name);
    assert.deepEqual(
      run.evidenceError,
      {
        code: "contradictory_evidence",
        copy: RUNTIME_FRESHNESS_REASONS.contradictory_evidence,
      },
      `${name}: exact reason is persisted`,
    );
    assert.deepEqual(artifact.focusedTest, focusedTest, `${name}: source evidence is retained for audit`);
  }
});
