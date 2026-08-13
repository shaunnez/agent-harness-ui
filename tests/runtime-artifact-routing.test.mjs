import test from "node:test";
import {
  assert,
  attachRepairAuthorizerFixture,
  buildStageRequest,
  createTask,
  JsonTaskStore,
  mkdtemp,
  os,
  path,
  React,
  renderToStaticMarkup,
  rm,
  TaskOrchestrator,
  waitUntil,
  withWorkspace,
} from "./runtime-test-support.mjs";

test("records the exact prior artifacts and repository permission supplied to an agent", () => {
  const task = createTask({
    artifacts: [
      {
        id: "artifact-triage",
        stage: "triage",
        name: "triage.md",
        content: "Grounded triage evidence.",
        createdAt: "2026-08-02T00:00:00.000Z",
        model: "gpt-5.6-luna",
        usage: { inputTokens: 10, cachedInputTokens: 8, outputTokens: 2, totalTokens: 12 },
      },
    ],
  });
  const request = buildStageRequest(task, "scouts");
  assert.match(request.prompt, /Grounded triage evidence/);
  assert.equal(request.contextManifest.repositoryAccess, "read-only");
  assert.equal(
    request.contextManifest.sources.some((source) => source.id === "artifact-triage"),
    true,
  );
  const artifactSource = request.contextManifest.sources.find((source) => source.id === "artifact-triage");
  assert.equal(artifactSource.includedCharacters, "## triage: triage.md\n".length + 25);
  assert.equal(artifactSource.originalCharacters, 25);
  assert.equal(artifactSource.truncated, false);
});

test("uses per-stage limits for admission and failure blocking while sharing repair with implement", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-stage-budgets-"));
  try {
    const store = new JsonTaskStore(path.join(directory, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Stage budget enforcement",
      description: "Use the canonical stage limit for each run kind.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "medium",
    });
    const candidate = {
      id: "C1",
      revisionNumber: 1,
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/budget-c1",
      repositoryRoot: directory,
      worktreePath: directory,
      status: "ready_for_test",
      revisions: [],
    };
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "dev-review";
      draft.candidates = [candidate];
      draft.stageRunLimits = { implement: 1, "dev-review": 3, test: 1, "final-review": 3 };
      draft.attemptsByStage = { implement: 1, "dev-review": 0, test: 0 };
    });
    const orchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      runCodex: async () => ({
        finalText: "No structured evidence.",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
      worktreeManager: { verifyCandidate: async () => {} },
    });

    assert.equal(
      await orchestrator.start(task.id, "implementation"),
      false,
      "an exhausted implement budget blocks implementation",
    );
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.candidates[0].status = "repair_required";
    });
    assert.equal(
      await orchestrator.start(task.id, "repair"),
      false,
      "repair consumes the exhausted implement budget",
    );

    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.candidates[0].status = "repair_required";
      draft.stageRunLimits.implement = 1;
      draft.attemptsByStage.implement = 0;
      attachRepairAuthorizerFixture(draft, draft.candidates[0]);
    });
    const failingRepairOrchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: {
        verifyCandidate: async () => {
          throw new Error("repair candidate verification failed");
        },
      },
    });
    assert.equal(await failingRepairOrchestrator.start(task.id, "repair"), true);
    await waitUntil(async () => (await store.get(task.id)).status === "blocked");
    const blockedRepair = await store.get(task.id);
    assert.equal(
      blockedRepair.currentStage,
      "implement",
      "repair preflight failures retain their canonical budget stage",
    );
    assert.equal(blockedRepair.attemptsByStage.implement, 1);
    assert.equal(blockedRepair.stageRunLimits["dev-review"], 3);

    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "test";
      draft.candidates[0].status = "ready_for_test";
      draft.attemptsByStage = { implement: 1, "dev-review": 0, test: 0 };
    });
    assert.equal(
      await orchestrator.start(task.id, "test"),
      true,
      "test uses its own allowance despite implement being exhausted",
    );
    await waitUntil(() => !orchestrator.isRunning(task.id));
    assert.equal((await store.get(task.id)).attemptsByStage.test, 1);

    await store.update(task.id, (draft) => {
      draft.status = "ready-for-test";
      draft.currentStage = "dev-review";
      draft.candidates[0].status = "ready_for_test";
      draft.attemptsByStage = { implement: 1, "dev-review": 0, test: 0 };
    });
    const failingOrchestrator = new TaskOrchestrator(store, {
      getStatus: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
      worktreeManager: {
        verifyCandidate: async () => {
          throw new Error("candidate verification failed");
        },
      },
    });
    assert.equal(await failingOrchestrator.start(task.id, "test"), true);
    await waitUntil(async () => (await store.get(task.id)).status === "blocked");
    assert.equal(
      (await store.get(task.id)).attemptsByStage.test,
      1,
      "failure blocking uses the test stage, not currentStage",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("renders approvals history in the runtime task inspector", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const taskWithApprovals = createTask({
      approvals: [
        {
          id: "A1",
          stage: "specification",
          note: "Specification approved.",
          createdAt: "2026-08-01T10:15:00.000Z",
        },
        { id: "A2", stage: "plan", note: "", createdAt: "2026-08-01T10:20:00.000Z" },
      ],
    });
    const populatedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: taskWithApprovals,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(populatedMarkup, /<strong>Approvals<\/strong>/);
    assert.match(populatedMarkup, /Task specification/);
    assert.match(populatedMarkup, /Specification approved\./);
    assert.match(populatedMarkup, /Approved without a note\./);
    assert.doesNotMatch(populatedMarkup, /No approvals recorded yet\./);

    const emptyMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({ approvals: [] }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(emptyMarkup, /<strong>Approvals<\/strong>/);
    assert.match(emptyMarkup, /No approvals recorded yet\./);
  });
});

test("command centre reports persisted run totals rather than artifact totals", () => {
  return withWorkspace(async ({ CommandCentre }) => {
    const task = createTask({
      artifacts: [
        { id: "A1", stage: "triage", name: "triage.md", createdAt: "2026-08-01T00:00:00.000Z" },
        { id: "A2", stage: "plan", name: "plan.md", createdAt: "2026-08-01T00:01:00.000Z" },
      ],
      runCount: 7,
    });
    const markup = renderToStaticMarkup(
      React.createElement(CommandCentre, {
        runtimeTasks: [task],
        runtimeStatus: null,
        runtimeLoading: false,
        runtimeError: null,
        onOpenTask: () => {},
        onNewTask: () => {},
        onSeeAllTasks: () => {},
      }),
    );
    assert.match(markup, /Agent runs<\/span><strong>7<\/strong>/);
  });
});

test("living artifacts exposes retained totals and a bounded way to load older pages", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      artifacts: Array.from({ length: 60 }, (_, index) => ({
        id: `A${index}`,
        stage: "triage",
        name: `artifact-${index}.md`,
        kind: "markdown",
        content: "retained",
        createdAt: new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString(),
      })),
      artifactCount: 75,
      artifactNextCursor: "older-page",
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onLoadMoreArtifacts: async () => {},
      }),
    );
    assert.match(markup, /60 of 75 retained/);
    assert.match(markup, /Load 15 older artifacts/);
  });
});

test("renders the retained worktree inventory with drill-in detail and a return path", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      worktreeInventory: [
        {
          id: "slice-S1",
          kind: "slice",
          label: "S1 slice worktree",
          worktreePath: "C:/worktrees/AH-015-S2-A1-S1",
          branch: "agent-harness/AH-015-S2-A1-S1",
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          taskId: "AH-015",
          workPackageId: "S1",
          lifecycleState: "retained",
          gitExists: true,
          gitHeadRevision: "b".repeat(40),
          gitClean: true,
          cleanupReady: true,
        },
        {
          id: "candidate-C1",
          kind: "candidate",
          label: "Candidate C1 worktree",
          worktreePath: "C:/worktrees/AH-015-C1",
          branch: "agent-harness/AH-015-C1",
          baseRevision: "c".repeat(40),
          headRevision: null,
          taskId: "AH-015",
          workPackageId: null,
          lifecycleState: "active",
          gitExists: true,
          gitHeadRevision: "d".repeat(40),
          gitClean: false,
          cleanupReady: false,
        },
      ],
    });

    const listMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        initialSelectedWorktreeId: null,
      }),
    );

    assert.match(listMarkup, /Isolated worktrees/);
    assert.match(listMarkup, /slice \u00b7 retained/i);
    assert.match(listMarkup, /candidate \u00b7 active/i);
    assert.match(listMarkup, /S1 slice worktree/);
    assert.match(listMarkup, /Candidate C1 worktree/);
    assert.match(listMarkup, /cleanup ready/);
    assert.match(listMarkup, /keep retained/);

    const detailMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        initialSelectedWorktreeId: "candidate-C1",
      }),
    );

    assert.match(detailMarkup, /Return to inventory list/);
    assert.match(detailMarkup, /candidate \u00b7 active/i);
    assert.match(detailMarkup, /Kind/);
    assert.match(detailMarkup, /Cleanup/);
    assert.match(detailMarkup, /Return to the inventory list/);
  });
});

test("fetches candidate diffs by active candidate identity and surfaces stale failures", async () => {
  return withWorkspace(async ({ loadApiModule }) => {
    const { getCandidateDiff } = await loadApiModule();
    const requests = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(
          JSON.stringify({
            candidateId: "C1",
            revisionNumber: 2,
            headRevision: "c".repeat(40),
            worktreePath: "C:/worktrees/C1",
            diff: "diff --git a/file.txt b/file.txt\n+change",
            truncated: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const diff = await getCandidateDiff("TASK-1", "C1", "c".repeat(40));
      assert.equal(diff.candidateId, "C1");
      assert.equal(diff.headRevision, "c".repeat(40));
      assert.match(requests[0].input, /\/api\/tasks\/TASK-1\/candidates\/C1\/diff\?headRevision=/);
      assert.match(requests[0].input, /headRevision=c{40}/);

      globalThis.fetch = async () => new Response(JSON.stringify({ error: "stale" }), { status: 409 });
      await assert.rejects(() => getCandidateDiff("TASK-1", "C1", "d".repeat(40)), /stale/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("fetches the live inventory endpoint and renders the returned rows in the runtime workspace", async () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, loadApiModule }) => {
    const { getRuntimeWorktreeInventory } = await loadApiModule();
    const requests = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) => {
        requests.push({ input: String(input), init });
        return new Response(
          JSON.stringify({
            rows: [
              {
                id: "slice-S1",
                kind: "slice",
                label: "S1 slice worktree",
                worktreePath: "C:/worktrees/AH-015-S2-A1-S1",
                branch: "agent-harness/AH-015-S2-A1-S1",
                baseRevision: "a".repeat(40),
                headRevision: "b".repeat(40),
                taskId: "AH-015",
                workPackageId: "S1",
                lifecycleState: "retained",
                gitExists: true,
                gitHeadRevision: "b".repeat(40),
                gitClean: true,
                cleanupReady: true,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const inventory = await getRuntimeWorktreeInventory();
      assert.equal(inventory.rows.length, 1);
      assert.equal(requests[0].input, "/api/runtime/worktrees");
      assert.deepEqual(
        (({ gitExists, gitHeadRevision, gitClean, cleanupReady }) => ({
          gitExists,
          gitHeadRevision,
          gitClean,
          cleanupReady,
        }))(inventory.rows[0]),
        {
          gitExists: true,
          gitHeadRevision: "b".repeat(40),
          gitClean: true,
          cleanupReady: true,
        },
      );

      const markup = renderToStaticMarkup(
        React.createElement(RuntimeTaskWorkspace, {
          task: createTask({ worktreeInventory: inventory.rows }),
          onBack: async () => {},
          onRun: async () => {},
          onCancel: async () => {},
          onAction: async () => {},
          onDecision: async () => {},
        }),
      );

      assert.match(markup, /Isolated worktrees/);
      assert.match(markup, /slice/);
      assert.match(markup, /retained/);
      assert.match(markup, /S1 slice worktree/);
      assert.match(markup, /cleanup ready/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("renders the candidate diff overlay with the current identity and return control", () => {
  return withWorkspace(async ({ CandidateDiffViewer }) => {
    let closed = 0;
    const markup = renderToStaticMarkup(
      React.createElement(CandidateDiffViewer, {
        candidateIdentity: "C1 \u00b7 deadbeef",
        taskId: "TASK-1",
        diff: {
          candidateId: "C1",
          revisionNumber: 2,
          headRevision: "c".repeat(40),
          worktreePath: "C:/worktrees/C1",
          diff: "diff --git a/file.txt b/file.txt\n+change",
          truncated: false,
        },
        onClose: () => {
          closed += 1;
        },
      }),
    );

    assert.match(markup, /Candidate diff/);
    assert.match(markup, /C1 \u00b7 deadbeef/);
    assert.match(markup, /Task TASK-1/);
    assert.match(markup, /Return to inspector/);
    assert.match(markup, /Close candidate diff/);
    assert.equal(closed, 0);
  });
});

test("rejects late task and candidate-diff responses after identity changes", () => {
  return withWorkspace(async ({ isCurrentRequest, matchesCandidateDiffResponse }) => {
    const requestA = { identity: "AH-A", generation: 1 };
    const requestB = { identity: "AH-B", generation: 2 };
    assert.equal(isCurrentRequest(requestA, requestB), false);
    assert.equal(isCurrentRequest(requestB, requestB), true);
    const requested = { id: "C2", revisionNumber: 3, headRevision: "b".repeat(40) };
    assert.equal(
      matchesCandidateDiffResponse(requested, {
        candidateId: "C2",
        revisionNumber: 2,
        headRevision: "a".repeat(40),
      }),
      false,
    );
    assert.equal(
      matchesCandidateDiffResponse(requested, {
        candidateId: "C2",
        revisionNumber: 3,
        headRevision: "b".repeat(40),
      }),
      true,
    );
  });
});
