import test from "node:test";
import {
  assert,
  attachRunArtifact,
  buildTestInterpretationRequest,
  evaluationVerdict,
  GRILL_OUTPUT,
  gateOutput,
  JsonTaskStore,
  makeArtifact,
  makeFocusedTestSummary,
  makeGateResult,
  makeRuntimeRun,
  makeRuntimeTask,
  makeTestRow,
  migrateRunActivityState,
  mkdtemp,
  os,
  PLAN_CRITIQUE_OUTPUT,
  PLAN_OUTPUT,
  parseFocusedTestEvidence,
  passingVerification,
  path,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  rm,
  SCOUT_OUTPUT,
  SYNTHESIS_OUTPUT,
  TASK_STORE_SCHEMA_VERSION,
  TaskOrchestrator,
  TEST_OUTPUT,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

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
        if (/<investigation-result>/.test(prompt)) finalText = SYNTHESIS_OUTPUT;
        if (/<grill-questions>/.test(prompt)) finalText = GRILL_OUTPUT;
        if (/<work-packages>/.test(prompt)) finalText = PLAN_OUTPUT;
        if (/<plan-critique>/.test(prompt)) finalText = PLAN_CRITIQUE_OUTPUT;
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
