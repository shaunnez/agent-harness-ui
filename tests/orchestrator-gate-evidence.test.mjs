import test from "node:test";
import {
  assert,
  gateOutput,
  makeGateResult,
  makeRuntimeRun,
  makeRuntimeTask,
  parseFocusedTestEvidence,
  parseGateEvidence,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  structuredEvidenceError,
  TEST_OUTPUT,
  tryParseFocusedTestEvidence,
  validateFocusedTestEvidence,
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
