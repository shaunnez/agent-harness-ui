import test from "node:test";
import {
  assert,
  attachRunArtifact,
  beginAgentRun,
  claudeRunWithoutProvider,
  DEFAULT_EXECUTION_PROVIDER,
  defaultStagePolicies,
  gateOutput,
  JsonTaskStore,
  makeArtifact,
  makeGateResult,
  makeRuntimeRun,
  makeRuntimeTask,
  migrateRunActivityState,
  mkdtemp,
  os,
  ProcessTimeoutError,
  path,
  RUNTIME_FRESHNESS_REASONS,
  refreshGateFreshness,
  rm,
  TASK_STORE_SCHEMA_VERSION,
  TaskOrchestrator,
  waitForStatus,
} from "./orchestrator-test-support.mjs";

test("backfills the default execution provider while migrating through schema 9", () => {
  const run = makeRuntimeRun({ gateResult: makeGateResult() });
  delete run.provider;
  const task = makeRuntimeTask({ runs: [run] });
  task.stageRunReservations = {
    "dev-review": {
      id: "RES-DEV",
      stage: "dev-review",
      kind: "review",
      workflowAttempt: 1,
      candidateId: "C1",
      candidateRevision: 2,
      candidateHeadRevision: "abc123",
      authorizedRunScopes: [],
      reservedAt: "2026-08-01T11:59:00.000Z",
    },
  };
  const state = { schemaVersion: 5, tasks: [task] };

  assert.equal(migrateRunActivityState(state), true);
  assert.equal(state.schemaVersion, TASK_STORE_SCHEMA_VERSION);
  assert.equal(TASK_STORE_SCHEMA_VERSION, 9);
  assert.equal(task.runs[0].provider, DEFAULT_EXECUTION_PROVIDER);
  assert.equal(task.stageRunReservations["dev-review"].provider, DEFAULT_EXECUTION_PROVIDER);
  assert.equal(task.gateFreshness["dev-review"].fresh, true);

  // Idempotent, and a run persisted by an older runtime after migration is repaired.
  assert.equal(migrateRunActivityState(state), false);
  task.runs.push(claudeRunWithoutProvider());
  assert.equal(migrateRunActivityState(state), true);
  assert.equal(task.runs[1].provider, DEFAULT_EXECUTION_PROVIDER);
});

test("stamps the reserving provider onto every run it begins", () => {
  const task = makeRuntimeTask();
  task.stageRunReservations = {};
  const codexRun = beginAgentRun(task, { kind: "review", stage: "dev-review", provider: "codex" });
  const claudeRun = beginAgentRun(task, { kind: "review", stage: "dev-review", provider: "claude" });
  const defaultedRun = beginAgentRun(task, { kind: "review", stage: "dev-review" });
  assert.equal(codexRun.provider, "codex");
  assert.equal(claudeRun.provider, "claude");
  assert.equal(defaultedRun.provider, DEFAULT_EXECUTION_PROVIDER);
});

test("preserves falsey persisted evidence errors through attachment and legacy migration", () => {
  for (const [name, evidenceError] of [
    ["empty string", ""],
    ["zero", 0],
    ["false", false],
  ]) {
    const attachedRun = makeRuntimeRun({ id: `RUN-ATTACH-${name}` });
    const attachedArtifact = { ...makeArtifact({ id: `ART-ATTACH-${name}` }), evidenceError };
    const attachedTask = makeRuntimeTask({ runs: [attachedRun], artifacts: [attachedArtifact] });
    attachRunArtifact(attachedTask, attachedRun.id, attachedArtifact);
    assert.equal(attachedRun.evidenceError, evidenceError, `${name}: attachment retains the original value`);
    assert.equal(
      attachedTask.gateFreshness["dev-review"].reasonCode,
      "malformed_binding",
      `${name}: attachment fails closed`,
    );

    const migratedArtifact = { ...makeArtifact({ id: `ART-MIGRATE-${name}` }), evidenceError };
    const migratedTask = makeRuntimeTask({ artifacts: [migratedArtifact] });
    migrateRunActivityState({ schemaVersion: 1, tasks: [migratedTask] });
    assert.equal(
      migratedTask.runs[0].evidenceError,
      evidenceError,
      `${name}: migration retains the original value`,
    );
    assert.equal(
      migratedTask.gateFreshness["dev-review"].reasonCode,
      "malformed_binding",
      `${name}: migration fails closed`,
    );
  }
});

test("legacy artifact migration is idempotent and assigns a deterministic stale reason", () => {
  const state = {
    schemaVersion: 1,
    tasks: [
      makeRuntimeTask({
        runs: [],
        artifacts: [
          makeArtifact({ id: "LEGACY-ART", candidateId: null, candidateRevision: null, gateResult: null }),
        ],
      }),
    ],
  };
  assert.equal(migrateRunActivityState(state), true);
  const task = state.tasks[0];
  assert.equal(task.runs.length, 1);
  assert.equal(task.runs[0].id, "legacy:LEGACY-ART");
  assert.equal(task.runs[0].freshness.reasonCode, "missing_binding");
  assert.equal(task.runs[0].freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.missing_binding);
  assert.equal(migrateRunActivityState(state), false);
  assert.equal(state.tasks[0].runs.length, 1);
});

test("reserves a run exactly once across concurrent start requests", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-start-race-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Reserve once",
      description: "Concurrent starts must produce one durable run reservation.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
    });
    let release;
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              finalText: "Done",
              usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
            });
        }),
    });

    const results = await Promise.all([orchestrator.start(task.id), orchestrator.start(task.id)]);
    assert.deepEqual(results.sort(), [false, true]);
    const reserved = await store.get(task.id);
    assert.equal(reserved.status, "running");
    assert.equal(reserved.activeRunKind, "investigation");
    assert.equal(reserved.attemptsByStage.triage, 1);
    assert.equal(reserved.stageRunReservations.triage.id, reserved.activeRunReservationId);
    assert.deepEqual(
      {
        stage: reserved.stageRunReservations.triage.stage,
        kind: reserved.stageRunReservations.triage.kind,
        workflowAttempt: reserved.stageRunReservations.triage.workflowAttempt,
        candidateId: reserved.stageRunReservations.triage.candidateId,
        candidateRevision: reserved.stageRunReservations.triage.candidateRevision,
        candidateHeadRevision: reserved.stageRunReservations.triage.candidateHeadRevision,
      },
      {
        stage: "triage",
        kind: "investigation",
        workflowAttempt: 1,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
      },
    );
    for (let attempt = 0; !release && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(typeof release, "function");
    const running = await store.get(task.id);
    assert.equal(running.runs[0].workflowReservationId, reserved.activeRunReservationId);
    assert.equal(running.runs[0].workflowAttempt, 1);
    assert.equal(await orchestrator.cancel(task.id), true);
    release();
    await waitForStatus(store, task.id, "cancelled");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists typed process timeouts as a terminal timed-out run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-typed-timeout-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Persist typed timeout",
      description: "Record a structured terminal outcome when Codex exceeds its deadline.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const orchestrator = new TaskOrchestrator(store, {
      runCodex: async () => {
        throw new ProcessTimeoutError(180_000, "Codex");
      },
    });

    assert.equal(await orchestrator.start(task.id), true);
    const failed = await waitForStatus(store, task.id, "failed");
    assert.equal(failed.runs.length, 1);
    assert.equal(failed.runs[0].status, "timed-out");
    assert.equal(failed.runs[0].error, "Codex run exceeded 180 seconds.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sends byte-identical stage content whichever provider runs it", async () => {
  const prompts = new Map();
  for (const provider of ["codex", "claude"]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), `agent-harness-prompt-parity-${provider}-`));
    try {
      const store = new JsonTaskStore(path.join(directory, "tasks.json"));
      await store.init();
      const task = await store.create({
        title: "Compare stage content across providers",
        description: "The stage prompt must not vary with the runtime that executes it.",
        repositoryPath: directory,
        workflow: "investigate",
        priority: "medium",
        model: provider === "claude" ? "claude-sonnet-5" : "gpt-5.6-luna",
        stagePolicies: defaultStagePolicies(provider),
      });
      const captured = [];
      const orchestrator = new TaskOrchestrator(store, {
        getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
        worktreeManager: { verifyCandidate: async () => {} },
        runCodex: async (options) => {
          captured.push(options.prompt);
          return {
            finalText: /Grill/i.test(options.prompt)
              ? `## Grill\n\nNothing to settle.\n\n<grill-questions>{"questions":[]}</grill-questions>`
              : `## Triage\n\nGrounded.\n\n<scout-dispatch>{"scouts":[],"rationale":"Triage already identifies the complete code path."}</scout-dispatch>`,
            usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
          };
        },
      });
      assert.equal(await orchestrator.start(task.id), true);
      await waitForStatus(store, task.id, "awaiting-spec-approval");
      const stored = await store.get(task.id);
      assert.equal(stored.agentConfig.provider, provider);
      // Every run and reservation is bound to the task's provider.
      for (const run of stored.runs) assert.equal(run.provider, provider);
      for (const reservation of Object.values(stored.stageRunReservations)) {
        assert.equal(reservation.provider, provider);
      }
      prompts.set(provider, captured);
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }

  // Stage instructions live in prompts.mjs alone. Splitting any of it into a
  // provider-specific channel would make the two providers' evidence incomparable.
  assert.ok(prompts.get("codex").length > 0);
  assert.deepEqual(prompts.get("claude"), prompts.get("codex"));
});

test("binds each stage's runs to that stage's own provider across a mixed task", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-mixed-providers-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    // Claude gathering, Codex at the gate — the combination the operator asked for.
    const task = await store.create({
      title: "Mixed provider workflow",
      description: "Each stage reserves and runs on the provider its own model belongs to.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
      stagePolicies: {
        ...defaultStagePolicies("claude"),
        "dev-review": { model: "gpt-5.6-sol", reasoning: "high" },
      },
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

    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: { verifyCandidate: async () => {} },
      runCodex: async () => ({
        finalText: gateOutput(2, "PASS"),
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5, totalTokens: 15 },
      }),
    });

    assert.equal(await orchestrator.start(task.id, "review"), true);
    const finished = await waitForStatus(store, task.id, "ready-for-test");
    const reservation = finished.stageRunReservations["dev-review"];
    const run = finished.runs.find((entry) => entry.stage === "dev-review");

    // The gate reserved and ran on Codex even though the task's other stages are Claude,
    // and the run's provider matches its reservation — a run can never execute on a
    // provider its reservation did not reserve.
    assert.equal(reservation.provider, "codex");
    assert.equal(run.provider, "codex");
    assert.equal(run.model, "gpt-5.6-sol");
    assert.equal(finished.agentConfig.stagePolicies.triage.model, "claude-sonnet-5");

    // Provider identity binds like candidate identity, so the gate is fresh only while
    // the run and its reservation agree.
    assert.equal(finished.gateFreshness["dev-review"].fresh, true);
    const tampered = await store.get(task.id);
    tampered.runs.find((entry) => entry.stage === "dev-review").provider = "claude";
    const recomputed = refreshGateFreshness(tampered);
    assert.equal(recomputed["dev-review"].fresh, false);
    assert.equal(recomputed["dev-review"].reasonCode, "provider_mismatch");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
