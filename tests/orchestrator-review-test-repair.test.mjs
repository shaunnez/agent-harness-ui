import test from "node:test";
import {
  assert,
  attachRunArtifact,
  beginAgentRun,
  buildTestInterpretationRequest,
  evaluationVerdict,
  GRILL_OUTPUT,
  gateOutput,
  harnessEvidence,
  JsonTaskStore,
  makeArtifact,
  makeFocusedTestSummary,
  makeGateResult,
  makePersistedFinding,
  makeRuntimeRun,
  makeRuntimeTask,
  makeTestRow,
  migrateRunActivityState,
  mkdtemp,
  os,
  PLAN_OUTPUT,
  parseFocusedTestEvidence,
  parseGateEvidence,
  passingVerification,
  path,
  RUN_ACTIVITY_EVENT_LIMIT,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  retainRunActivityEvents,
  rm,
  SCOUT_OUTPUT,
  structuredEvidenceError,
  TASK_STORE_SCHEMA_VERSION,
  TaskOrchestrator,
  TEST_OUTPUT,
  tryParseFocusedTestEvidence,
  validateFocusedTestEvidence,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

test("parses focused test evidence with candidate-bound rows", () => {
  const evidence = parseFocusedTestEvidence(TEST_OUTPUT);
  assert.equal(evidence.candidateId, "C1");
  assert.equal(evidence.rows.length, 2);
  assert.equal(evidence.rows[0].status, "passed");
  assert.equal(evidence.rows[1].status, "passed");
  assert.equal(evidence.rows[1].failureDetails, null);
  assert.equal(evidence.rows[1].artifactReferences[0].kind, "junit");
  assert.equal(evidence.rows[0].candidateId, "C1");
  assert.equal(evidence.rows[0].candidateRevision, 2);
  assert.equal(evidence.startedAt, "2026-08-01T12:00:00.000Z");
  assert.equal(evidence.completedAt, "2026-08-01T12:00:01.240Z");
  assert.equal(validateFocusedTestEvidence(evidence, { id: "C1", revisionNumber: 2 }), evidence);
  assert.throws(
    () => validateFocusedTestEvidence(evidence, { id: "C1", revisionNumber: 3 }),
    (error) => error.code === "revision_change",
  );
  assert.throws(
    () =>
      parseFocusedTestEvidence(
        `<focused-test-evidence>{"candidateId":"C1","candidateRevision":2,"command":"npm test","status":"passed","rows":[{"id":"failed","status":"failed"}]}</focused-test-evidence>`,
      ),
    /contradicts its failed rows/i,
  );
  assert.throws(
    () =>
      parseFocusedTestEvidence(
        `<focused-test-evidence>{"candidateId":"C1","candidateRevision":2,"command":"npm test","status":"unknown","rows":[{"id":"row","status":"passed"}]}</focused-test-evidence>`,
      ),
    /status must be passed or failed/i,
  );
});

test("classifies candidate evidence only from typed parser errors", () => {
  for (const message of [
    "missing_binding: must include a candidateId",
    "The candidate binding is malformed.",
    "The evidence belongs to a different candidate.",
    "A test command failed.",
  ]) {
    assert.deepEqual(
      structuredEvidenceError(new Error(message)),
      {
        code: "contradictory_evidence",
        copy: RUNTIME_FRESHNESS_REASONS.contradictory_evidence,
      },
      message,
    );
  }

  let typedError;
  try {
    parseFocusedTestEvidence(
      `<focused-test-evidence>{"candidateId":"C1","candidateRevision":"2"}</focused-test-evidence>`,
    );
  } catch (error) {
    typedError = error;
  }
  assert.ok(typedError);
  typedError.message = "Arbitrary human-readable copy mentioning a failed test.";
  assert.deepEqual(structuredEvidenceError(typedError), {
    code: "malformed_binding",
    copy: RUNTIME_FRESHNESS_REASONS.malformed_binding,
  });
});

test("optional focused Test parsing distinguishes absent from invalid evidence by typed code", () => {
  assert.equal(tryParseFocusedTestEvidence("No focused Test envelope was returned."), null);
  assert.throws(
    () =>
      tryParseFocusedTestEvidence(
        `<focused-test-evidence>{"candidateId":"C1","candidateRevision":"2"}</focused-test-evidence>`,
      ),
    (error) => error.code === "malformed_binding",
  );
  assert.throws(
    () => tryParseFocusedTestEvidence(`<focused-test-evidence>{not-json}</focused-test-evidence>`),
    (error) => error.code === "contradictory_evidence",
  );
});

test("rejects malformed focused Test row fields before normalization", () => {
  const malformedRows = [
    { id: { value: "row-1" } },
    { command: { value: "npm test" } },
    { title: ["test title"] },
    { artifactReferences: [{ name: { value: "report" }, kind: "markdown", path: "report.md" }] },
    { artifactReferences: [{ name: "report", kind: "markdown", path: { value: "report.md" } }] },
    { assertions: [{ label: { value: "result" }, actual: "pass", expected: "pass" }] },
    { assertions: [{ label: "result", actual: { value: "pass" }, expected: "pass" }] },
    { failureDetails: { message: "failed" } },
  ];

  for (const [index, fields] of malformedRows.entries()) {
    const output = `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm test",
      status: "passed",
      rows: [
        {
          id: `row-${index + 1}`,
          candidateId: "C1",
          candidateRevision: 2,
          command: "npm test",
          status: "passed",
          title: "focused test",
          artifactReferences: [],
          assertions: [],
          failureDetails: null,
          ...fields,
        },
      ],
    })}</focused-test-evidence>`;
    assert.throws(
      () => parseFocusedTestEvidence(output),
      (error) => error.code === "contradictory_evidence",
      `malformed row case ${index + 1}`,
    );
  }
});

test("rejects malformed focused Test timestamps before normalization", () => {
  for (const [field, value] of [
    ["startedAt", { timestamp: "2026-08-01T12:00:00.000Z" }],
    ["completedAt", ["2026-08-01T12:01:00.000Z"]],
    ["startedAt", "not-a-timestamp"],
    ["completedAt", ""],
    ["startedAt", "2026-08-01T12:00:00Z"],
    ["completedAt", "2026-08-01T14:01:00.000+02:00"],
  ]) {
    const output = `<focused-test-evidence>${JSON.stringify({
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm test",
      status: "passed",
      [field]: value,
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
    assert.throws(
      () => parseFocusedTestEvidence(output),
      (error) => error.code === "contradictory_evidence" && error.message.includes(field),
      field,
    );
  }
});

test("derives candidate-bound review gates from structured evidence", () => {
  const candidate = { id: "C1", revisionNumber: 2 };
  const pass = parseGateEvidence(gateOutput(2), candidate, "dev-review");
  assert.equal(pass.verdict, "PASS");
  const fencedOutput = gateOutput(2)
    .replace("<gate-evidence>\n", "<gate-evidence>\n```json\n")
    .replace("\n</gate-evidence>", "\n```\n</gate-evidence>");
  const fencedPass = parseGateEvidence(fencedOutput, candidate, "dev-review");
  assert.equal(fencedPass.verdict, "PASS");
  assert.equal(fencedPass.candidateRevision, 2);
  const contradictory = parseGateEvidence(
    gateOutput(2, "PASS", [
      { severity: "P1", title: "Blocking defect", detail: "The candidate can advance incorrectly." },
    ]),
    candidate,
    "dev-review",
  );
  assert.equal(contradictory.reportedVerdict, "PASS");
  assert.equal(contradictory.verdict, "REPAIR");
  assert.match(contradictory.blockingReasons[0], /P1/);
  assert.throws(
    () => parseGateEvidence("PASS", candidate, "dev-review"),
    (error) =>
      error.code === "missing_authoritative_summary" &&
      error.copy === RUNTIME_FRESHNESS_REASONS.missing_authoritative_summary,
  );
  assert.throws(
    () => parseGateEvidence(gateOutput(1), candidate, "dev-review"),
    (error) => error.code === "revision_change",
  );
  assert.throws(
    () =>
      parseGateEvidence(
        gateOutput(2, "REPAIR", [
          {
            severity: "P2",
            title: "Mixed",
            detail: "Wrong candidate",
            candidateId: "C2",
            candidateRevision: 2,
          },
        ]),
        candidate,
        "final-review",
      ),
    (error) => error.code === "mixed_evidence",
  );
});

test("rejects unsupported gate finding field types before normalization", () => {
  const candidate = { id: "C1", revisionNumber: 2 };
  const malformedFindings = [
    { severity: 2, title: "Numeric severity", detail: "Must not be coerced." },
    { severity: "P2", title: 42, detail: "Must not be coerced." },
    { severity: "P2", title: "Object detail", detail: { text: "Must not be coerced." } },
    { severity: "P2", title: "Numeric file", detail: "Must not be coerced.", file: 42 },
    { severity: "P2", title: "String line", detail: "Must not be coerced.", line: "142" },
  ];

  for (const finding of malformedFindings) {
    assert.throws(
      () =>
        parseGateEvidence(
          gateOutput(2, "PASS", [
            {
              ...finding,
              candidateId: "C1",
              candidateRevision: 2,
            },
          ]),
          candidate,
          "dev-review",
        ),
      (error) => error.code === "contradictory_evidence",
    );
  }
});

test("normalizes a gate finding's line range to its start instead of rejecting the evidence", () => {
  // Recorded live behaviour (AH-001 dev-review): the reviewer's finding cited a
  // two-line change as `"line": "38-39"`. That is not the "String line" case above
  // (a lone numeric string like "142", deliberately rejected to avoid coercion) — it
  // is a legitimate range with no single-integer representation, and rejecting the
  // whole PASS verdict over it turned a clean review into a pointless rerun.
  const candidate = { id: "C1", revisionNumber: 2 };
  const parsed = parseGateEvidence(
    gateOutput(2, "PASS", [
      {
        severity: "P3",
        title: "Reporter ordering is load-bearing",
        detail: "Informational only.",
        line: "38-39",
        candidateId: "C1",
        candidateRevision: 2,
      },
    ]),
    candidate,
    "dev-review",
  );
  assert.equal(parsed.verdict, "PASS");
  assert.equal(parsed.findings[0].line, 38);

  // A lone numeric string is still not a range and stays rejected.
  assert.throws(
    () =>
      parseGateEvidence(
        gateOutput(2, "PASS", [
          {
            severity: "P3",
            title: "Lone numeric string",
            detail: "Must not be coerced.",
            line: "38",
            candidateId: "C1",
            candidateRevision: 2,
          },
        ]),
        candidate,
        "dev-review",
      ),
    (error) => error.code === "contradictory_evidence",
  );
});

test("resolves candidate-bound gate failures closed with exact stale reasons", () => {
  const cases = [
    {
      name: "missing authoritative summary",
      run: makeRuntimeRun({ artifactId: null, gateResult: null }),
      artifacts: [],
      code: "missing_authoritative_summary",
    },
    {
      name: "malformed run binding",
      run: makeRuntimeRun({ candidateRevision: "2" }),
      artifacts: [],
      code: "malformed_binding",
    },
    {
      name: "candidate mismatch",
      run: makeRuntimeRun({ candidateId: "C2", gateResult: makeGateResult({ candidateId: "C2" }) }),
      artifacts: [],
      code: "candidate_mismatch",
    },
    {
      name: "stale revision",
      run: makeRuntimeRun({ candidateRevision: 1, gateResult: makeGateResult({ candidateRevision: 1 }) }),
      artifacts: [],
      code: "revision_change",
    },
    {
      name: "failed execution",
      run: makeRuntimeRun({ status: "failed", gateResult: makeGateResult() }),
      artifacts: [],
      code: "failed_execution",
    },
    {
      name: "timed out execution",
      run: makeRuntimeRun({ status: "timed-out", gateResult: makeGateResult() }),
      artifacts: [],
      code: "timeout",
    },
    {
      name: "misleading timeout prose",
      run: makeRuntimeRun({
        status: "failed",
        error: "Codex run exceeded 900 seconds.",
        gateResult: makeGateResult(),
      }),
      artifacts: [],
      code: "failed_execution",
    },
    {
      name: "repair result",
      run: makeRuntimeRun({
        gateResult: makeGateResult({
          verdict: "REPAIR",
          reportedVerdict: "REPAIR",
          blockingReasons: ["P1: defect"],
        }),
      }),
      artifacts: [],
      code: "repair_required",
    },
    {
      name: "contradictory result",
      run: makeRuntimeRun({
        gateResult: makeGateResult({
          verdict: "REPAIR",
          reportedVerdict: "PASS",
          blockingReasons: ["P1: defect"],
        }),
      }),
      artifacts: [],
      code: "contradictory_evidence",
    },
  ];

  for (const item of cases) {
    const task = makeRuntimeTask({ runs: [item.run], artifacts: item.artifacts });
    refreshGateFreshness(task);
    const freshness = task.gateFreshness["dev-review"];
    assert.equal(freshness.fresh, false, item.name);
    assert.equal(freshness.reasonCode, item.code, item.name);
    assert.equal(freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS[item.code], item.name);
    assert.deepEqual(
      freshness.staleReason,
      { code: item.code, copy: RUNTIME_FRESHNESS_REASONS[item.code] },
      item.name,
    );
  }
});

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

test("migration keeps unlinked historical gate outcomes stale when the current gate is fresh", () => {
  const task = makeRuntimeTask({
    runs: [makeRuntimeRun()],
    events: [],
  });
  refreshGateFreshness(task);
  task.events.push({
    id: "EVENT-LEGACY-UNLINKED-PASS",
    at: "2026-08-01T12:02:00.000Z",
    category: "decision",
    tone: "success",
    stage: "dev-review",
    title: "Development review passed",
    detail: "Historical gate outcome.",
    runId: "RUN-WRONG-OR-MISSING",
  });
  const state = { schemaVersion: 3, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.equal(task.gateFreshness["dev-review"].fresh, true, "the current gate remains fresh");
  assert.equal(task.events[0].runId, "RUN-WRONG-OR-MISSING", "the historical audit linkage is not rewritten");
  assert.equal(task.events[0].freshness.sourceRunId, null);
  assert.equal(task.events[0].freshness.fresh, false);
  assert.equal(task.events[0].freshness.reasonCode, "missing_binding");
  assert.equal(task.events[0].freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.missing_binding);
  assert.equal(
    migrateRunActivityState(state),
    false,
    "the fail-closed event repair is idempotent once persisted",
  );
});

test("legacy gate outcomes inherit freshness only through persisted artifact linkage", () => {
  const run = makeRuntimeRun({ artifactId: "ART-REVIEW" });
  const artifact = makeArtifact({ id: "ART-REVIEW" });
  artifact.runId = run.id;
  const event = {
    id: "EVENT-LEGACY-ARTIFACT-PASS",
    at: "2026-08-01T12:02:00.000Z",
    category: "decision",
    tone: "success",
    stage: "dev-review",
    title: "Development review passed",
    detail: "Historical gate outcome with a retained artifact link.",
    artifactId: artifact.id,
  };
  const task = makeRuntimeTask({ runs: [run], artifacts: [artifact], events: [event] });

  refreshGateFreshness(task);

  assert.equal(task.gateFreshness["dev-review"].fresh, true);
  assert.equal(event.runId, undefined, "artifact resolution does not rewrite historical linkage");
  assert.equal(event.freshness.fresh, true);
  assert.equal(event.freshness.sourceRunId, run.id);
  assert.equal(event.freshness.sourceArtifactId, artifact.id);
});

test("builds the focused test prompt from harness observations, not from a request for evidence", () => {
  // Replaced rather than adjusted. This test used to assert the prompt asked a model for a
  // <focused-test-evidence> block and told it how to run npm on Windows PowerShell. Both are
  // gone by design: the harness runs the repository's declared commands itself and builds that
  // block from what it observed (#47), so a prompt asking for it would reintroduce exactly the
  // unverifiable claim the change removes.
  const candidate = {
    id: "C1",
    revisionNumber: 2,
    baseRevision: "a".repeat(40),
    headRevision: "b".repeat(40),
  };
  const request = buildTestInterpretationRequest(
    {
      id: "AH-014",
      title: "Structure focused-test evidence",
      description: "Normalize focused test evidence.",
      decisions: [],
      artifacts: [],
    },
    candidate,
    {
      command: ".agent-harness/verification.json: lint, test",
      status: "failed",
      durationMs: 4200,
      headRevision: "b".repeat(40),
      declaredCommandIds: ["lint", "test", "build"],
      executedCommandIds: ["lint", "test"],
      rows: [
        {
          id: "lint",
          title: "Biome lint",
          command: "npm run lint",
          status: "passed",
          assertions: [{ label: "exit code", actual: "0", expected: "0" }],
        },
        {
          id: "test",
          title: "Node test suite",
          command: "npm test",
          status: "failed",
          failureDetails: "npm test exited 1.",
          assertions: [{ label: "exit code", actual: "1", expected: "0" }],
        },
      ],
    },
  );

  // The observations are stated as facts, with the exact commands and exit codes.
  assert.match(request.prompt, /observed these results directly\. They are facts, not claims/);
  assert.match(request.prompt, /Overall: FAILED in 4200ms/);
  assert.match(request.prompt, /command: npm run lint/);
  assert.match(request.prompt, /exit code: 1 \(expected 0\)/);
  assert.match(request.prompt, /detail: npm test exited 1\./);
  // Bound to the revision verification actually ran against.
  assert.match(request.prompt, new RegExp(`Verification ran against: ${"b".repeat(40)}`));
  // A command that never ran is named as such rather than silently absent.
  assert.match(request.prompt, /Not executed, because an earlier command failed: build\./);
  // Interpretation only, and explicitly not a second execution.
  assert.match(request.prompt, /Do not run these commands again/);
  assert.match(request.prompt, /Work read-only\. Do not modify files\./);

  // The removed contract must not come back through the prompt by another route.
  assert.doesNotMatch(request.prompt, /<focused-test-evidence>/);
  assert.doesNotMatch(request.prompt, /npm\.cmd/);
  assert.equal(request.contextManifest.repositoryAccess, "read-only");
  assert.match(request.contextManifest.policy, /Verification was executed by the harness/);
});

test("persists structured focused test evidence beside the Markdown artifact", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-focused-test-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Focused test evidence",
      description: "Persist structured rows.",
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
          branch: "agent-harness/c1",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_test",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        },
      ];
      draft.artifacts.push({
        id: "artifact-1",
        stage: "test",
        name: "test-c1-r2.md",
        kind: "markdown",
        content: TEST_OUTPUT,
        createdAt: new Date().toISOString(),
        model: "GPT-5.4-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        candidateId: "C1",
        candidateRevision: 2,
        focusedTest: parseFocusedTestEvidence(TEST_OUTPUT),
      });
    });
    const reloaded = new JsonTaskStore(path.join(directory, "tasks.json"));
    await reloaded.init();
    const saved = await reloaded.get(task.id);
    assert.equal(saved.artifacts[0].kind, "markdown");
    assert.equal(saved.artifacts[0].focusedTest.rows.length, 2);
    assert.equal(saved.artifacts[0].focusedTest.rows[1].candidateRevision, 2);
    assert.equal(saved.artifacts[0].focusedTest.rows[0].candidateId, "C1");
    assert.equal(saved.artifacts[0].focusedTest.command, "npm.cmd run test:orchestrator");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("excludes only runtime-scoped context preflight from candidate test telemetry", () => {
  assert.equal(
    evaluationVerdict(
      "test",
      {
        finalText: "PASS\n\n## Verdict\n\nPASS",
        runtimeEvents: [
          { commandFailed: true, runtimeScope: "context-preflight", detail: "rg MEMORY.md" },
          { commandFailed: false, detail: "/bin/zsh -lc 'git rev-parse HEAD'" },
          { commandFailed: false, detail: "/bin/zsh -lc 'npm test'" },
        ],
      },
      { status: "passed" },
    ),
    "PASS",
  );
  assert.equal(
    evaluationVerdict(
      "test",
      {
        finalText: "PASS\n\n## Verdict\n\nPASS",
        runtimeEvents: [
          { commandFailed: true, detail: "/bin/zsh -lc 'npm test'" },
          { commandFailed: false, detail: "/bin/zsh -lc 'git rev-parse HEAD'" },
        ],
      },
      { status: "passed" },
    ),
    "REPAIR",
  );
  assert.equal(
    evaluationVerdict(
      "test",
      {
        finalText: "PASS\n\n## Verdict\n\nPASS",
        runtimeEvents: [{ commandFailed: true, detail: "rg /Users/shaun/.codex/memories/MEMORY.md" }],
      },
      { status: "passed" },
    ),
    "REPAIR",
  );
  assert.equal(
    evaluationVerdict("dev-review", { finalText: "PASS", runtimeEvents: [] }, null, { verdict: "PASS" }),
    "PASS",
  );
  assert.equal(
    evaluationVerdict(
      "dev-review",
      {
        finalText: "PASS",
        runtimeEvents: [{ commandFailed: true, runtimeScope: "candidate", detail: "python -m pytest" }],
      },
      null,
      { verdict: "PASS" },
    ),
    "REPAIR",
  );
  assert.equal(
    evaluationVerdict(
      "final-review",
      {
        finalText: "PASS",
        runtimeEvents: [{ commandFailed: true, runtimeScope: "candidate", detail: "git diff --check" }],
      },
      null,
      { verdict: "PASS" },
    ),
    "REPAIR",
  );
  assert.equal(evaluationVerdict("dev-review", { finalText: "PASS", runtimeEvents: [] }), "REPAIR");
});

test("migration regresses an advanced gate when retained candidate command telemetry failed", () => {
  const run = makeRuntimeRun();
  run.toolCalls = [
    {
      id: "cmd-failed",
      name: "command_execution",
      category: "repository-command",
      phase: "completed",
      result: "Exit code 1",
    },
  ];
  const task = makeRuntimeTask({ runs: [run] });
  task.status = "ready-for-test";
  task.currentStage = "test";
  task.activeRunKind = null;
  task.activeRunReservationId = null;
  task.activeRunIds = [];
  task.candidates[0].status = "ready_for_test";
  const state = { schemaVersion: TASK_STORE_SCHEMA_VERSION, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.equal(task.gateFreshness["dev-review"].reasonCode, "command_failure");
  assert.equal(task.status, "ready-for-review");
  assert.equal(task.currentStage, "dev-review");
  assert.equal(task.candidates[0].status, "ready_for_review");
  assert.equal(task.events.at(-1).title, "Persisted gate evidence invalidated");
  assert.equal(task.runs[0].gateResult.verdict, "PASS", "historical narrative evidence remains retained");
  assert.equal(task.runs[0].toolCalls[0].result, "Exit code 1", "failed telemetry remains retained");
  assert.equal(migrateRunActivityState(state), false, "reconciliation is idempotent once persisted");
});

test("migration recovers a failed Focused Test stranded at ready-for-test", () => {
  const devRun = makeRuntimeRun({
    id: "RUN-DEV-FAILED-TEST-RECOVERY",
    artifactId: "ART-DEV-FAILED-TEST-RECOVERY",
  });
  const devArtifact = makeArtifact({ id: "ART-DEV-FAILED-TEST-RECOVERY", gateResult: devRun.gateResult });
  const failedFocusedTest = makeFocusedTestSummary({
    status: "failed",
    rows: [makeTestRow({ id: "frontend-test", status: "failed" })],
  });
  const testGateResult = makeGateResult({
    stage: "test",
    verdict: "REPAIR",
    reportedVerdict: null,
    blockingReasons: [
      "A candidate-scope command failed.",
      "Structured test evidence contains a failed result.",
    ],
  });
  const testRun = makeRuntimeRun({
    id: "RUN-FAILED-TEST-RECOVERY",
    stage: "test",
    kind: "test",
    artifactId: "ART-FAILED-TEST-RECOVERY",
    gateResult: testGateResult,
    evidenceError: { code: "command_failure", copy: RUNTIME_FRESHNESS_REASONS.command_failure },
  });
  testRun.toolCalls = [
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
  const testArtifact = makeArtifact({
    id: "ART-FAILED-TEST-RECOVERY",
    stage: "test",
    gateResult: testGateResult,
    focusedTest: failedFocusedTest,
  });
  testArtifact.evidenceError = { code: "command_failure", copy: RUNTIME_FRESHNESS_REASONS.command_failure };
  const task = makeRuntimeTask({
    runs: [devRun, testRun],
    artifacts: [devArtifact, testArtifact],
  });
  attachRunArtifact(task, devRun.id, devArtifact);
  attachRunArtifact(task, testRun.id, testArtifact);
  task.status = "ready-for-test";
  task.currentStage = "test";
  task.activeRunKind = null;
  task.activeRunReservationId = null;
  task.activeRunIds = [];
  task.candidates[0].status = "ready_for_test";
  const state = { schemaVersion: TASK_STORE_SCHEMA_VERSION, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.equal(task.gateFreshness["dev-review"].fresh, true);
  assert.equal(task.gateFreshness.test.reasonCode, "repair_required");
  assert.equal(task.gateFreshness.test.focusedTest.status, "failed");
  assert.equal(task.status, "repair-required");
  assert.equal(task.currentStage, "test");
  assert.equal(task.candidates[0].status, "repair_required");
  assert.equal(task.events.at(-1).title, "Persisted gate evidence invalidated");
  assert.equal(migrateRunActivityState(state), false, "recovery is idempotent once repair-required");
});

test("migration recovers a passed Focused Test with failed interpreter diagnostics from the repair path", () => {
  const devRun = makeRuntimeRun({ id: "RUN-DEV-PASSED-TEST-RETRY", artifactId: "ART-DEV-PASSED-TEST-RETRY" });
  const devArtifact = makeArtifact({ id: "ART-DEV-PASSED-TEST-RETRY", gateResult: devRun.gateResult });
  const passedFocusedTest = makeFocusedTestSummary({
    status: "passed",
    rows: [makeTestRow({ id: "frontend-test", status: "passed" })],
  });
  const testGateResult = makeGateResult({
    stage: "test",
    verdict: "REPAIR",
    reportedVerdict: null,
    blockingReasons: [RUNTIME_FRESHNESS_REASONS.review_tooling_failure],
  });
  const evidenceError = {
    code: "review_tooling_failure",
    copy: RUNTIME_FRESHNESS_REASONS.review_tooling_failure,
  };
  const testRun = makeRuntimeRun({
    id: "RUN-PASSED-TEST-RETRY",
    stage: "test",
    kind: "test",
    artifactId: "ART-PASSED-TEST-RETRY",
    gateResult: testGateResult,
    evidenceError,
  });
  testRun.toolCalls = [
    {
      id: "cmd-interpreter-failed-after-pass",
      name: "command_execution",
      category: "repository-command",
      phase: "completed",
      result: "Exit code 2",
      commandFailed: true,
      runtimeScope: "agent-diagnostic",
    },
  ];
  const testArtifact = makeArtifact({
    id: "ART-PASSED-TEST-RETRY",
    stage: "test",
    gateResult: testGateResult,
    focusedTest: passedFocusedTest,
  });
  testArtifact.evidenceError = evidenceError;
  const task = makeRuntimeTask({
    runs: [devRun, testRun],
    artifacts: [devArtifact, testArtifact],
  });
  attachRunArtifact(task, devRun.id, devArtifact);
  attachRunArtifact(task, testRun.id, testArtifact);
  task.status = "repair-required";
  task.currentStage = "test";
  task.activeRunKind = null;
  task.activeRunReservationId = null;
  task.activeRunIds = [];
  task.candidates[0].status = "repair_required";
  const state = { schemaVersion: TASK_STORE_SCHEMA_VERSION, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.equal(task.gateFreshness.test.reasonCode, "review_tooling_failure");
  assert.equal(task.gateFreshness.test.focusedTest.status, "passed");
  assert.equal(task.status, "ready-for-test");
  assert.equal(task.currentStage, "test");
  assert.equal(task.candidates[0].status, "ready_for_test");
  assert.equal(task.events.at(-1).title, "Persisted Test rerun state recovered");
  assert.equal(migrateRunActivityState(state), false, "same-candidate retry state remains stable");
});

test("retains explicit P3 advice without opening a candidate repair", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-noop-repair-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Ship a small change",
      description: "Implement and verify the approved change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    let reviewCount = 0;
    let sawAllowNoChanges = false;
    const worktreeManager = {
      async base() {
        return { repositoryRoot: directory, baseRevision: "a".repeat(40), baseBranch: "main" };
      },
      async prepare(_task, candidateId) {
        return {
          id: candidateId,
          revisionNumber: 1,
          baseRevision: "a".repeat(40),
          baseBranch: "main",
          headRevision: null,
          branch: "agent-harness/test-c1",
          repositoryRoot: directory,
          worktreePath: path.join(directory, candidateId),
          status: "implementing",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        };
      },
      async commit(candidate, _message, options) {
        if (candidate.id !== "C1") {
          // A work-package slice commit: unrelated to this test's scenario.
          return {
            headRevision: "s".repeat(40),
            files: ["src/change.ts"],
            summary: "1 file changed",
            diff: "+change",
            ownSummary: "1 file changed",
            ownDiff: "+change",
          };
        }
        // The repair's own commit call. Mirrors `GitWorktreeManager.commit`'s real
        // `allowNoChanges` contract: only returns the no-op shape when the orchestrator
        // explicitly asked for it, which it must only do after reading the agent's
        // `<no-changes-needed>` marker.
        sawAllowNoChanges = options?.allowNoChanges === true;
        if (!options?.allowNoChanges)
          throw new Error("The implementation agent completed without changing any files.");
        return {
          headRevision: null,
          parentRevision: null,
          files: [],
          summary: "",
          diff: "",
          ownSummary: "",
          ownDiff: "",
          noChangesNeeded: true,
        };
      },
      async assemble() {
        return {
          headRevision: "b".repeat(40),
          files: ["src/change.ts"],
          summary: "1 file changed",
          diff: "+change",
        };
      },
      async verifyCandidate() {
        return true;
      },
      async recoverCandidate() {
        return false;
      },
    };
    const orchestrator = new TaskOrchestrator(store, {
      readVerificationManifest: async () => ({
        source: ".agent-harness/verification.json",
        commands: [
          { id: "test", command: ["npm", "test"] },
          { id: "typecheck", command: ["npm", "run", "typecheck"] },
        ],
      }),
      worktreeManager,
      runCodex: async ({ prompt }) => {
        // Later, more specific stage markers must win over earlier ones a prompt's
        // retained-artifact context can still carry (e.g. the plan prompt embeds the
        // scout report) — matching the independent, overwrite-not-return checks the
        // full end-to-end test above uses for exactly this reason.
        let finalText = "## Outcome\n\nReady";
        if (/<scout-report>/.test(prompt)) finalText = SCOUT_OUTPUT;
        if (/<grill-questions>/.test(prompt)) finalText = GRILL_OUTPUT;
        if (/<work-packages>/.test(prompt)) finalText = PLAN_OUTPUT;
        if (/You are the candidate Repair agent/.test(prompt)) {
          finalText =
            '## Outcome\n\nThe one finding is informational only.\n\n<no-changes-needed>{"reason":"The P3 finding explicitly requires no code change"}</no-changes-needed>';
        } else if (/Development review/.test(prompt)) {
          reviewCount += 1;
          // Both reviews evaluate revision 1: a no-op repair does not bump the
          // candidate's revision, so the second review is of the exact same revision
          // as the first, not a new one.
          finalText =
            reviewCount === 1
              ? gateOutput(1, "PASS", [
                  {
                    severity: "P3",
                    title: "Informational only",
                    detail: "No repair required for this finding on its own.",
                    candidateId: "C1",
                    candidateRevision: 1,
                  },
                ])
              : gateOutput(1);
        }
        return {
          finalText,
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    await orchestrator.start(task.id);
    await waitForStatus(store, task.id, "awaiting-grill");
    await orchestrator.answerGrillQuestion(task.id, {
      questionId: "Q1",
      answer: "Keep it backwards compatible.",
      source: "operator",
    });
    await orchestrator.finishGrill(task.id, { source: "operator" });
    await waitForStatus(store, task.id, "awaiting-spec-approval");
    await orchestrator.approveSpecification(task.id);
    await waitForStatus(store, task.id, "awaiting-plan-approval");
    await orchestrator.approvePlan(task.id);
    await orchestrator.start(task.id, "implementation");
    await waitForStatus(store, task.id, "ready-for-review");
    await orchestrator.start(task.id, "review");

    const passed = await waitForStatus(store, task.id, "ready-for-test");
    assert.equal(passed.candidates[0].revisionNumber, 1);
    assert.equal(passed.candidates[0].status, "ready_for_test");
    assert.equal(
      passed.artifacts.find((artifact) => artifact.stage === "dev-review").gateResult.findings[0].blocking,
      false,
    );
    assert.equal(sawAllowNoChanges, false, "non-blocking advice never starts Repair");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("cleans a failed Test run before allowing its retry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-test-cleanup-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Clean Test retries",
      description: "A failed Test run must not strand the candidate.",
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
          branch: "agent-harness/test-cleanup",
          repositoryRoot: directory,
          worktreePath: directory,
          status: "ready_for_test",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revisions: [],
        },
      ];
    });
    let dirty = false;
    let attempts = 0;
    let recoveries = 0;
    const orchestrator = new TaskOrchestrator(store, {
      // The harness executes verification now; this flow is about candidate lineage and retry
      // accounting, so it supplies the observation through the same seam as runCodex (#47).
      runVerification: passingVerification,
      worktreeManager: {
        async verifyCandidate() {
          if (dirty) throw new Error("candidate is dirty");
          return true;
        },
        async recoverCandidate() {
          recoveries += 1;
          const changed = dirty;
          dirty = false;
          return changed;
        },
      },
      runCodex: async () => {
        attempts += 1;
        if (attempts === 1) {
          dirty = true;
          throw new Error("Focused test runner failed after writing temporary output.");
        }
        return {
          finalText: TEST_OUTPUT,
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        };
      },
    });

    assert.equal(await orchestrator.start(task.id, "test"), true);
    await waitForStatus(store, task.id, "failed");
    assert.equal(dirty, false);
    assert.equal(await orchestrator.start(task.id, "test"), true);
    await waitForStatus(store, task.id, "ready-for-final-review");
    assert.equal(attempts, 2);
    assert.equal(recoveries, 2);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("refuses a review verdict when the reviewer mutated the candidate", async () => {
  for (const stageId of ["dev-review", "final-review"]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), `agent-harness-reviewer-mutation-${stageId}-`));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: `Reject a mutating ${stageId}`,
        description:
          "A reviewer that dirties its worktree produced evidence about files that were never reviewed.",
        repositoryPath: directory,
        workflow: "implement",
        priority: "medium",
      });
      await store.update(task.id, (draft) => {
        draft.status = stageId === "final-review" ? "ready-for-final-review" : "ready-for-review";
        draft.currentStage = stageId;
        draft.completedStages = stageId === "final-review" ? ["dev-review", "test"] : [];
        draft.candidates = [
          {
            id: "C1",
            revisionNumber: 2,
            baseRevision: "a".repeat(40),
            baseBranch: "main",
            headRevision: "b".repeat(40),
            branch: "agent-harness/ah-001-c1",
            repositoryRoot: directory,
            worktreePath: directory,
            status: "under_review",
            createdAt: "2026-08-01T12:00:00.000Z",
            updatedAt: "2026-08-01T12:00:00.000Z",
            revisions: [],
          },
        ];
      });

      // Clean before the agent, dirty after: HEAD never moved, so every exact-SHA
      // check still reports agreement. Only a post-run check catches this.
      let verifyCalls = 0;
      let recoverCalls = 0;
      const orchestrator = new TaskOrchestrator(store, {
        getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
        worktreeManager: {
          verifyCandidate: async () => {
            verifyCalls += 1;
            if (verifyCalls > 1) throw new Error("The candidate worktree has uncommitted changes.");
          },
          recoverCandidate: async () => {
            recoverCalls += 1;
            return true;
          },
        },
        // A verdict the harness must not accept.
        runCodex: async () => ({
          finalText: gateOutput(2, "PASS"),
          usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
        }),
      });

      assert.equal(
        await orchestrator.start(task.id, stageId === "dev-review" ? "review" : "final-review"),
        true,
      );
      const finished = await waitForStatus(
        store,
        task.id,
        stageId === "final-review" ? "ready-for-final-review" : "review-retry-required",
      );
      const run = finished.runs.find((entry) => entry.stage === stageId);

      assert.equal(verifyCalls, 2, `${stageId}: verified before and after the agent`);
      assert.equal(
        recoverCalls,
        0,
        `${stageId}: a reviewer is never recovered, or the evidence of mutation is erased`,
      );
      // Invalid evidence, not a failed review: the gate is not fresh, so it can
      // authorize neither a promotion nor a repair.
      assert.ok(run.evidenceError, `${stageId}: the run carries an evidence error`);
      assert.equal(run.freshness.fresh, false, stageId);
      assert.equal(finished.gateFreshness[stageId].fresh, false, stageId);
      assert.equal(run.gateResult.verdict, "REPAIR", stageId);
      assert.ok(
        run.gateResult.blockingReasons.some((reason) =>
          /mutated the candidate it was reviewing/.test(reason),
        ),
        `${stageId}: the mutation is recorded explicitly, not just as generic bad evidence`,
      );
      assert.ok(
        finished.events.some((event) => event.title === "Reviewer mutated the candidate"),
        stageId,
      );
      assert.equal(
        finished.completedStages.includes(stageId),
        false,
        `${stageId}: never completes on mutated evidence`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }
});
