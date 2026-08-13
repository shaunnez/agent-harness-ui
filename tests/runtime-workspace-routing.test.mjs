import test from "node:test";
import {
  assert,
  attachRepairAuthorizerFixture,
  buildStageRequest,
  createTask,
  JsonTaskStore,
  makeGateFreshness,
  mkdtemp,
  os,
  path,
  React,
  renderToStaticMarkup,
  rm,
  runtimeTaskToRecentTask,
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

test("renders truthful active-stage access boundaries", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, getAccessBoundaryCopy }) => {
    const renderWorkspace = (task) =>
      renderToStaticMarkup(
        React.createElement(RuntimeTaskWorkspace, {
          task,
          onBack: async () => {},
          onRun: async () => {},
          onCancel: async () => {},
          onAction: async () => {},
          onDecision: async () => {},
        }),
      );

    const readOnlyMarkup = renderWorkspace(createTask({ currentStage: "plan", status: "running" }));
    assert.match(readOnlyMarkup, /Read-only boundary/);
    assert.match(readOnlyMarkup, /plan is read-only/i);
    assert.match(readOnlyMarkup, /Read-only/);
    assert.deepEqual(
      (({ kicker, detail, sandbox }) => ({ kicker, detail, sandbox }))(
        getAccessBoundaryCopy(createTask({ currentStage: "plan" })),
      ),
      (({ kicker, detail, sandbox }) => ({ kicker, detail, sandbox }))(
        getAccessBoundaryCopy(createTask({ currentStage: "specification" })),
      ),
    );

    const implementMarkup = renderWorkspace(createTask({ currentStage: "implement", status: "running" }));
    assert.match(implementMarkup, /Worktree write scope/);
    assert.match(implementMarkup, /isolated candidate worktree/i);
    assert.match(implementMarkup, /Isolated candidate worktree/);

    const testMarkup = renderWorkspace(createTask({ currentStage: "test", status: "running" }));
    assert.match(testMarkup, /Candidate cleanliness boundary/);
    assert.match(testMarkup, /temporary files/i);
    assert.match(testMarkup, /must be left clean/i);

    const repairRequiredMarkup = renderWorkspace(
      createTask({
        currentStage: "test",
        status: "repair-required",
        error: "The test gate failed.",
      }),
    );
    assert.match(repairRequiredMarkup, /Worktree write scope/);
    assert.match(repairRequiredMarkup, /isolated candidate worktree/i);
    assert.match(repairRequiredMarkup, /repair the retained candidate/i);

    const activeTask = createTask({
      currentStage: "implement",
      status: "running",
      artifacts: [
        {
          id: "artifact-1",
          stage: "specification",
          kind: "markdown",
          name: "Specification",
          content: "# Spec",
          createdAt: "2026-08-01T11:00:00.000Z",
          model: "GPT-5.4-mini",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        },
      ],
    });
    const viewedStageMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: activeTask,
        initialViewedStageId: "specification",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    const sameActiveDifferentViewedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: activeTask,
        initialViewedStageId: "plan",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(viewedStageMarkup, /Viewing/);
    assert.match(viewedStageMarkup, /Active/);
    assert.match(viewedStageMarkup, /<small>Agent<\/small><strong class="">Implement agent<\/strong>/);
    assert.doesNotMatch(
      viewedStageMarkup,
      /<small>Agent<\/small><strong class="">Task specification agent<\/strong>/,
    );
    assert.match(viewedStageMarkup, /Worktree write scope/);
    assert.match(viewedStageMarkup, /isolated candidate worktree/i);
    assert.match(sameActiveDifferentViewedMarkup, /Worktree write scope/);
    assert.match(sameActiveDifferentViewedMarkup, /isolated candidate worktree/i);
    assert.equal(
      viewedStageMarkup.match(/<small>Sandbox<\/small><strong class="">([^<]+)<\/strong>/)?.[1],
      sameActiveDifferentViewedMarkup.match(/<small>Sandbox<\/small><strong class="">([^<]+)<\/strong>/)?.[1],
    );
  });
});

test("renders an open Grill session as active decisions and completed Grill as history", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const question = {
      id: "Q1",
      question: "Preserve the existing API contract?",
      whyItMatters: "The answer changes compatibility behavior.",
      options: [
        { id: "Q1-O1", label: "Preserve it", description: "Keep clients working.", recommended: true },
        { id: "Q1-O2", label: "Break it", description: "Adopt the new shape.", recommended: false },
      ],
      allowCustom: true,
      answer: null,
      answerSource: null,
      resolvedAt: null,
    };
    const sharedProps = {
      onBack: async () => {},
      onRun: async () => {},
      onCancel: async () => {},
      onAction: async () => {},
      onDecision: async () => {},
      onGrillAnswer: async () => {},
      onFinishGrill: async () => {},
    };
    const openMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        ...sharedProps,
        task: createTask({
          status: "awaiting-grill",
          currentStage: "grill",
          completedStages: ["triage", "scouts"],
          grillSession: {
            status: "open",
            questions: [question],
            createdAt: "2026-08-01T12:00:00.000Z",
            completedAt: null,
            completionReason: null,
          },
        }),
      }),
    );
    assert.match(openMarkup, /Preserve the existing API contract/);
    assert.match(openMarkup, /Custom answer/);
    assert.match(openMarkup, /Finish with 1 recommendation/);

    const completedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        ...sharedProps,
        initialViewedStageId: "grill",
        task: createTask({
          grillPolicy: "manual",
          status: "awaiting-spec-approval",
          currentStage: "specification",
          completedStages: ["triage", "scouts", "grill", "specification"],
          grillSession: {
            status: "completed",
            questions: [
              {
                ...question,
                answer: "Preserve it",
                answerSource: "operator-answer",
                resolvedAt: "2026-08-01T12:05:00.000Z",
              },
            ],
            createdAt: "2026-08-01T12:00:00.000Z",
            completedAt: "2026-08-01T12:05:00.000Z",
            completionReason: "All material questions were answered by the operator.",
            completionSource: "operator",
            policySnapshot: "manual",
            acceptedRecommendationCount: 0,
          },
        }),
      }),
    );
    assert.match(completedMarkup, /All material questions were answered by the operator/);
    assert.match(completedMarkup, /Operator answer/);
    assert.match(completedMarkup, /Manual policy/);
    assert.doesNotMatch(completedMarkup, /Confirm answer/);
    assert.doesNotMatch(completedMarkup, /Finish with 1 recommendation/);

    const automaticMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        ...sharedProps,
        initialViewedStageId: "grill",
        task: createTask({
          grillPolicy: "auto-accept-recommendations",
          status: "awaiting-spec-approval",
          currentStage: "specification",
          completedStages: ["triage", "scouts", "grill", "specification"],
          grillSession: {
            status: "completed",
            questions: [
              {
                ...question,
                answer: "Preserve it",
                answerSource: "automation-policy",
                resolvedAt: "2026-08-01T12:05:00.000Z",
              },
            ],
            createdAt: "2026-08-01T12:00:00.000Z",
            completedAt: "2026-08-01T12:05:00.000Z",
            completionReason:
              "Automatically accepted 1 recommended assumption under the task's Grill policy.",
            completionSource: "automation-policy",
            policySnapshot: "auto-accept-recommendations",
            acceptedRecommendationCount: 1,
          },
        }),
      }),
    );
    assert.match(automaticMarkup, /Automatic policy/);
    assert.match(automaticMarkup, /Recommendation accepted automatically/);
  });
});

test("renders a compact completed Grill state when investigation leaves no material questions", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "awaiting-spec-approval",
          currentStage: "specification",
          completedStages: ["triage", "scouts", "grill", "specification"],
          grillSession: {
            status: "completed",
            questions: [],
            createdAt: "2026-08-01T12:00:00.000Z",
            completedAt: "2026-08-01T12:00:01.000Z",
            completionReason: "No material product decisions remained after repository investigation.",
          },
        }),
        initialViewedStageId: "grill",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(markup, /runtime-grill-empty/);
    assert.match(markup, /No material questions remained/);
    assert.doesNotMatch(markup, /runtime-grill__reason/);
    assert.doesNotMatch(markup, /runtime-stage-empty/);
  });
});

test("renders prior stage attempts and strips machine payloads from visible Markdown", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, stripStructuredArtifactPayloads }) => {
    const first = {
      id: "plan-1",
      runId: "run-1",
      stage: "plan",
      kind: "markdown",
      name: "implementation-plan.md",
      content: '# Recommended route\n\nReadable route.\n\n<scout-dispatch>{"scouts":[]}</scout-dispatch>',
      createdAt: "2026-08-01T12:00:00.000Z",
      model: "gpt-5.6-sol",
      reasoning: "high",
      usage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
        totalTokens: 120,
        cost: 0.1,
        credits: 0.2,
      },
    };
    const second = {
      ...first,
      id: "plan-2",
      runId: "run-2",
      name: "implementation-plan-r2.md",
      createdAt: "2026-08-01T12:05:00.000Z",
    };
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "ready-to-implement",
          currentStage: "plan",
          completedStages: ["triage", "scouts", "grill", "specification", "plan"],
          artifacts: [first, second],
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(markup, /Stage history/);
    assert.match(markup, /Attempt 1/);
    assert.match(markup, /implementation-plan-r2\.md/);
    assert.match(markup, /Latest shown/);
    assert.equal(stripStructuredArtifactPayloads(first.content), "# Recommended route\n\nReadable route.");
  });
});

test("renders zero-dispatch scouts as a retained rationale and deterministic handoff", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, resolveScoutUsage, stageUsage }) => {
    const handoff = {
      id: "zero-dispatch-handoff",
      runId: "RUN-ZERO-HANDOFF-LIKE",
      stage: "scouts",
      kind: "markdown",
      name: "repository-scout.md",
      content: "# Repository evidence\n\nNo child reports were required.",
      createdAt: "2026-08-01T12:01:00.000Z",
      model: "gpt-5.6-luna",
      reasoning: "xhigh",
      agentRole: "scouts",
      usage: {
        inputTokens: 8_000,
        cachedInputTokens: 7_000,
        outputTokens: 6_000,
        totalTokens: 14_000,
        cost: 80,
        credits: 40,
      },
    };
    const task = createTask({
      currentStage: "scouts",
      status: "awaiting-grill",
      completedStages: ["triage", "scouts"],
      scoutDispatch: {
        selected: [],
        skipped: ["scout-code-path", "scout-pattern"],
        rationale: "Triage found enough repository evidence and explicitly requested no scouts.",
        createdAt: "2026-08-01T11:59:00.000Z",
        completedAt: "2026-08-01T12:01:00.000Z",
      },
      artifacts: [handoff],
    });

    const resolved = resolveScoutUsage(task);
    assert.deepEqual(resolved.perScout, []);
    assert.deepEqual(resolved.unmatched, []);
    assert.deepEqual(resolved.matchedArtifacts, []);
    assert.equal(resolved.aggregate.runs, 0);
    assert.equal(resolved.aggregate.totalTokens, 0);
    assert.equal(stageUsage([task], "scouts").runs, 0);
    assert.equal(stageUsage([task], "scouts").artifacts.includes(handoff), false);

    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewedStageId: "scouts",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(markup, /No scouts dispatched/);
    assert.match(markup, /Triage found enough repository evidence and explicitly requested no scouts\./);
    assert.match(markup, /Downstream handoff · deterministic aggregation/);
    assert.match(markup, /Inputs: none dispatched; no additional model call/);
    assert.match(markup, /Viewed downstream handoff/);
    assert.match(markup, /Child scout runs/);
    assert.match(markup, /0 recorded/);
    assert.match(markup, /0 input · 0 cached · 0 output/);
    assert.doesNotMatch(markup, /Viewed agent run/);
    assert.doesNotMatch(markup, /No recorded child scout run/);
    assert.doesNotMatch(markup, /zero-token|token usage failure|model run failed/i);
  });
});

test("renders artifact copy affordance and normalizes clipboard outcomes", () => {
  return withWorkspace(
    async ({ RuntimeArtifactViewer, copyArtifactContent, shouldApplyArtifactCopyFeedback }) => {
      const artifact = {
        id: "artifact-1",
        stage: "specification",
        kind: "markdown",
        name: "Specification",
        content: "# Spec\n\nRetained text.",
        createdAt: "2026-08-01T11:00:00.000Z",
        model: "GPT-5.4-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      };
      const markup = renderToStaticMarkup(
        React.createElement(RuntimeArtifactViewer, { artifact, onClose: async () => {} }),
      );
      assert.match(markup, /Copy artifact/);
      assert.match(markup, /Real agent output \u00b7 read-only/);

      const writes = [];
      await assert.doesNotReject(
        copyArtifactContent(artifact.content, {
          writeText: async (text) => {
            writes.push(text);
          },
        }),
      );
      assert.deepEqual(writes, [artifact.content]);

      assert.deepEqual(
        await copyArtifactContent(artifact.content, {
          writeText: async () => {
            throw new Error("blocked");
          },
        }),
        { ok: false, message: "Clipboard access failed. The browser blocked copying this artifact." },
      );
      assert.deepEqual(await copyArtifactContent(artifact.content, null), {
        ok: false,
        message: "Clipboard access failed. Your browser did not expose clipboard write support.",
      });
      assert.equal(shouldApplyArtifactCopyFeedback("artifact-1", "artifact-1"), true);
      assert.equal(shouldApplyArtifactCopyFeedback("artifact-1", "artifact-2"), false);
    },
  );
});

test("keeps focused test evidence attached to the persisted Markdown artifact in the runtime workspace", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const focusedTest = {
      candidateId: "C1",
      candidateRevision: 2,
      command: "npm.cmd run test:runtime",
      status: "passed",
      startedAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:00:00.900Z",
      durationMs: 900,
      rows: [
        {
          id: "row-1",
          candidateId: "C1",
          candidateRevision: 2,
          command: "npm.cmd run test:runtime",
          status: "passed",
          durationMs: 900,
          title: "runtime.test.mjs",
          artifactReferences: [
            { name: "Markdown test artifact", kind: "markdown", path: "artifacts/test.md" },
          ],
          assertions: [
            { label: "workspace renders the test artifact", actual: "present", expected: "present" },
          ],
          failureDetails: null,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "ready-for-final-review",
          currentStage: "test",
          completedStages: [
            "triage",
            "scouts",
            "grill",
            "specification",
            "plan",
            "implement",
            "dev-review",
            "test",
          ],
          candidates: [
            {
              id: "C1",
              revisionNumber: 2,
              status: "ready_for_final_review",
              baseRevision: "a".repeat(40),
              headRevision: "b".repeat(40),
              baseBranch: "main",
              branch: "agent-harness/ah-999-c1",
              revisions: [],
            },
          ],
          artifacts: [
            {
              id: "artifact-1",
              stage: "test",
              kind: "markdown",
              name: "test-c1-r2.md",
              content:
                'PASS\n\n<focused-test-evidence>\n{"candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:runtime","status":"passed","durationMs":900,"rows":[{"id":"row-1","candidateId":"C1","candidateRevision":2,"command":"npm.cmd run test:runtime","status":"passed","durationMs":900,"title":"runtime.test.mjs","artifactReferences":[{"name":"Markdown test artifact","kind":"markdown","path":"artifacts/test.md"}],"assertions":[{"label":"workspace renders the test artifact","actual":"present","expected":"present"}],"failureDetails":null}]}\n</focused-test-evidence>',
              createdAt: "2026-08-01T12:00:00.000Z",
              model: "GPT-5.4-mini",
              usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
              candidateId: "C1",
              candidateRevision: 2,
              focusedTest,
            },
          ],
          gateFreshness: {
            test: makeGateFreshness("test", {
              fresh: true,
              sourceRunId: "run-1",
              sourceArtifactId: "artifact-1",
              focusedTest,
            }),
          },
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /test-c1-r2\.md/);
    assert.match(markup, /Viewing/);
    assert.match(markup, /Candidate-bound structured evidence/);
    assert.match(markup, /workspace renders the test artifact/);
  });
});

test("renders exact-candidate failed Test rows while the gate remains rerun-required", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, getRuntimeFocusedTest }) => {
    const failedFocusedTest = {
      candidateId: "C1",
      candidateRevision: 2,
      bindingExplicit: true,
      command: "npm test",
      status: "failed",
      durationMs: 740,
      rows: [
        {
          id: "row-failed",
          candidateId: "C1",
          candidateRevision: 2,
          bindingExplicit: true,
          command: "npm test",
          status: "failed",
          durationMs: 740,
          title: "candidate-bound regression",
          artifactReferences: [],
          assertions: [{ label: "authoritative candidate", actual: "failed", expected: "passed" }],
          failureDetails: "The exact-candidate assertion failed.",
        },
      ],
    };
    const task = createTask({
      status: "repair-required",
      currentStage: "test",
      completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement", "dev-review"],
      candidates: [
        {
          id: "C1",
          revisionNumber: 2,
          status: "repair_required",
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          baseBranch: "main",
          branch: "agent-harness/ah-999-c1",
          revisions: [],
        },
      ],
      gateFreshness: {
        test: makeGateFreshness("test", {
          sourceRunId: "run-test-failed",
          reasonCode: "failed_execution",
          reasonCopy: "The authoritative run did not complete successfully.",
          focusedTest: failedFocusedTest,
        }),
      },
    });

    assert.equal(getRuntimeFocusedTest(task)?.rows[0].id, "row-failed");
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewedStageId: "test",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /0 passed.*1 failed.*C1 r2/);
    assert.match(markup, /candidate-bound regression/);
    assert.match(markup, /failed/);
  });
});

test("treats missing and mismatched candidate bindings as stale in navigation and approval counts", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 2,
      status: "awaiting_human_approval",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      revisions: [
        {
          number: 1,
          headRevision: "c".repeat(40),
          reason: "assembly",
          createdAt: "2026-08-01T11:00:00.000Z",
        },
        { number: 2, headRevision: "b".repeat(40), reason: "repair", createdAt: "2026-08-01T12:00:00.000Z" },
      ],
    };
    const gateArtifact = (stage, revision, withBinding = true, blockingReasons = []) => ({
      id: `${stage}-${revision}`,
      stage,
      kind: "markdown",
      name: `${stage}-c1-r${revision}.md`,
      content: "PASS",
      createdAt: "2026-08-01T12:00:00.000Z",
      model: "gpt-5.6-sol",
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      ...(withBinding ? { candidateId: "C1", candidateRevision: revision } : {}),
      gateResult: withBinding
        ? {
            verdict: "PASS",
            candidateId: "C1",
            candidateRevision: revision,
            evaluatedAt: "2026-08-01T12:00:00.000Z",
            blockingReasons,
          }
        : null,
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "awaiting-human-approval",
          currentStage: "approval",
          completedStages: [
            "triage",
            "scouts",
            "grill",
            "specification",
            "plan",
            "implement",
            "dev-review",
            "test",
            "final-review",
          ],
          candidates: [candidate],
          artifacts: [
            gateArtifact("dev-review", 2, true, ["A contradictory blocker remains."]),
            gateArtifact("test", 1),
            gateArtifact("test", 2, false),
            gateArtifact("final-review", 2),
          ],
          gateFreshness: {
            "dev-review": makeGateFreshness("dev-review", {
              sourceRunId: "run-dev-review",
              sourceArtifactId: "dev-review-2",
              reasonCode: "contradictory_evidence",
              reasonCopy: "Candidate evidence contains contradictory result fields.",
            }),
            test: makeGateFreshness("test", {
              sourceRunId: "run-test",
              sourceArtifactId: "test-2",
              reasonCode: "missing_binding",
              reasonCopy: "Candidate evidence is missing explicit candidateId and candidateRevision fields.",
            }),
            "final-review": makeGateFreshness("final-review", {
              fresh: true,
              sourceRunId: "run-final-review",
              sourceArtifactId: "final-review-2",
            }),
          },
        }),
        initialViewedStageId: "approval",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /1 of 3 candidate-bound gates fresh/);
    assert.match(markup, /rerun required/);
    assert.match(markup, /test-c1-r2\.md/);
  });
});

test("resolves same-revision superseded artifacts with authoritative stale reason copy", () => {
  return withWorkspace(async ({ getRuntimeArtifactFreshness, isArtifactFresh }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 2,
      status: "under_review",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      revisions: [],
    };
    const usage = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 };
    const artifact = (id, runId, createdAt) => ({
      id,
      runId,
      stage: "dev-review",
      kind: "markdown",
      name: `${id}.md`,
      content: "PASS",
      createdAt,
      model: "gpt-5.6-sol",
      usage,
      candidateId: "C1",
      candidateRevision: 2,
      gateResult: {
        verdict: "PASS",
        candidateId: "C1",
        candidateRevision: 2,
        evaluatedAt: createdAt,
        blockingReasons: [],
      },
    });
    const run = (id, artifactId, attempt, freshness) => ({
      id,
      kind: "review",
      status: "completed",
      stage: "dev-review",
      role: "dev-review",
      model: "gpt-5.6-sol",
      reasoning: "high",
      startedAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:01:00.000Z",
      durationMs: 60_000,
      artifactId,
      usage,
      credits: null,
      apiEstimate: null,
      candidateId: "C1",
      candidateRevision: 2,
      workPackageId: null,
      attempt,
      retryOfRunId: null,
      repairOfRunId: null,
      toolCalls: [],
      test: null,
      evidenceError: null,
      freshness,
      gateResult: {
        verdict: "PASS",
        candidateId: "C1",
        candidateRevision: 2,
        evaluatedAt: "2026-08-01T12:01:00.000Z",
        blockingReasons: [],
      },
      error: null,
      source: "codex-jsonl",
    });
    const superseded = makeGateFreshness("dev-review", {
      sourceRunId: "RUN-OLD",
      sourceArtifactId: "ART-OLD",
      reasonCode: "superseded_attempt",
      reasonCopy: "A later terminal attempt superseded this historical evidence.",
    });
    const authoritative = makeGateFreshness("dev-review", {
      fresh: true,
      sourceRunId: "RUN-CURRENT",
      sourceArtifactId: "ART-CURRENT",
    });
    const oldArtifact = artifact("ART-OLD", "RUN-OLD", "2026-08-01T12:01:00.000Z");
    const currentArtifact = artifact("ART-CURRENT", "RUN-CURRENT", "2026-08-01T12:02:00.000Z");
    oldArtifact.freshness = superseded;
    currentArtifact.freshness = authoritative;
    const task = createTask({
      candidates: [candidate],
      artifacts: [oldArtifact, currentArtifact],
      runs: [run("RUN-OLD", "ART-OLD", 1, superseded), run("RUN-CURRENT", "ART-CURRENT", 2, authoritative)],
      gateFreshness: { "dev-review": authoritative },
    });

    const oldFreshness = getRuntimeArtifactFreshness(task, oldArtifact);
    const currentFreshness = getRuntimeArtifactFreshness(task, currentArtifact);
    assert.equal(oldFreshness.reasonCode, "superseded_attempt");
    assert.equal(oldFreshness.reasonCopy, "A later terminal attempt superseded this historical evidence.");
    assert.equal(isArtifactFresh(oldArtifact, candidate), false);
    assert.equal(isArtifactFresh(currentArtifact, candidate), true);
    assert.equal(isArtifactFresh(oldArtifact, candidate, oldFreshness), false);
    assert.equal(isArtifactFresh(currentArtifact, candidate, currentFreshness), true);
    assert.equal(
      getRuntimeArtifactFreshness(
        createTask({
          candidates: [candidate],
          artifacts: [oldArtifact],
          runs: [],
          gateFreshness: { "dev-review": authoritative },
        }),
        oldArtifact,
      ).reasonCode,
      "superseded_attempt",
    );
  });
});

test("renders workspace artifact freshness from persisted run evidence", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, isArtifactFresh }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 2,
      status: "under_review",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      revisions: [],
    };
    const usage = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 };
    const artifact = (id, runId, createdAt, freshness) => ({
      id,
      runId,
      stage: "dev-review",
      kind: "markdown",
      name: `${id}.md`,
      content: "# Candidate-bound review",
      createdAt,
      model: "gpt-5.6-sol",
      usage,
      candidateId: "C1",
      candidateRevision: 2,
      freshness,
    });
    const staleReason = "A later terminal attempt superseded this historical evidence.";
    const oldFreshness = makeGateFreshness("dev-review", {
      sourceRunId: "RUN-OLD",
      sourceArtifactId: "ART-OLD",
      reasonCode: "superseded_attempt",
      reasonCopy: staleReason,
    });
    const currentFreshness = makeGateFreshness("dev-review", {
      fresh: true,
      sourceRunId: "RUN-CURRENT",
      sourceArtifactId: "ART-CURRENT",
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "awaiting-human-approval",
          currentStage: "dev-review",
          completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
          candidates: [candidate],
          artifacts: [
            artifact("ART-OLD", "RUN-OLD", "2026-08-01T12:01:00.000Z", oldFreshness),
            artifact("ART-CURRENT", "RUN-CURRENT", "2026-08-01T12:02:00.000Z", currentFreshness),
            {
              ...artifact("ART-UNRELATED", "RUN-UNRELATED", "2026-08-01T12:03:00.000Z", oldFreshness),
              candidateId: "C2",
            },
          ],
          runs: [
            { id: "RUN-OLD", artifactId: "ART-OLD", freshness: oldFreshness },
            { id: "RUN-CURRENT", artifactId: "ART-CURRENT", freshness: currentFreshness },
          ],
          gateFreshness: { "dev-review": currentFreshness },
        }),
        initialViewedStageId: "dev-review",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );

    assert.doesNotMatch(markup, /Stale after repair/);
    assert.match(markup, /ART-CURRENT\.md/);
    const viewedRun = markup.slice(
      markup.indexOf("Viewed agent run"),
      markup.indexOf("Viewed agent run") + 500,
    );
    assert.match(viewedRun, /ART-CURRENT\.md/);
    assert.doesNotMatch(viewedRun, /ART-UNRELATED\.md/);
    assert.match(
      markup,
      new RegExp(
        `ART-OLD\\.md[\\s\\S]*Rerun required[\\s\\S]*${staleReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
    assert.equal(
      isArtifactFresh(
        { ...artifact("ART-OLD", "RUN-OLD", "2026-08-01T12:01:00.000Z", oldFreshness) },
        candidate,
      ),
      false,
    );
    assert.equal(oldFreshness.reasonCopy, staleReason);
  });
});

test("renders the exact persisted reason for a stale viewed-stage artifact", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 7,
      status: "under_review",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-005-c1",
      revisions: [],
    };
    const staleReason = "Candidate evidence belongs to a previous candidate revision.";
    const freshness = makeGateFreshness("dev-review", {
      sourceRunId: "RUN-R6",
      sourceArtifactId: "ART-R6",
      reasonCode: "revision_change",
      reasonCopy: staleReason,
    });
    const artifact = {
      id: "ART-R6",
      runId: "RUN-R6",
      stage: "dev-review",
      kind: "markdown",
      name: "dev-review-c1-r6.md",
      content: "# Prior review",
      createdAt: "2026-08-04T12:00:00.000Z",
      model: "gpt-5.6-sol",
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      candidateId: "C1",
      candidateRevision: 6,
      freshness,
    };
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "ready-for-review",
          currentStage: "dev-review",
          completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
          candidates: [candidate],
          artifacts: [artifact],
          runs: [{ id: "RUN-R6", artifactId: "ART-R6", freshness }],
          gateFreshness: { "dev-review": freshness },
        }),
        initialViewedStageId: "dev-review",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );

    assert.match(markup, /Rerun required/);
    assert.match(markup, new RegExp(staleReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(markup, /Stale after repair/);
    assert.match(markup, /Typed P0.P3 findings are persisted for gate evaluation/);
    assert.match(markup, /retained artifact remains the full prose review record/);
    assert.doesNotMatch(markup, /does not persist typed P0.P3 finding records/);
  });
});

test("renders dependency batches and package status during implementation", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "running",
          currentStage: "implement",
          completedStages: ["triage", "scouts", "grill", "specification", "plan"],
          workPackages: [
            {
              id: "S1",
              title: "Runtime contract",
              description: "Add the API behavior.",
              dependencies: [],
              batch: 1,
              ownedPaths: ["server/api.mjs"],
              verification: ["npm test"],
              status: "ready_for_integration",
              attempts: 1,
              branch: "agent-harness/ah-999-s1-a1",
              worktreePath: "C:/worktrees/S1-A1",
              baseRevision: "a".repeat(40),
              headRevision: "b".repeat(40),
              files: ["server/api.mjs"],
              error: null,
            },
            {
              id: "S2",
              title: "Runtime UI",
              description: "Render the API result.",
              dependencies: ["S1"],
              batch: 2,
              ownedPaths: ["src/App.tsx"],
              verification: ["npm run typecheck"],
              status: "running",
              attempts: 1,
              branch: "agent-harness/ah-999-s2-a1",
              worktreePath: "C:/worktrees/S2-A1",
              baseRevision: "a".repeat(40),
              headRevision: null,
              files: [],
              error: null,
            },
          ],
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onGrillAnswer: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /2 packages \u00b7 2 batches/);
    assert.match(markup, /Runtime contract/);
    assert.match(markup, /Runtime UI/);
    assert.match(markup, /dependencies unlock/);
  });
});

test("renders a truthful completion summary for historical merges without an approval artifact", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "completed",
          currentStage: "approval",
          completedStages: [
            "triage",
            "scouts",
            "grill",
            "specification",
            "plan",
            "implement",
            "dev-review",
            "test",
            "final-review",
            "approval",
          ],
          candidates: [
            {
              id: "C1",
              revisionNumber: 3,
              status: "merged",
              baseRevision: "a".repeat(40),
              headRevision: "b".repeat(40),
              baseBranch: "codex/vertical-slice",
              branch: "agent-harness/ah-999-c1",
              revisions: [],
            },
          ],
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(markup, /Candidate merged successfully/);
    assert.match(markup, /C1 revision 3 merged/);
    assert.match(markup, /Human approval gate/);
    assert.doesNotMatch(markup, /Human approval is not ready yet/);
  });
});

test("renders an exact-candidate approval artifact as current after a successful merge", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const approvalArtifact = {
      id: "approval-c1-r3",
      stage: "approval",
      kind: "markdown",
      name: "approval-c1-r3.md",
      content: "# Human approval and merge\n\n- Candidate: C1 revision 3",
      createdAt: "2026-08-01T12:05:00.000Z",
      model: "Human approval",
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
      candidateId: "C1",
      candidateRevision: 3,
    };
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          status: "completed",
          currentStage: "approval",
          completedStages: [
            "triage",
            "scouts",
            "grill",
            "specification",
            "plan",
            "implement",
            "dev-review",
            "test",
            "final-review",
            "approval",
          ],
          candidates: [
            {
              id: "C1",
              revisionNumber: 3,
              status: "merged",
              baseRevision: "a".repeat(40),
              headRevision: "b".repeat(40),
              baseBranch: "codex/vertical-slice",
              branch: "agent-harness/ah-999-c1",
              revisions: [],
            },
          ],
          artifacts: [approvalArtifact],
          gateFreshness: {
            "dev-review": makeGateFreshness("dev-review", { fresh: true, candidateRevision: 3 }),
            test: makeGateFreshness("test", { fresh: true, candidateRevision: 3 }),
            "final-review": makeGateFreshness("final-review", { fresh: true, candidateRevision: 3 }),
          },
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(markup, /Candidate merged successfully/);
    assert.match(markup, /approval-c1-r3\.md/);
    assert.match(markup, /Current evidence/);
    assert.doesNotMatch(markup, /Rerun required|Superseded evidence/);
  });
});

test("classifies workflow stages as past, current, or future from durable evidence alone (P0-4)", () => {
  return withWorkspace(async ({ getStageTemporalState }) => {
    const task = createTask({
      status: "ready-for-review",
      currentStage: "dev-review",
      completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
      attemptsByStage: { "dev-review": 1 },
    });

    // Past: already executed, whether or not it left a completedStages entry — a run or
    // artifact is equally durable evidence that the stage happened.
    assert.equal(getStageTemporalState(task, "triage"), "past");
    assert.equal(getStageTemporalState(task, "implement"), "past");

    // Current: the stage the task is actually on right now.
    assert.equal(getStageTemporalState(task, "dev-review"), "current");

    // Future: never reached, no run, no artifact, no attempt — must not read as history.
    assert.equal(getStageTemporalState(task, "test"), "future");
    assert.equal(getStageTemporalState(task, "final-review"), "future");
    assert.equal(getStageTemporalState(task, "approval"), "future");
  });
});

test("treats a stage with an artifact or run but no completedStages entry as past, not future (P0-4)", () => {
  return withWorkspace(async ({ getStageTemporalState }) => {
    const taskWithRun = createTask({
      status: "repair-required",
      currentStage: "implement",
      completedStages: ["triage", "scouts", "grill", "specification", "plan"],
      runs: [
        {
          id: "run-1",
          kind: "gate",
          status: "completed",
          stage: "dev-review",
          role: null,
          model: null,
          reasoning: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          artifactId: null,
          usage: null,
          credits: null,
          apiEstimate: null,
          candidateId: "C1",
          candidateRevision: 1,
          workPackageId: null,
          attempt: 1,
          retryOfRunId: null,
          repairOfRunId: null,
        },
      ],
    });
    assert.equal(getStageTemporalState(taskWithRun, "dev-review"), "past");
  });
});

test("a run in flight for a stage overrides its freshness state (P0-3)", () => {
  return withWorkspace(async ({ getActiveRunStage, isStageRunning }) => {
    const runningDevReview = createTask({
      status: "running",
      currentStage: "dev-review",
      completedStages: ["triage", "scouts", "grill", "specification", "plan", "implement"],
      runs: [
        {
          id: "run-2",
          kind: "gate",
          status: "running",
          stage: "dev-review",
          role: null,
          model: null,
          reasoning: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          artifactId: null,
          usage: null,
          credits: null,
          apiEstimate: null,
          candidateId: "C1",
          candidateRevision: 1,
          workPackageId: null,
          attempt: 1,
          retryOfRunId: null,
          repairOfRunId: null,
        },
      ],
    });
    assert.equal(getActiveRunStage(runningDevReview), "dev-review");
    assert.equal(isStageRunning(runningDevReview, "dev-review"), true);
    assert.equal(isStageRunning(runningDevReview, "test"), false);

    // A repair's own run.stage is "implement" even while the invalidated gate it will
    // eventually rerun is further along the workflow — task.currentStage has not moved
    // back to that gate yet, so nothing should claim that gate is running.
    const repairInFlight = createTask({
      status: "running",
      currentStage: "implement",
      completedStages: ["triage", "scouts", "grill", "specification", "plan"],
      runs: [
        {
          id: "run-3",
          kind: "repair",
          status: "running",
          stage: "implement",
          role: "repair",
          model: null,
          reasoning: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          artifactId: null,
          usage: null,
          credits: null,
          apiEstimate: null,
          candidateId: "C1",
          candidateRevision: 1,
          workPackageId: null,
          attempt: 1,
          retryOfRunId: null,
          repairOfRunId: null,
        },
      ],
    });
    assert.equal(getActiveRunStage(repairInFlight), "implement");
    assert.equal(isStageRunning(repairInFlight, "dev-review"), false);

    const notRunning = createTask({ status: "ready-for-review", currentStage: "dev-review" });
    assert.equal(getActiveRunStage(notRunning), null);
    assert.equal(isStageRunning(notRunning, "dev-review"), false);
  });
});

test("raises a GitHub PR at Human Approval and renders automatic merge tracking", () => {
  return withWorkspace(async ({ RuntimeCommandBar, RuntimeTaskWorkspace, nextAction, toTaskRunState }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 3,
      status: "awaiting_human_approval",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      revisions: [],
    };
    const approvalTask = createTask({
      status: "awaiting-human-approval",
      currentStage: "approval",
      candidates: [candidate],
      gateFreshness: {
        "dev-review": makeGateFreshness("dev-review", { fresh: true, candidateRevision: 3 }),
        test: makeGateFreshness("test", { fresh: true, candidateRevision: 3 }),
        "final-review": makeGateFreshness("final-review", { fresh: true, candidateRevision: 3 }),
      },
    });
    assert.equal(nextAction(approvalTask).action, "open-pr");
    const approvalMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task: approvalTask,
        viewedStageId: "approval",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(approvalMarkup, /Approve &amp; raise PR/);
    assert.match(approvalMarkup, /push only the exact reviewed candidate SHA/i);

    const waitingTask = createTask({
      ...approvalTask,
      status: "awaiting-pr-merge",
      candidates: [{ ...candidate, status: "pull_request_open" }],
      pullRequestIntent: {
        candidateId: "C1",
        candidateRevision: 3,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        targetBranch: "main",
        headBranch: "agent-harness/ah-999-c1-r3-bbbbbbbb",
        repository: "acme/widgets",
        number: 84,
        url: "https://github.com/acme/widgets/pull/84",
        note: "",
        status: "open",
        startedAt: "2026-08-01T12:00:00.000Z",
        openedAt: "2026-08-01T12:01:00.000Z",
        mergedAt: null,
        closedAt: null,
        mergeCommitRevision: null,
        lastCheckedAt: "2026-08-01T12:02:00.000Z",
        lastError: null,
        consecutivePollFailures: 0,
      },
    });
    assert.equal(toTaskRunState(waitingTask.status), "needs-input");
    assert.equal(nextAction(waitingTask).action, "reconcile-pr");
    const waitingMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: waitingTask,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(waitingMarkup, /Awaiting PR merge/);
    assert.match(waitingMarkup, /Awaiting GitHub merge/);
    assert.match(waitingMarkup, /#84/);
    assert.match(waitingMarkup, /Open PR on GitHub/);
    assert.match(waitingMarkup, /Check GitHub now/);
  });
});

test("filters structured activity and renders test run and artifact drilldown", () => {
  return withWorkspace(async ({ RunActivity, filterRunActivity }) => {
    const runBase = {
      status: "completed",
      role: "dev-review",
      model: "gpt-5.6-sol",
      reasoning: "high",
      startedAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:00:03.000Z",
      durationMs: 3_000,
      artifactId: null,
      usage: {
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 20,
        totalTokens: 120,
        credits: 0.25,
        cost: 0.002,
      },
      credits: 0.25,
      apiEstimate: 0.002,
      candidateId: "C1",
      candidateRevision: 2,
      workPackageId: null,
      attempt: 1,
      retryOfRunId: null,
      repairOfRunId: null,
      toolCalls: [],
      test: null,
      gateResult: {
        verdict: "PASS",
        candidateId: "C1",
        candidateRevision: 2,
        evaluatedAt: "2026-08-01T12:00:03.000Z",
        blockingReasons: [],
      },
      error: null,
      source: "codex-jsonl",
    };
    const task = createTask({
      runs: [
        { ...runBase, id: "RUN-REVIEW", kind: "review", stage: "dev-review" },
        {
          ...runBase,
          id: "RUN-TEST",
          kind: "test",
          stage: "test",
          role: "test",
          artifactId: "artifact-test",
          retryOfRunId: "RUN-REVIEW",
          toolCalls: [
            {
              id: "cmd-1",
              name: "command_execution",
              category: "repository-command",
              phase: "completed",
              result: "Exit code 0",
            },
          ],
          test: {
            candidateId: "C1",
            candidateRevision: 2,
            status: "passed",
            command: "npm.cmd test",
            durationMs: 900,
            rowCount: 1,
            failedRowIds: [],
          },
        },
      ],
      artifacts: [
        {
          id: "artifact-test",
          runId: "RUN-TEST",
          stage: "test",
          name: "test.md",
          kind: "markdown",
          content: "PASS",
          createdAt: "2026-08-01T12:00:03.000Z",
          model: "gpt-5.6-sol",
          usage: runBase.usage,
        },
      ],
      events: [
        {
          id: "E1",
          at: "2026-08-01T12:00:00.000Z",
          category: "agent",
          tone: "info",
          stage: "dev-review",
          title: "Review started",
          detail: "Fresh context",
          runId: "RUN-REVIEW",
        },
        {
          id: "E2",
          at: "2026-08-01T12:00:01.000Z",
          category: "tool",
          tone: "success",
          stage: "test",
          title: "Repository command completed",
          detail: "npm.cmd test",
          runId: "RUN-TEST",
          toolCall: {
            id: "cmd-1",
            name: "command_execution",
            category: "repository-command",
            phase: "completed",
            result: "Exit code 0",
          },
        },
        {
          id: "E3",
          at: "2026-08-01T12:00:02.000Z",
          category: "decision",
          tone: "success",
          stage: "approval",
          title: "Approved",
          detail: "Proceed",
          approvalId: "A1",
        },
      ],
    });

    assert.equal(filterRunActivity(task, "activity").length, 3);
    assert.deepEqual(
      filterRunActivity(task, "agent").map((item) => item.run.id),
      ["RUN-REVIEW"],
    );
    assert.deepEqual(
      filterRunActivity(task, "test").map((item) => item.run.id),
      ["RUN-TEST"],
    );
    assert.deepEqual(
      filterRunActivity(task, "decision").map((item) => item.event.id),
      ["E3"],
    );
    assert.deepEqual(
      filterRunActivity(task, "tool").map((item) => item.event.id),
      ["E2"],
    );

    const markup = renderToStaticMarkup(
      React.createElement(RunActivity, {
        task,
        initialFilter: "test",
        initialSelectedId: "run:RUN-TEST",
        onOpenArtifact: () => {},
      }),
    );
    assert.match(markup, /Tool calls/);
    assert.match(markup, /Run drilldown/);
    assert.match(markup, /RUN-TEST/);
    assert.match(markup, /Focused tests/);
    assert.match(markup, /Open test\.md/);
    assert.match(markup, /API-rate estimate/);
  });
});

test("renders retained malformed Test metadata without crashing Run Activity", () => {
  return withWorkspace(async ({ RunActivity }) => {
    const freshness = makeGateFreshness("test", {
      sourceRunId: "RUN-TEST-MALFORMED",
      reasonCode: "malformed_binding",
      reasonCopy: "Persisted candidate evidence has a malformed candidate binding.",
    });
    const task = createTask({
      runs: [
        {
          id: "RUN-TEST-MALFORMED",
          kind: "test",
          status: "completed",
          stage: "test",
          role: "test",
          model: "gpt-5.6-luna",
          reasoning: "xhigh",
          startedAt: "2026-08-01T12:00:00.000Z",
          completedAt: "2026-08-01T12:00:01.000Z",
          durationMs: 1_000,
          artifactId: null,
          usage: null,
          credits: null,
          apiEstimate: null,
          candidateId: "C1",
          candidateRevision: 2,
          workPackageId: null,
          attempt: 1,
          retryOfRunId: null,
          repairOfRunId: null,
          toolCalls: [],
          test: {
            candidateId: "C1",
            candidateRevision: 2,
            status: "failed",
            command: "npm test",
            durationMs: 1_000,
            rowCount: 1,
            failedRowIds: "row-failed",
            rows: [],
          },
          gateResult: null,
          evidenceError: null,
          freshness,
          error: null,
          source: "codex-jsonl",
        },
      ],
    });

    const markup = renderToStaticMarkup(
      React.createElement(RunActivity, {
        task,
        initialFilter: "test",
        initialSelectedId: "run:RUN-TEST-MALFORMED",
      }),
    );
    assert.match(markup, /failed count unavailable/);
    assert.match(markup, /Rerun required/);
    assert.match(markup, /Persisted candidate evidence has a malformed candidate binding\./);
  });
});

test("renders stale evidence in the mounted Run Activity views with exact persisted reasons", () => {
  return withWorkspace(async ({ RunActivity, filterRunActivity }) => {
    const revisionReason = "Candidate evidence belongs to a previous candidate revision.";
    const failureReason = "The terminal run failed, so its evidence is not fresh.";
    const missingBindingReason =
      "Candidate evidence is missing explicit candidateId and candidateRevision fields.";
    const run = (overrides) => ({
      id: "RUN-REVIEW-STALE",
      kind: "review",
      status: "completed",
      stage: "dev-review",
      role: "dev-review",
      model: "gpt-5.6-sol",
      reasoning: "high",
      startedAt: "2026-08-01T12:00:00.000Z",
      completedAt: "2026-08-01T12:00:03.000Z",
      durationMs: 3_000,
      artifactId: null,
      usage: null,
      credits: null,
      apiEstimate: null,
      candidateId: "C1",
      candidateRevision: 1,
      workPackageId: null,
      attempt: 1,
      retryOfRunId: null,
      repairOfRunId: null,
      toolCalls: [],
      test: null,
      gateResult: null,
      evidenceError: null,
      error: null,
      source: "codex-jsonl",
      freshness: makeGateFreshness("dev-review", {
        sourceRunId: "RUN-REVIEW-STALE",
        reasonCode: "revision_change",
        reasonCopy: revisionReason,
      }),
      ...overrides,
    });
    const reviewRun = run({});
    const testRun = run({
      id: "RUN-TEST-STALE",
      kind: "test",
      stage: "test",
      role: "test",
      freshness: makeGateFreshness("test", {
        sourceRunId: "RUN-TEST-STALE",
        reasonCode: "failed_execution",
        reasonCopy: failureReason,
      }),
    });
    const freshReviewRun = run({
      id: "RUN-REVIEW-FRESH",
      candidateRevision: 2,
      freshness: makeGateFreshness("dev-review", {
        fresh: true,
        sourceRunId: "RUN-REVIEW-FRESH",
      }),
    });
    const linkedStagePass = {
      id: "EVENT-STAGE-PASS",
      at: "2026-08-01T12:01:00.000Z",
      category: "decision",
      tone: "success",
      stage: "dev-review",
      title: "Development Review passed",
      detail: "C1 revision 1 advanced to the next gate.",
      runId: reviewRun.id,
    };
    const persistedStaleEvent = {
      id: "EVENT-PERSISTED-STALE",
      at: "2026-08-01T12:02:00.000Z",
      category: "agent",
      tone: "success",
      stage: "test",
      title: "Focused Test completed",
      detail: "Historical status: completed",
      freshness: testRun.freshness,
    };
    const legacyUnlinkedStagePass = {
      id: "EVENT-LEGACY-UNLINKED-PASS",
      at: "2026-08-01T12:03:00.000Z",
      category: "decision",
      tone: "success",
      stage: "dev-review",
      title: "Development Review passed",
      detail: "Historical C1 revision 1 gate result.",
      freshness: makeGateFreshness("dev-review", {
        sourceRunId: null,
        reasonCode: "missing_binding",
        reasonCopy: missingBindingReason,
      }),
    };
    const persistedStaleWithFreshLink = {
      id: "EVENT-PERSISTED-STALE-FRESH-LINK",
      at: "2026-08-01T12:04:00.000Z",
      category: "decision",
      tone: "success",
      stage: "dev-review",
      title: "Development Review passed",
      detail: "Historical gate event with invalid linkage.",
      runId: freshReviewRun.id,
      freshness: makeGateFreshness("dev-review", {
        sourceRunId: null,
        reasonCode: "missing_binding",
        reasonCopy: missingBindingReason,
      }),
    };
    const task = createTask({
      runs: [freshReviewRun, reviewRun, testRun],
      events: [linkedStagePass, persistedStaleEvent, legacyUnlinkedStagePass, persistedStaleWithFreshLink],
    });

    const activityItems = filterRunActivity(task, "activity");
    const linkedItem = activityItems.find((item) => item.event.id === linkedStagePass.id);
    assert.equal(linkedItem.tone, "warning");
    assert.match(linkedItem.title, /Rerun required/);
    assert.match(linkedItem.detail, new RegExp(revisionReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const persistedItem = activityItems.find((item) => item.event.id === persistedStaleEvent.id);
    assert.equal(persistedItem.tone, "warning");
    assert.match(persistedItem.detail, new RegExp(failureReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const legacyItem = activityItems.find((item) => item.event.id === legacyUnlinkedStagePass.id);
    assert.equal(legacyItem.tone, "warning");
    assert.match(legacyItem.title, /Rerun required/);
    assert.match(legacyItem.detail, new RegExp(missingBindingReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const invalidLinkItem = activityItems.find((item) => item.event.id === persistedStaleWithFreshLink.id);
    assert.equal(invalidLinkItem.tone, "warning");
    assert.match(invalidLinkItem.title, /Rerun required/);
    assert.match(
      invalidLinkItem.detail,
      new RegExp(missingBindingReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );

    const agentItem = filterRunActivity(task, "agent")[0];
    assert.equal(agentItem.tone, "warning");
    assert.match(agentItem.title, /Rerun required/);
    assert.match(agentItem.detail, /completed/);
    assert.match(agentItem.detail, new RegExp(revisionReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const testItem = filterRunActivity(task, "test")[0];
    assert.equal(testItem.tone, "warning");
    assert.match(testItem.detail, new RegExp(failureReason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    for (const [initialFilter, selectedId, reason] of [
      ["activity", `event:${linkedStagePass.id}`, revisionReason],
      ["agent", `run:${reviewRun.id}`, revisionReason],
      ["test", `run:${testRun.id}`, failureReason],
      ["decision", `event:${linkedStagePass.id}`, revisionReason],
      ["decision", `event:${legacyUnlinkedStagePass.id}`, missingBindingReason],
      ["decision", `event:${persistedStaleWithFreshLink.id}`, missingBindingReason],
    ]) {
      const markup = renderToStaticMarkup(
        React.createElement(RunActivity, { task, initialFilter, initialSelectedId: selectedId }),
      );
      assert.match(markup, /runtime-activity-row--warning/);
      assert.match(markup, /Rerun required/);
      assert.match(markup, new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

test("resolves the current-stage retry allowance with zero and legacy fallbacks", () => {
  return withWorkspace(async ({ getCurrentStageRunLimit }) => {
    assert.equal(
      getCurrentStageRunLimit(
        createTask({
          currentStage: "implement",
          stageRunLimit: 3,
          stageRunLimits: { implement: 0, plan: 9 },
        }),
      ),
      0,
    );
    assert.equal(
      getCurrentStageRunLimit(
        createTask({
          currentStage: "implement",
          stageRunLimit: 3,
          stageRunLimits: { implement: null },
        }),
      ),
      3,
    );
    assert.equal(
      getCurrentStageRunLimit(
        createTask({
          currentStage: "implement",
          stageRunLimit: 3,
          stageRunLimits: {},
        }),
      ),
      3,
    );
  });
});

test("renders and dispatches the bounded specification retry action", () => {
  return withWorkspace(async ({ RuntimeCommandBar, RuntimeWorkflowActionButton, nextAction }) => {
    const baseProps = {
      onRun: async () => {},
      onAction: async () => {},
      onFinishGrill: async () => {},
    };
    const failedSpecification = createTask({
      status: "failed",
      currentStage: "specification",
      attemptsByStage: { specification: 1 },
      error: "Synthesis timed out.",
    });
    const retryAction = nextAction(failedSpecification);
    assert.equal(retryAction.action, "specification");
    assert.equal(retryAction.label, "Retry specification");
    assert.equal(nextAction({ ...failedSpecification, status: "cancelled" }).action, "specification");

    const retryMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: failedSpecification,
        viewedStageId: "specification",
      }),
    );
    assert.match(retryMarkup, />Retry specification</);
    assert.doesNotMatch(retryMarkup, /Run investigation/);

    const dispatchedActions = [];
    const retryButton = RuntimeWorkflowActionButton({
      action: retryAction.action,
      label: retryAction.label,
      pending: false,
      approvalBlocked: false,
      onInvoke: async (action) => dispatchedActions.push(action),
    });
    await retryButton.props.onClick();
    assert.deepEqual(dispatchedActions, ["specification"]);

    const blockedTask = createTask({
      status: "blocked",
      currentStage: "specification",
      attemptsByStage: { specification: 3 },
      stageRunLimits: { specification: 3 },
      actionEligibility: {
        generatedAt: "2026-08-01T12:01:00.000Z",
        actions: { "grant-retry": { allowed: true, reason: null } },
      },
    });
    assert.equal(nextAction(blockedTask).action, "grant-retry");
    const blockedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: blockedTask,
        viewedStageId: "specification",
      }),
    );
    assert.match(blockedMarkup, />Grant one stage attempt</);
    assert.doesNotMatch(blockedMarkup, /Retry specification/);

    const postGrantTask = createTask({
      status: "failed",
      currentStage: "specification",
      attemptsByStage: { specification: 3 },
      stageRunLimits: { specification: 4 },
    });
    assert.equal(nextAction(postGrantTask).action, "specification");
    const postGrantMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: postGrantTask,
        viewedStageId: "specification",
      }),
    );
    assert.match(postGrantMarkup, />Retry specification</);
    assert.doesNotMatch(postGrantMarkup, /Grant one stage attempt/);
  });
});

test("keeps plan approval primary while exposing evidence-backed revision", () => {
  return withWorkspace(async ({ RuntimeCommandBar, nextAction }) => {
    const task = createTask({
      status: "awaiting-plan-approval",
      currentStage: "plan",
      attemptsByStage: { plan: 1 },
    });
    assert.equal(nextAction(task).action, "approve-plan");
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task,
        viewedStageId: "plan",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, />Revise plan</);
    assert.match(markup, />Approve plan</);
    assert.match(markup, /Record the required correction as a task decision before revising/);

    const exhausted = createTask({
      status: "awaiting-plan-approval",
      currentStage: "plan",
      attemptsByStage: { plan: 3 },
      stageRunLimits: { plan: 3 },
    });
    assert.equal(nextAction(exhausted).action, "grant-retry");
    const exhaustedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task: exhausted,
        viewedStageId: "plan",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(exhaustedMarkup, />Grant one Plan attempt</);
    assert.doesNotMatch(exhaustedMarkup, />Revise plan</);
    assert.doesNotMatch(exhaustedMarkup, />Approve plan</);
  });
});

test("renders only backend-authorized failed Plan recovery and names the failed stage", () => {
  return withWorkspace(async ({ RuntimeCommandBar, RuntimeTaskWorkspace, nextAction }) => {
    const baseProps = {
      onRun: async () => {},
      onAction: async () => {},
      onFinishGrill: async () => {},
    };
    const failedPlan = createTask({
      status: "failed",
      currentStage: "plan",
      attemptsByStage: { plan: 1 },
      stageRunLimits: { plan: 3 },
      error: "Every work package needs at least one repository manifest command ID.",
      actionEligibility: {
        generatedAt: "2026-08-11T00:58:24.901Z",
        actions: { plan: { allowed: true, reason: null } },
      },
    });
    assert.equal(nextAction(failedPlan).action, "plan");
    const retryMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: failedPlan,
        viewedStageId: "plan",
      }),
    );
    assert.match(retryMarkup, />Retry Impl plan</);
    assert.doesNotMatch(retryMarkup, /No safe retry available/);

    const workspaceMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: failedPlan,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
        onCloseTask: async () => {},
      }),
    );
    assert.match(workspaceMarkup, /Implementation plan failed/);
    assert.doesNotMatch(workspaceMarkup, /Test failed/);

    const deniedPlan = {
      ...failedPlan,
      actionEligibility: {
        generatedAt: "2026-08-11T00:59:24.901Z",
        actions: { plan: { allowed: false, reason: "The plan stage has exhausted its retry allowance." } },
      },
    };
    const deniedMarkup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        ...baseProps,
        task: deniedPlan,
        viewedStageId: "plan",
      }),
    );
    assert.match(deniedMarkup, /No safe action available/);
    assert.match(deniedMarkup, /plan stage has exhausted its retry allowance/);
    assert.doesNotMatch(deniedMarkup, />Retry Impl plan</);
  });
});

test("offers recovery actions that match target drift, invalid plans, and retryable Test failures", () => {
  return withWorkspace(async ({ RuntimeCommandBar, nextAction }) => {
    const baseProps = {
      onRun: async () => {},
      onAction: async () => {},
      onFinishGrill: async () => {},
    };
    const candidate = {
      id: "C1",
      revisionNumber: 2,
      baseRevision: "a".repeat(40),
      baseBranch: "main",
      headRevision: "b".repeat(40),
      branch: "agent-harness/ah-999-c1",
      repositoryRoot: "C:/repo/task",
      worktreePath: "C:/worktrees/AH-999/C1",
      status: "repair_required",
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
      revisions: [],
    };
    const diverged = createTask({
      status: "blocked",
      currentStage: "approval",
      error: "The recorded target ref diverged while recovering a pending merge.",
      blocker: { code: "target-diverged", detail: "main advanced", detectedAt: "2026-08-01T12:00:00.000Z" },
      candidates: [{ ...candidate, status: "awaiting_human_approval" }],
    });
    assert.equal(nextAction(diverged).action, "refresh-candidate");
    assert.match(
      renderToStaticMarkup(
        React.createElement(RuntimeCommandBar, {
          ...baseProps,
          task: diverged,
          viewedStageId: "approval",
        }),
      ),
      />Refresh candidate from main</,
    );

    const refreshConflict = createTask({
      status: "blocked",
      currentStage: "test",
      error: "Candidate refresh conflicted while replaying it onto main.",
      blocker: { code: "target-refresh-conflict", detail: "overlap", detectedAt: "2026-08-01T12:00:00.000Z" },
      candidates: [{ ...candidate, status: "ready_for_test" }],
    });
    assert.equal(nextAction(refreshConflict).action, "rebuild-candidate");
    assert.match(nextAction(refreshConflict).label, /Rebuild from latest target/);

    const implementationDrift = createTask({
      status: "blocked",
      currentStage: "implement",
      blocker: {
        code: "implementation-target-diverged",
        detail: "main advanced",
        detectedAt: "2026-08-01T12:00:00.000Z",
      },
    });
    assert.equal(nextAction(implementationDrift).action, "restart-implementation");
    assert.match(nextAction(implementationDrift).label, /Restart from latest target/);

    const invalidPlan = createTask({
      status: "blocked",
      currentStage: "implement",
      error: "S1: Focused package verification requires at least one repository manifest command id.",
    });
    assert.equal(nextAction(invalidPlan).action, "plan");
    assert.match(nextAction(invalidPlan).label, /Correct implementation plan/);

    const failedQualification = createTask({
      status: "blocked",
      currentStage: "implement",
      error: "S1 did not qualify: backend-test failed.",
    });
    assert.equal(nextAction(failedQualification).action, "plan");

    const failedVerification = {
      candidateId: "C1",
      candidateRevision: 2,
      headRevision: candidate.headRevision,
      command: ".agent-harness/verification.json: test",
      status: "failed",
      durationMs: 100,
      rows: [],
      executionKind: "full-manifest",
    };
    const retryableTest = createTask({
      status: "repair-required",
      currentStage: "test",
      candidates: [candidate],
      artifacts: [
        {
          id: "test-c1-r2",
          stage: "test",
          name: "test-c1-r2.md",
          kind: "markdown",
          content: "Failed unrelated verification.",
          createdAt: "2026-08-01T12:00:00.000Z",
          candidateId: "C1",
          candidateRevision: 2,
          focusedTest: failedVerification,
          gateResult: { verdict: "REPAIR", findings: [] },
        },
      ],
    });
    assert.equal(nextAction(retryableTest).action, "retry-test");
    assert.match(nextAction(retryableTest).label, /Retry Test on C1 r2/);
    assert.equal(
      nextAction({
        ...retryableTest,
        sameCandidateTestRetries: [
          {
            id: "retry-1",
            candidateId: "C1",
            candidateRevision: 2,
            candidateHeadRevision: candidate.headRevision,
            failedVerificationCompletedAt: null,
            requestedAt: "2026-08-01T12:01:00.000Z",
          },
        ],
      }).action,
      "repair",
    );
  });
});

test("uses the authoritative current-stage allowance for workspace attempts and retry actions", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const task = createTask({
      status: "failed",
      currentStage: "implement",
      stageRunLimit: 3,
      stageRunLimits: { implement: 0, plan: 9 },
      attemptsByStage: { implement: 0 },
      candidates: [
        {
          id: "C1",
          revisionNumber: 1,
          status: "repair_required",
          baseRevision: "a".repeat(40),
          headRevision: "b".repeat(40),
          baseBranch: "main",
          branch: "agent-harness/ah-999-c1",
          repositoryRoot: "C:/repo/task",
          worktreePath: "C:/worktrees/ah-999-c1",
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
          revisions: [],
        },
      ],
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );

    assert.match(markup, /0 \/ 0/);
    assert.match(markup, /0 of 0/);
    assert.match(markup, /Grant one repair attempt/);
    assert.doesNotMatch(markup, /0 \/ 9|0 of 9/);

    const historicalMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        initialViewedStageId: "plan",
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(historicalMarkup, /0 \/ 0/);
    assert.match(historicalMarkup, /0 of 0/);
    assert.doesNotMatch(historicalMarkup, /Grant one repair attempt/);
  });
});

test("uses the Implement repair allowance when the failing gate remains the viewed stage", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace }) => {
    const candidate = {
      id: "C1",
      revisionNumber: 1,
      status: "repair_required",
      baseRevision: "a".repeat(40),
      headRevision: "b".repeat(40),
      baseBranch: "main",
      branch: "agent-harness/ah-999-c1",
      repositoryRoot: "C:/repo/task",
      worktreePath: "C:/worktrees/ah-999-c1",
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
      revisions: [],
    };
    const repairReady = createTask({
      status: "repair-required",
      currentStage: "final-review",
      stageRunLimit: 3,
      stageRunLimits: { implement: 3, "final-review": 3 },
      attemptsByStage: { implement: 1, "final-review": 3 },
      candidates: [candidate],
    });
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: repairReady,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(markup, /1 \/ 3/);
    assert.match(markup, /1 of 3/);
    assert.match(markup, /Implement repair attempts/);
    assert.match(markup, /Implement repair run/);
    assert.match(markup, /Implement repair is confined to the isolated candidate worktree/);
    assert.match(markup, /failed Final review gate remains the workflow position/);
    assert.match(markup, /Repair candidate/);
    assert.doesNotMatch(markup, /Grant one repair attempt/);
    assert.deepEqual(
      {
        stageRun: runtimeTaskToRecentTask(repairReady).stageRun,
        stageRunLimit: runtimeTaskToRecentTask(repairReady).stageRunLimit,
        stage: runtimeTaskToRecentTask(repairReady).stage,
        stageRunLabel: runtimeTaskToRecentTask(repairReady).stageRunLabel,
      },
      { stageRun: 1, stageRunLimit: 3, stage: "Final review", stageRunLabel: "Implement repair budget run" },
    );

    const afterGrant = {
      ...repairReady,
      stageRunLimits: { ...repairReady.stageRunLimits, implement: 4 },
      attemptsByStage: { ...repairReady.attemptsByStage, implement: 3 },
    };
    const afterGrantMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: afterGrant,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(afterGrantMarkup, /3 \/ 4/);
    assert.match(afterGrantMarkup, /Implement repair attempts/);
    assert.match(afterGrantMarkup, /Repair candidate/);
    assert.doesNotMatch(afterGrantMarkup, /Grant one repair attempt/);
  });
});

test("renders retry grant provenance in activity and decision surfaces without fabricating legacy audit", () => {
  return withWorkspace(async ({ RuntimeTaskWorkspace, RuntimeActivity, RunActivity }) => {
    const auditEvent = {
      id: "grant-event",
      at: "2026-08-01T12:00:01.000Z",
      category: "decision",
      tone: "success",
      stage: "dev-review",
      title: "Retry allowance granted",
      detail: "A human granted one retry.",
      grantedStage: "implement",
      previousLimit: 3,
      newLimit: 4,
      sourceRunId: "run-source",
      sourceRunIds: ["run-source-S1", "run-source-S2"],
      candidateId: "C1",
      candidateRevision: 2,
      candidateHeadRevision: "candidate-c1-r2",
      authorizingGateCandidateId: "C1",
      authorizingGateCandidateRevision: 2,
      authorizingGateCandidateHeadRevision: "candidate-c1-r2",
      authorizingGateArtifactId: "artifact-review-3",
      authorizingGateKind: "review",
      authorizingGateReservedAt: "2026-08-01T11:59:00.000Z",
      authorizingGateReservationId: "reservation-review-3",
      authorizingGateRunId: "run-review-3",
      authorizingGateStage: "dev-review",
      authorizingGateWorkflowAttempt: 3,
      candidateAuthorizerArtifactIds: ["artifact-authorizer-r1"],
      candidateAuthorizerReservationIds: ["reservation-authorizer-r1"],
      candidateAuthorizerRunIds: ["run-authorizer-r1"],
      candidateProducerArtifactIds: ["artifact-assembly-S1", "artifact-repair-2"],
      candidateProducerRunIds: ["run-assembly-S1", "run-repair-2"],
      workflowAttempt: 3,
      workflowCandidateId: "C1",
      workflowCandidateRevision: 1,
      workflowCandidateHeadRevision: "candidate-c1-r1",
      workflowReservationId: "reservation-implement-3",
    };
    const task = createTask({
      decisions: [
        {
          id: "grant-decision",
          question: "Retry grant",
          answer: "Granted for repair.",
          createdAt: "2026-08-01T12:00:01.000Z",
          grantedStage: "implement",
          previousLimit: 3,
          newLimit: 4,
          sourceRunId: "run-source",
          sourceRunIds: ["run-source-S1", "run-source-S2"],
          candidateId: "C1",
          candidateRevision: 2,
          candidateHeadRevision: "candidate-c1-r2",
          authorizingGateCandidateId: "C1",
          authorizingGateCandidateRevision: 2,
          authorizingGateCandidateHeadRevision: "candidate-c1-r2",
          authorizingGateArtifactId: "artifact-review-3",
          authorizingGateKind: "review",
          authorizingGateReservedAt: "2026-08-01T11:59:00.000Z",
          authorizingGateReservationId: "reservation-review-3",
          authorizingGateRunId: "run-review-3",
          authorizingGateStage: "dev-review",
          authorizingGateWorkflowAttempt: 3,
          candidateAuthorizerArtifactIds: ["artifact-authorizer-r1"],
          candidateAuthorizerReservationIds: ["reservation-authorizer-r1"],
          candidateAuthorizerRunIds: ["run-authorizer-r1"],
          candidateProducerArtifactIds: ["artifact-assembly-S1", "artifact-repair-2"],
          candidateProducerRunIds: ["run-assembly-S1", "run-repair-2"],
          workflowAttempt: 3,
          workflowCandidateId: "C1",
          workflowCandidateRevision: 1,
          workflowCandidateHeadRevision: "candidate-c1-r1",
          workflowReservationId: "reservation-implement-3",
        },
      ],
      events: [auditEvent],
    });

    const workspaceMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task,
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.match(workspaceMarkup, /Retry grant audit/);
    assert.match(workspaceMarkup, /Granted stage/);
    assert.match(workspaceMarkup, /Implement \(implement\)/);
    assert.match(workspaceMarkup, /3 → 4/);
    assert.match(workspaceMarkup, /Source run IDs/);
    assert.match(workspaceMarkup, /run-source-S1, run-source-S2/);
    assert.match(workspaceMarkup, /C1 revision 2/);
    assert.match(workspaceMarkup, /candidate-c1-r2/);
    assert.match(workspaceMarkup, /Authorizing gate/);
    assert.match(workspaceMarkup, /Dev review · review · attempt 3/);
    assert.match(workspaceMarkup, /reservation-review-3/);
    assert.match(workspaceMarkup, /run-review-3/);
    assert.match(workspaceMarkup, /artifact-review-3/);
    assert.match(workspaceMarkup, /2026-08-01T11:59:00.000Z/);
    assert.match(workspaceMarkup, /Candidate repair authorizers/);
    assert.match(workspaceMarkup, /reservation-authorizer-r1/);
    assert.match(workspaceMarkup, /Candidate authorizer runs/);
    assert.match(workspaceMarkup, /run-authorizer-r1/);
    assert.match(workspaceMarkup, /Candidate authorizer artifacts/);
    assert.match(workspaceMarkup, /artifact-authorizer-r1/);
    assert.match(workspaceMarkup, /Candidate producer runs/);
    assert.match(workspaceMarkup, /run-assembly-S1, run-repair-2/);
    assert.match(workspaceMarkup, /Candidate producer artifacts/);
    assert.match(workspaceMarkup, /artifact-assembly-S1, artifact-repair-2/);
    assert.match(workspaceMarkup, /Workflow attempt/);
    assert.match(workspaceMarkup, /Workflow candidate binding/);
    assert.match(workspaceMarkup, /C1 revision 1/);
    assert.match(workspaceMarkup, /candidate-c1-r1/);
    assert.match(workspaceMarkup, /reservation-implement-3/);

    const legacyMarkup = renderToStaticMarkup(
      React.createElement(RuntimeTaskWorkspace, {
        task: createTask({
          events: [
            {
              ...auditEvent,
              grantedStage: undefined,
              previousLimit: undefined,
              newLimit: undefined,
              sourceRunId: undefined,
              sourceRunIds: undefined,
              candidateId: undefined,
              candidateRevision: undefined,
              candidateHeadRevision: undefined,
              authorizingGateCandidateId: undefined,
              authorizingGateCandidateRevision: undefined,
              authorizingGateCandidateHeadRevision: undefined,
              authorizingGateArtifactId: undefined,
              authorizingGateKind: undefined,
              authorizingGateReservedAt: undefined,
              authorizingGateReservationId: undefined,
              authorizingGateRunId: undefined,
              authorizingGateStage: undefined,
              authorizingGateWorkflowAttempt: undefined,
              candidateAuthorizerArtifactIds: undefined,
              candidateAuthorizerReservationIds: undefined,
              candidateAuthorizerRunIds: undefined,
              candidateProducerArtifactIds: undefined,
              candidateProducerRunIds: undefined,
              workflowAttempt: undefined,
              workflowCandidateId: undefined,
              workflowCandidateRevision: undefined,
              workflowCandidateHeadRevision: undefined,
              workflowReservationId: undefined,
            },
          ],
        }),
        onBack: async () => {},
        onRun: async () => {},
        onCancel: async () => {},
        onAction: async () => {},
        onDecision: async () => {},
      }),
    );
    assert.doesNotMatch(legacyMarkup, /Retry grant audit/);
    assert.doesNotMatch(legacyMarkup, /No persisted source run/);

    const nullAudit = { ...auditEvent, sourceRunId: null, sourceRunIds: [] };
    const nullMarkup = renderToStaticMarkup(React.createElement(RuntimeActivity, { events: [nullAudit] }));
    assert.match(nullMarkup, /No persisted source runs/);
    const nullRunActivityMarkup = renderToStaticMarkup(
      React.createElement(RunActivity, {
        task: createTask({ events: [nullAudit] }),
        initialFilter: "activity",
        initialSelectedId: "event:grant-event",
      }),
    );
    assert.match(nullRunActivityMarkup, /No persisted source runs/);
  });
});

test("renders merge reconciliation as Needs input without investigation or running copy", () => {
  return withWorkspace(async ({ RuntimeCommandBar, nextAction, toTaskRunState }) => {
    const task = createTask({
      status: "merging",
      currentStage: "approval",
      mergeIntent: {
        status: "pending",
        candidateId: "C1",
        candidateRevision: 1,
        baseRevision: "a".repeat(40),
        headRevision: "b".repeat(40),
        targetRef: "refs/heads/main",
        note: "Approved exact candidate.",
        startedAt: "2026-08-04T00:00:00.000Z",
        completedAt: null,
        error: null,
      },
      actionEligibility: {
        generatedAt: "2026-08-04T00:01:00.000Z",
        actions: { "reconcile-merge": { allowed: true, reason: null } },
      },
    });
    assert.equal(toTaskRunState(task.status), "needs-input");
    assert.equal(runtimeTaskToRecentTask(task).status, "Needs input");
    assert.equal(nextAction(task).action, "reconcile-merge");
    const markup = renderToStaticMarkup(
      React.createElement(RuntimeCommandBar, {
        task,
        viewedStageId: "approval",
        onRun: async () => {},
        onAction: async () => {},
        onFinishGrill: async () => {},
      }),
    );
    assert.match(markup, /Merge intent requires reconciliation/);
    assert.match(markup, /Reconcile retained merge/);
    assert.doesNotMatch(markup, /Start the read-only investigation/);
    assert.doesNotMatch(markup, /spin/);
  });
});
