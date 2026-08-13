import test from "node:test";
import {
  assert,
  attachAssemblyLineage,
  attachCandidateProducerEvidence,
  attachExactCandidateGate,
  bindLatestWorkflowAttempt,
  CANONICAL_RUN_STAGES,
  cleanup,
  createServer,
  createTask,
  fetch,
  GitWorktreeManager,
  git,
  JsonTaskStore,
  mkdir,
  mkdtemp,
  nativeFetch,
  os,
  path,
  RUN_ACTIVITY_EVENT_LIMIT,
  rawHttpRequest,
  readFile,
  rm,
  TEST_CSRF_TOKEN,
  threeRevisionCandidate,
  twoRevisionCandidate,
  writeFile,
} from "./api-test-support.mjs";

test("does not misreport an ineligible candidate gate as already running", async () => {
  const { directory, origin, server, store } = await createServer({ startResult: false });
  try {
    const response = await createTask(origin, {
      title: "Ineligible Test action",
      description: "A repair-required task has no active run.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "test";
      draft.attemptsByStage.test = 1;
    });

    const testResponse = await fetch(`${origin}/api/tasks/${task.id}/test`, { method: "POST" });
    assert.equal(testResponse.status, 409);
    assert.deepEqual(await testResponse.json(), {
      error: "Task cannot run test while it is repair-required.",
    });
  } finally {
    await cleanup(server, directory);
  }
});

test("creates, lists, and starts a local task", async () => {
  const { directory, origin, server, store, startedIdRef, recordedDecisionRef, approvedSpecificationRef } =
    await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Real task",
      description: "Inspect the local repository.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "high",
    });
    assert.equal(createResponse.status, 201);
    const { task } = await createResponse.json();
    assert.equal(task.id, "AH-001");
    assert.equal(task.workflow, "investigate");
    assert.deepEqual(
      task.stageRunLimits,
      Object.fromEntries(CANONICAL_RUN_STAGES.map((stage) => [stage, 3])),
    );

    const prematureReview = await fetch(`${origin}/api/tasks/${task.id}/review`, { method: "POST" });
    assert.equal(prematureReview.status, 409);

    const listResponse = await fetch(`${origin}/api/tasks`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.equal(list.tasks.length, 1);

    const decisionResponse = await fetch(`${origin}/api/tasks/${task.id}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "Compatibility", answer: "Preserve it." }),
    });
    assert.equal(decisionResponse.status, 201);
    assert.deepEqual(recordedDecisionRef(), {
      id: task.id,
      question: "Compatibility",
      answer: "Preserve it.",
    });

    const runResponse = await fetch(`${origin}/api/tasks/${task.id}/run`, { method: "POST" });
    assert.equal(runResponse.status, 202);
    assert.equal(startedIdRef(), task.id);

    await store.update(task.id, (draft) => {
      draft.status = "awaiting-spec-approval";
    });
    const approvalResponse = await fetch(`${origin}/api/tasks/${task.id}/approve-spec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Approved for handoff." }),
    });
    assert.equal(approvalResponse.status, 200);
    assert.deepEqual(approvedSpecificationRef(), { id: task.id, note: "Approved for handoff." });
  } finally {
    await cleanup(server, directory);
  }
});

test("persists deterministic workflow-profile selection and permits an operator override before implementation", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Fix one copy label",
      description: "A tiny isolated wording change.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "low",
      workflowProfile: "auto",
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()).task;
    assert.equal(created.workflowProfile.selected, "fast");
    assert.equal(created.workflowProfile.source, "automatic");

    const response = await fetch(`${origin}/api/tasks/${created.id}/workflow-profile`, {
      method: "PUT",
      body: JSON.stringify({
        profile: "standard",
        reason: "Repository ownership is broader than the initial brief.",
      }),
    });
    assert.equal(response.status, 200);
    const updated = (await response.json()).task;
    assert.equal(updated.workflowProfile.selected, "standard");
    assert.equal(updated.workflowProfile.source, "operator");
    assert.match(updated.workflowProfile.reason, /ownership is broader/);
    assert.equal(updated.workflowProfile.history.length, 2);
  } finally {
    await cleanup(server, directory);
  }
});

test("lets blocked candidate gates reach the target-drift preflight", async () => {
  const { directory, origin, server, store, startedIdRef, startedKindRef } = await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Refresh before retry",
      description: "A stale blocker must not hide target drift.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await createResponse.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "test";
      draft.attemptsByStage.test = draft.stageRunLimits.test;
    });

    const detail = await (await fetch(`${origin}/api/tasks/${task.id}?view=core`)).json();
    assert.equal(detail.task.actionEligibility.actions.test.allowed, true);
    assert.equal(detail.task.actionEligibility.actions.test.mode, "preflight-only");

    const response = await fetch(`${origin}/api/tasks/${task.id}/test`, { method: "POST" });
    assert.equal(response.status, 202);
    assert.equal(startedIdRef(), task.id);
    assert.equal(startedKindRef(), "test");
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects invalid closure reasons without mutating task state", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Invalid closure reason",
      description: "Unsupported closure metadata must fail closed.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    const unchanged = await store.get(task.id);
    const unchangedState = {
      status: unchanged.status,
      closure: unchanged.closure,
      events: unchanged.events,
    };

    for (const payload of [{}, { reason: 42 }, { reason: "obsolete" }]) {
      const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(closeResponse.status, 400);
      const body = await closeResponse.json();
      assert.deepEqual(Object.keys(body), ["error"]);
      assert.equal(typeof body.error, "string");

      const current = await store.get(task.id);
      assert.deepEqual(
        { status: current.status, closure: current.closure, events: current.events },
        unchangedState,
      );
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects invalid supersededBy values without mutating task state", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Invalid supersession metadata",
      description: "Superseded closures require a usable replacement identifier.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    const unchanged = await store.get(task.id);
    const unchangedState = {
      status: unchanged.status,
      closure: unchanged.closure,
      events: unchanged.events,
    };

    for (const payload of [
      { reason: "superseded" },
      { reason: "superseded", supersededBy: "   " },
      { reason: "superseded", supersededBy: 123 },
    ]) {
      const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert.equal(closeResponse.status, 400);
      const body = await closeResponse.json();
      assert.deepEqual(Object.keys(body), ["error"]);
      assert.equal(typeof body.error, "string");

      const current = await store.get(task.id);
      assert.deepEqual(
        { status: current.status, closure: current.closure, events: current.events },
        unchangedState,
      );
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("normalizes valid supersession and clears supersededBy for other closure reasons", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const supersededResponse = await createTask(origin, {
      title: "Valid supersession metadata",
      description: "A valid replacement identifier is normalized before persistence.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task: supersededTask } = await supersededResponse.json();
    const closeSupersededResponse = await fetch(`${origin}/api/tasks/${supersededTask.id}/close`, {
      method: "POST",
      body: JSON.stringify({ reason: "superseded", supersededBy: "  AH-202  " }),
    });
    assert.equal(closeSupersededResponse.status, 200);
    const closedSuperseded = await closeSupersededResponse.json();
    assert.equal(closedSuperseded.task.closure.supersededBy, "AH-202");
    assert.equal((await store.get(supersededTask.id)).closure.supersededBy, "AH-202");

    for (const reason of ["not-needed", "duplicate"]) {
      const nonSupersededResponse = await createTask(origin, {
        title: `Non-superseded ${reason}`,
        description: "Non-superseded reasons do not retain replacement identifiers.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await nonSupersededResponse.json();
      const closeResponse = await fetch(`${origin}/api/tasks/${task.id}/close`, {
        method: "POST",
        body: JSON.stringify({ reason, supersededBy: "AH-202" }),
      });
      assert.equal(closeResponse.status, 200);
      const closed = await closeResponse.json();
      assert.equal(closed.task.closure.reason, reason);
      assert.equal(closed.task.closure.supersededBy, null);
      assert.equal((await store.get(task.id)).closure.supersededBy, null);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("retains decisions while store writes cap aggregate telemetry", async () => {
  const { directory, server, store } = await createServer();
  try {
    const task = await store.create({
      title: "Retention boundary",
      description: "Keep decisions through high-volume runtime telemetry.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    await store.update(task.id, (draft) => {
      draft.events.push({ id: "decision-before", category: "decision", title: "Decision retained" });
      draft.events.push(
        ...Array.from({ length: RUN_ACTIVITY_EVENT_LIMIT + 100 }, (_, index) => ({
          id: `tool-${index}`,
          category: "tool",
        })),
      );
    });
    await store.transition(
      task.id,
      () => true,
      (draft) => {
        draft.events.push({ id: "transition-tool", category: "tool" });
      },
    );

    const updated = await store.get(task.id);
    assert.equal(
      updated.events.some((event) => event.id === "decision-before"),
      true,
    );
    assert.equal(
      updated.events.some((event) => event.id === "tool-0"),
      false,
    );
    assert.equal(
      updated.events.filter((event) => ["activity", "agent", "tool", "artifact"].includes(event.category))
        .length,
      RUN_ACTIVITY_EVENT_LIMIT,
    );
  } finally {
    await cleanup(server, directory);
  }
});

test("retains decisions when a legacy store is migrated", async () => {
  const { directory, server, store } = await createServer();
  try {
    const task = await store.create({
      title: "Legacy retention boundary",
      description: "Migrate retained decisions without losing audit history.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const storePath = path.join(directory, "tasks.json");
    const state = JSON.parse(await readFile(storePath, "utf8"));
    const persistedTask = state.tasks.find((item) => item.id === task.id);
    persistedTask.events = [
      { id: "legacy-decision", category: "decision", title: "Legacy decision" },
      ...Array.from({ length: RUN_ACTIVITY_EVENT_LIMIT + 25 }, (_, index) => ({
        id: `legacy-tool-${index}`,
        category: "tool",
      })),
    ];
    state.schemaVersion = 3;
    delete persistedTask.stageRunLimits;
    await writeFile(storePath, `${JSON.stringify(state)}\n`, "utf8");

    const migratedStore = new JsonTaskStore(storePath);
    await migratedStore.init();
    const migrated = await migratedStore.get(task.id);
    assert.equal(
      migrated.events.some((event) => event.id === "legacy-decision"),
      true,
    );
    assert.equal(
      migrated.events.some((event) => event.id === "legacy-tool-0"),
      false,
    );
    assert.equal(
      migrated.events.filter((event) => ["activity", "agent", "tool", "artifact"].includes(event.category))
        .length,
      RUN_ACTIVITY_EVENT_LIMIT,
    );
    const migratedAgain = await migratedStore.get(task.id);
    assert.deepEqual(migratedAgain.events, migrated.events);
  } finally {
    await cleanup(server, directory);
  }
});

test("enforces one Host, Origin, content-type, CSRF, and missing-Origin policy across mutations", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const payload = JSON.stringify({
      title: "Rejected mutation",
      description: "This request must not cross the local browser boundary.",
      repositoryPath: directory,
      workflow: "investigate",
    });
    const foreignOrigin = await nativeFetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-harness-csrf": TEST_CSRF_TOKEN,
        origin: "https://hostile.example",
      },
      body: payload,
    });
    assert.equal(foreignOrigin.status, 403);
    const simplePost = await nativeFetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: payload,
    });
    assert.equal(simplePost.status, 415);
    const missingToken = await nativeFetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    assert.equal(missingToken.status, 403);
    const hostilePreflight = await nativeFetch(`${origin}/api/tasks`, {
      method: "OPTIONS",
      headers: { origin: "https://hostile.example" },
    });
    assert.equal(hostilePreflight.status, 403);
    const hostileHost = await rawHttpRequest(origin, "/api/tasks", {
      method: "POST",
      headers: {
        host: "hostile.example",
        "content-type": "application/json",
        "x-agent-harness-csrf": TEST_CSRF_TOKEN,
      },
      body: payload,
    });
    assert.equal(hostileHost.status, 403);
    const missingOriginWithToken = await nativeFetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-harness-csrf": TEST_CSRF_TOKEN },
      body: "{}",
    });
    assert.equal(missingOriginWithToken.status, 400);

    const mutationTargets = [
      ["PUT", "/api/settings"],
      ["POST", "/api/runtime/pricing/verify"],
      ["POST", "/api/tasks/AH-999/close"],
      ["POST", "/api/tasks/AH-999/evaluation"],
      ["POST", "/api/tasks/AH-999/decisions"],
      ["POST", "/api/tasks/AH-999/grill/answers"],
      ["POST", "/api/tasks/AH-999/grill/finish"],
      ["POST", "/api/tasks/AH-999/run"],
      ["POST", "/api/tasks/AH-999/specification"],
      ["POST", "/api/tasks/AH-999/cancel"],
      ["POST", "/api/tasks/AH-999/approve-merge"],
      ["POST", "/api/tasks/AH-999/open-pr"],
      ["POST", "/api/tasks/AH-999/reconcile-pr"],
      ["POST", "/api/tasks/AH-999/refresh-candidate"],
      ["POST", "/api/tasks/AH-999/rebuild-candidate"],
      ["POST", "/api/tasks/AH-999/restart-implementation"],
      ["POST", "/api/tasks/AH-999/retry-test"],
      ["POST", "/api/tasks/AH-999/complete-merged"],
    ];
    for (const [method, target] of mutationTargets) {
      const hostile = await nativeFetch(`${origin}${target}`, {
        method,
        headers: {
          origin: "https://hostile.example",
          "content-type": "application/json",
          "x-agent-harness-csrf": TEST_CSRF_TOKEN,
        },
        body: "{}",
      });
      assert.equal(hostile.status, 403, `${method} ${target} must reject a hostile Origin`);
      const wrongType = await nativeFetch(`${origin}${target}`, {
        method,
        headers: { "content-type": "text/plain", "x-agent-harness-csrf": TEST_CSRF_TOKEN },
        body: "{}",
      });
      assert.equal(wrongType.status, 415, `${method} ${target} must reject text/plain`);
      const noToken = await nativeFetch(`${origin}${target}`, {
        method,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(noToken.status, 403, `${method} ${target} must require CSRF`);
    }
    assert.equal((await store.list()).length, 0);
  } finally {
    await cleanup(server, directory);
  }
});

test("snapshots controlled experiment inputs and reports measured outcomes separately", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    await git(directory, ["init"]);
    await git(directory, ["config", "user.name", "Agent Harness Test"]);
    await git(directory, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(directory, "README.md"), "experiment base\n", "utf8");
    await git(directory, ["add", "README.md"]);
    await git(directory, ["commit", "-m", "experiment base"]);
    const baseSha = (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();

    const createResponse = await createTask(origin, {
      title: "Frozen experiment case",
      description: "Compare the same task brief under an explicit policy variant.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
      experiment: {
        groupId: "overnight-2026-08-03",
        variantId: "opaque-a",
        frozenBaseSha: baseSha,
        acceptanceCriteria: ["The result preserves the runtime contract."],
        verificationCommands: ["npm test"],
      },
    });
    assert.equal(createResponse.status, 201);
    const { task } = await createResponse.json();
    assert.equal(task.experiment.frozenBaseSha, baseSha);
    assert.match(task.experiment.taskBriefHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(task.experiment.policyMatrix, task.agentConfig.stagePolicies);

    await store.update(task.id, (draft) => {
      draft.startedAt = "2026-08-03T00:00:00.000Z";
      draft.completedAt = "2026-08-03T00:10:00.000Z";
      draft.status = "awaiting-human-approval";
      draft.attemptsByStage["dev-review"] = 2;
      draft.candidates.push({ revisions: [{ reason: "assembly" }, { reason: "repair" }] });
      draft.usage = {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
        totalTokens: 120,
        cost: 0.01,
        credits: 0.5,
      };
      const artifact = (stage, content, id) => ({
        id,
        stage,
        name: `${id}.md`,
        kind: "markdown",
        content,
        createdAt: "2026-08-03T00:01:00.000Z",
        startedAt: "2026-08-03T00:00:00.000Z",
        completedAt: "2026-08-03T00:01:00.000Z",
        durationMs: 60_000,
        model: "gpt-5.6-sol",
        reasoning: "high",
        agentRole: stage,
        usage: {
          inputTokens: 10,
          cachedInputTokens: 4,
          outputTokens: 2,
          totalTokens: 12,
          cost: 0.001,
          credits: 0.05,
        },
        contextManifest: { promptCharacters: 1_000, estimatedPromptTokens: 250 },
        gateResult: {
          verdict: content === "PASS" ? "PASS" : "REPAIR",
          candidateId: "C1",
          candidateRevision: 1,
          evaluatedAt: "2026-08-03T00:01:00.000Z",
          blockingReasons: content === "PASS" ? [] : ["Fixture repair"],
        },
      });
      draft.artifacts.push(
        artifact("dev-review", "REPAIR", "review-1"),
        artifact("dev-review", "PASS", "review-2"),
        artifact("test", "PASS", "test-1"),
      );
    });

    const humanResponse = await fetch(`${origin}/api/tasks/${task.id}/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        score: 4,
        outcome: "accepted",
        rubric: { correctness: 5, maintainability: 3 },
        notes: "Human review",
      }),
    });
    assert.equal(humanResponse.status, 200);
    const blindResponse = await fetch(`${origin}/api/tasks/${task.id}/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "blind",
        score: 5,
        outcome: "accepted",
        rubric: { overall: 5 },
        notes: "Locked blind review",
      }),
    });
    assert.equal(blindResponse.status, 200);

    const summaryResponse = await fetch(`${origin}/api/evaluations/summary`);
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.equal(summary.experiments.taskCount, 1);
    assert.equal(summary.observations.evaluatedTasks, 0);
    const variant = summary.experiments.variants[0];
    assert.equal(variant.sampleCount, 1);
    assert.equal(variant.firstPassGateSuccesses, 1);
    assert.equal(variant.firstPassGateSuccessRate, 0.5);
    assert.equal(variant.eventualGateSuccessRate, 1);
    assert.equal(variant.repairCount, 1);
    assert.equal(variant.retryCount, 1);
    assert.equal(variant.averageWallTimeMs, 600_000);
    assert.equal(variant.averageHumanScore, 4);
    assert.equal(variant.averageBlindScore, 5);
    assert.equal(variant.estimatedContextTokens, 750);

    await writeFile(path.join(directory, "README.md"), "repository moved\n", "utf8");
    await git(directory, ["add", "README.md"]);
    await git(directory, ["commit", "-m", "move experiment head"]);
    const movedResponse = await createTask(origin, {
      title: "Stale frozen base",
      description: "Reject a controlled task whose checkout no longer matches its declared base.",
      repositoryPath: directory,
      workflow: "implement",
      priority: "high",
      experiment: {
        groupId: "overnight-2026-08-03",
        variantId: "opaque-b",
        frozenBaseSha: baseSha,
        acceptanceCriteria: ["Reject a moved base."],
        verificationCommands: ["npm test"],
      },
    });
    assert.equal(movedResponse.status, 400);
    assert.match((await movedResponse.json()).error, /checked out at the frozen experiment base/i);
  } finally {
    await cleanup(server, directory);
  }
});

test("persists supported task attachments outside the repository", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const content = "<main>Reference artifact</main>";
    const response = await createTask(origin, {
      title: "Attached evidence",
      description: "Use the supplied HTML as task evidence.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      attachments: [
        {
          name: "reference.html",
          type: "text/html",
          size: Buffer.byteLength(content),
          data: Buffer.from(content).toString("base64"),
        },
      ],
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, "reference.html");
    assert.equal(await readFile(task.attachments[0].path, "utf8"), content);
    assert.equal(task.attachments[0].path.startsWith(directory), true);
  } finally {
    await cleanup(server, directory);
  }
});

test("records Grill answers and requires an explicit finish mode", async () => {
  const { directory, origin, server, grillAnswerRef, grillFinishRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Grill contract",
      description: "Persist an authoritative decision frontier.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    const bareFinishResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptRemaining: true }),
    });
    assert.equal(bareFinishResponse.status, 400);
    assert.deepEqual(await bareFinishResponse.json(), {
      error: "Finishing Grill requires an explicit operator UI action.",
    });
    assert.equal(grillFinishRef(), null, "the AH-016-style bare automation call never reaches orchestration");

    const answerResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionId: "Q1",
        answer: "Preserve compatibility",
        interactionSource: "operator-ui",
      }),
    });
    assert.equal(answerResponse.status, 201);
    assert.deepEqual(grillAnswerRef(), {
      id: task.id,
      questionId: "Q1",
      answer: "Preserve compatibility",
      source: "operator",
    });

    const finishResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptRemaining: true, interactionSource: "operator-ui" }),
    });
    assert.equal(finishResponse.status, 202);
    assert.deepEqual(grillFinishRef(), { id: task.id, acceptRemaining: true, source: "operator" });
  } finally {
    await cleanup(server, directory);
  }
});

test("creates a task with workflow implement", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Implement task",
      description: "Build the requested change.",
      repositoryPath: directory,
      workflow: "implement",
    });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.equal(task.workflow, "implement");
  } finally {
    await cleanup(server, directory);
  }
});

test("revises an awaiting plan only after a retained corrective decision", async () => {
  const { directory, origin, server, store, startedIdRef, startedKindRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Revise unsafe plan",
      description: "Keep plan approval explicit while allowing evidence-backed recovery.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.attemptsByStage.plan = 1;
      draft.workPackages = [{ id: "S1", title: "Wrong scope" }];
      draft.artifacts.push({
        id: "plan-r1",
        stage: "plan",
        name: "implementation-plan.md",
        kind: "markdown",
        content: "Wrong plan",
        createdAt: "2026-08-08T00:00:00.000Z",
      });
    });

    const blindRevision = await fetch(`${origin}/api/tasks/${task.id}/plan`, { method: "POST" });
    assert.equal(blindRevision.status, 409);
    assert.match((await blindRevision.json()).error, /record the required plan correction/i);

    const decision = await fetch(`${origin}/api/tasks/${task.id}/decisions`, {
      method: "POST",
      body: JSON.stringify({
        question: "How must the plan change?",
        answer: "Use one package and existing repository-relative test paths.",
      }),
    });
    assert.equal(decision.status, 201);
    await store.update(task.id, (draft) => {
      draft.decisions.push({
        id: "plan-correction",
        question: "How must the plan change?",
        answer: "Use one package and existing repository-relative test paths.",
        createdAt: "2026-08-08T00:01:00.000Z",
      });
    });

    const revision = await fetch(`${origin}/api/tasks/${task.id}/plan`, { method: "POST" });
    assert.equal(revision.status, 202);
    assert.deepEqual(await revision.json(), { started: true });
    assert.equal(startedIdRef(), task.id);
    assert.equal(startedKindRef(), "planning");
  } finally {
    await cleanup(server, directory);
  }
});

test("returns an exact retained candidate revision diff when its recorded head is requested", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-revision-diff-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Inspect retained diff",
      description: "Open a prior candidate revision without substituting the current head.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "first revision\n", "utf8");
    const first = await manager.commit(candidate, "candidate r1");
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "second revision\n", "utf8");
    const second = await manager.commit(candidate, "candidate r2");
    candidate.headRevision = second.headRevision;
    candidate.revisionNumber = 2;
    candidate.revisions = [
      {
        number: 1,
        headRevision: first.headRevision,
        reason: "assembly",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
      {
        number: 2,
        headRevision: second.headRevision,
        reason: "repair",
        createdAt: "2026-08-01T12:05:00.000Z",
      },
    ];
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: second.files, summary: second.summary });
    });

    const params = new URLSearchParams({ headRevision: first.headRevision });
    const response = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff?${params}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.revisionNumber, 1);
    assert.equal(payload.headRevision, first.headRevision);
    assert.match(payload.diff, /first revision/);
    assert.doesNotMatch(payload.diff, /second revision/);

    const missing = await fetch(
      `${origin}/api/tasks/${task.id}/candidates/C1/diff?headRevision=${"f".repeat(40)}`,
    );
    assert.equal(missing.status, 409);
    assert.match((await missing.json()).error, /no longer recorded/i);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("marks missing or dirty inventory rows as stale without mutating them", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-stale-inventory-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Stale inventory rows",
      description: "Surface honest Git state.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "candidate.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate worktree");
    await store.update(task.id, (draft) => {
      draft.candidates.push({
        ...candidate,
        headRevision: committed.headRevision,
        status: "ready_for_review",
      });
    });
    await rm(candidate.worktreePath, { recursive: true, force: true });

    const response = await fetch(`${origin}/api/runtime/worktrees`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    const row = payload.rows.find((item) => item.kind === "candidate");
    assert.equal(row.currentState, "stale");
    assert.equal(row.gitExists, false);
    assert.equal(row.cleanupReady, false);
    assert.equal(row.gitHeadRevision, null);
    assert.equal(row.headRevision, committed.headRevision);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("rejects stale or mismatched candidate diff requests", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-stale-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Reject stale diff",
      description: "Reject mismatched candidate metadata.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate diff");
    candidate.headRevision = committed.headRevision;
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: committed.files, summary: committed.summary });
    });

    await store.update(task.id, (draft) => {
      draft.candidates[0].headRevision = "f".repeat(40);
    });
    const staleHead = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(staleHead.status, 400);
    assert.match((await staleHead.json()).error, /no longer matches its recorded revision/i);

    await store.update(task.id, (draft) => {
      draft.candidates[0].headRevision = committed.headRevision;
      draft.candidates[0].worktreePath = path.join(candidate.worktreePath, "nested");
    });
    await mkdir(path.join(candidate.worktreePath, "nested"), { recursive: true });
    const staleWorktree = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(staleWorktree.status, 400);
    assert.equal(staleWorktree.headers.get("x-agent-harness-error-category"), "operational");
    assert.match((await staleWorktree.json()).error, /no longer resolves to its recorded path/i);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("caps oversized candidate diffs and marks them truncated", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-trunc-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Truncate diff",
      description: "Return a capped unified diff.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(
      path.join(candidate.worktreePath, "feature.txt"),
      `${"x".repeat(1000)}\n`.repeat(400),
      "utf8",
    );
    const committed = await manager.commit(candidate, "candidate diff");
    candidate.headRevision = committed.headRevision;
    await store.update(task.id, (draft) => {
      draft.candidates.push({ ...candidate, files: committed.files, summary: committed.summary });
    });

    const response = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.candidateId, "C1");
    assert.equal(payload.truncated, true);
    assert.equal(payload.diff.length <= 300_000, true);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("rejects assembly-only scope exceptions without exact ordered package commit membership", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "fabricated member head",
        mutate(candidate) {
          candidate.members[0].headRevision = "fabricated-head";
        },
      },
      {
        name: "missing member head",
        mutate(candidate) {
          candidate.members[1].headRevision = null;
        },
      },
      {
        name: "duplicate member order",
        mutate(candidate) {
          candidate.members[0].order = 2;
        },
      },
      {
        name: "noncanonical member order",
        mutate(candidate) {
          candidate.members.reverse();
        },
      },
      {
        name: "duplicate package commit heads",
        mutate(candidate, draft) {
          draft.workPackages[1].headRevision = draft.workPackages[0].headRevision;
          candidate.members[1].headRevision = candidate.members[0].headRevision;
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject assembly-only ${item.name}`,
        description: "The empty-scope exception must prove the exact canonical assembly membership.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "repair-required";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = draft.stageRunLimits.implement;
        draft.workPackages = [
          { id: "S2", status: "integrated", batch: 2, headRevision: "head-s2" },
          { id: "S1", status: "integrated", batch: 1, headRevision: "head-s1" },
        ];
        const reservation = {
          id: "reservation-assembly-only-3",
          stage: "implement",
          kind: "implementation",
          workflowAttempt: 3,
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:02:00.000Z",
        };
        draft.stageRunReservations.implement = reservation;
        const candidate = {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: "repair_required",
          members: [
            { packageId: "S1", headRevision: "head-s1", order: 1 },
            { packageId: "S2", headRevision: "head-s2", order: 2 },
          ],
          sourceWorkflowAttempt: 3,
          sourceWorkflowReservationId: reservation.id,
          revisions: [
            {
              number: 1,
              headRevision: "candidate-c1-r1",
              reason: "assembly",
              sourceWorkflowAttempt: 3,
              sourceWorkflowReservationId: reservation.id,
              createdAt: "2026-08-04T00:03:00.000Z",
            },
          ],
        };
        item.mutate(candidate, draft);
        draft.candidates.push(candidate);
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match((await grantResponse.json()).error, /inconsistent workflow reservation/i, item.name);
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits.implement, 3, item.name);
      assert.equal(unchanged.decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("starts repair after final review requests candidate repair", async () => {
  const { directory, origin, server, store, startedIdRef } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Final review repair",
      description: "Repair a candidate rejected by the final holdout.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "final-review";
      draft.attemptsByStage["final-review"] = 1;
      draft.candidates.push({
        id: "C1",
        revisionNumber: 1,
        headRevision: "candidate-c1-r1",
        status: "repair_required",
      });
    });

    const repairResponse = await fetch(`${origin}/api/tasks/${task.id}/repair`, { method: "POST" });
    assert.equal(repairResponse.status, 202);
    assert.deepEqual(await repairResponse.json(), { started: true });
    assert.equal(startedIdRef(), task.id);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects repaired candidate histories without a complete causal authorizer chain", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      {
        name: "producer before repair reservation",
        candidate: () => twoRevisionCandidate(),
        mutate(draft, candidate) {
          const revision = candidate.revisions[1];
          const run = draft.runs.find(
            (entry) => entry.workflowReservationId === revision.sourceWorkflowReservationId,
          );
          const artifact = draft.artifacts.find((entry) => entry.id === run.artifactId);
          run.startedAt = "2026-08-04T00:00:20.000Z";
          run.completedAt = "2026-08-04T00:00:21.000Z";
          artifact.createdAt = "2026-08-04T00:00:22.000Z";
        },
      },
      {
        name: "missing historical authorizer identity",
        candidate: () => twoRevisionCandidate(),
        mutate(_draft, candidate) {
          delete candidate.revisions[1].authorizingGateArtifactId;
        },
      },
      {
        name: "authorizer artifact after repair reservation",
        candidate: () => twoRevisionCandidate(),
        mutate(draft, candidate) {
          const revision = candidate.revisions[1];
          const artifact = draft.artifacts.find((entry) => entry.id === revision.authorizingGateArtifactId);
          artifact.createdAt = revision.sourceWorkflowReservedAt;
        },
      },
      {
        name: "shared historical authorizer identity",
        candidate: () => threeRevisionCandidate(),
        mutate(_draft, candidate) {
          const firstRepair = candidate.revisions[1];
          const secondRepair = candidate.revisions[2];
          secondRepair.authorizingGateReservationId = firstRepair.authorizingGateReservationId;
          secondRepair.authorizingGateRunId = firstRepair.authorizingGateRunId;
          secondRepair.authorizingGateArtifactId = firstRepair.authorizingGateArtifactId;
        },
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description:
          "Every retained Repair revision must preserve its causal gate, reservation, run, and artifact chain.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = "dev-review";
        const candidate = item.candidate();
        draft.attemptsByStage.implement = candidate.sourceWorkflowAttempt;
        draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
        draft.candidates.push(candidate);
        attachCandidateProducerEvidence(draft, candidate);
        const currentRevision = candidate.revisions.at(-1);
        const priorRevision = candidate.revisions.at(-2);
        draft.stageRunReservations.implement = {
          id: currentRevision.sourceWorkflowReservationId,
          stage: "implement",
          kind: "repair",
          workflowAttempt: currentRevision.sourceWorkflowAttempt,
          candidateId: candidate.id,
          candidateRevision: priorRevision.number,
          candidateHeadRevision: priorRevision.headRevision,
          authorizedRunScopes: [],
          reservedAt: currentRevision.sourceWorkflowReservedAt,
        };
        draft.stageRunReservations["dev-review"] = {
          id: `reservation-${task.id}-current-review-3`,
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
          candidateHeadRevision: candidate.headRevision,
          authorizedRunScopes: [],
          reservedAt: new Date(Date.parse(currentRevision.createdAt) + 60_000).toISOString(),
        };
        item.mutate(draft, candidate);
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /inconsistent workflow reservation|producer evidence|persisted identities/i,
        item.name,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits["dev-review"], 3, item.name);
      assert.equal(unchanged.decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects noncompleted, non-durable, or multiply claimed repair authorizers", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const mutation of [
      "failed authorizer run",
      "shared authorizer artifact",
      "blank authorizer artifact",
      "missing authorizer artifact timestamp",
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${mutation}`,
        description: "Repair authority must come from one completed durable gate run and artifact.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "repair-required";
        draft.currentStage = "dev-review";
        draft.attemptsByStage.implement = draft.stageRunLimits.implement;
        const candidate = attachAssemblyLineage(draft, {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: "repair_required",
        });
        draft.candidates.push(candidate);
        const authorizer = attachExactCandidateGate(draft, candidate);
        draft.runs.push(
          ...[1, 2, 3].map((attempt) => ({
            id: `run-failed-repair-envelope-${attempt}`,
            stage: "implement",
            status: "failed",
          })),
        );
        bindLatestWorkflowAttempt(draft, "implement", "repair");
        const authorizerRun = draft.runs.find((run) => run.id === authorizer.sourceRunId);
        const authorizerArtifact = draft.artifacts.find(
          (artifact) => artifact.id === authorizer.sourceArtifactId,
        );
        if (mutation === "failed authorizer run") authorizerRun.status = "failed";
        if (mutation === "shared authorizer artifact")
          draft.runs.at(-1).artifactId = authorizer.sourceArtifactId;
        if (mutation === "blank authorizer artifact") {
          authorizerArtifact.name = "";
          authorizerArtifact.content = "";
        }
        if (mutation === "missing authorizer artifact timestamp") delete authorizerArtifact.createdAt;
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, mutation);
      assert.match(
        (await grantResponse.json()).error,
        /authorizing gate|inconsistent workflow reservation|duplicate or inconsistent persisted identities/i,
        mutation,
      );
      const unchanged = await store.get(task.id);
      assert.equal(unchanged.stageRunLimits.implement, 3, mutation);
      assert.equal(unchanged.decisions.length, 0, mutation);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects incoherent ready-gate status, stage, and candidate tuples", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const item of [
      { name: "ready review status at Plan", stage: "plan", candidateStatus: "ready_for_review" },
      {
        name: "ready review gate with approval-stage candidate",
        stage: "dev-review",
        candidateStatus: "awaiting_human_approval",
      },
    ]) {
      const response = await createTask(origin, {
        title: `Reject ${item.name}`,
        description: "Ready-gate retry authority must use one coherent persisted state tuple.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "ready-for-review";
        draft.currentStage = item.stage;
        draft.attemptsByStage[item.stage] = draft.stageRunLimits[item.stage];
        draft.candidates.push({
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: item.candidateStatus,
          revisions: [],
        });
        draft.stageRunReservations[item.stage] = {
          id: `reservation-${item.stage}-3`,
          stage: item.stage,
          kind: item.stage === "plan" ? "planning" : "review",
          workflowAttempt: 3,
          candidateId: item.stage === "plan" ? null : "C1",
          candidateRevision: item.stage === "plan" ? null : 1,
          candidateHeadRevision: item.stage === "plan" ? null : "candidate-c1-r1",
          authorizedRunScopes: [],
          reservedAt: "2026-08-04T00:03:00.000Z",
        };
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, item.name);
      assert.match(
        (await grantResponse.json()).error,
        /exhausted blocked, approval, or repair stage/i,
        item.name,
      );
      assert.equal((await store.get(task.id)).decisions.length, 0, item.name);
    }
  } finally {
    await cleanup(server, directory);
  }
});

test("persists every uniquely dispatched Scout source run", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Multi-scout provenance",
      description: "A Scouts retry retains each uniquely dispatched Scout run.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    const scopes = ["scout-code-path", "scout-test-inventory"];
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "scouts";
      draft.attemptsByStage.scouts = draft.stageRunLimits.scouts;
      draft.scoutDispatch = {
        selected: scopes.map((name) => ({
          name,
          focus: `Focus ${name}.`,
          reason: "Needed.",
          status: "complete",
        })),
        skipped: [],
        rationale: "Two distinct evidence scopes.",
        createdAt: "2026-08-04T00:00:00.000Z",
        completedAt: "2026-08-04T00:01:00.000Z",
      };
      draft.stageRunReservations.scouts = {
        id: "reservation-scouts-3",
        stage: "scouts",
        kind: "investigation",
        workflowAttempt: 3,
        candidateId: null,
        candidateRevision: null,
        candidateHeadRevision: null,
        authorizedRunScopes: scopes,
        reservedAt: "2026-08-04T00:00:00.000Z",
      };
      draft.runs.push(
        ...[...scopes].reverse().map((role) => ({
          id: `run-${role}`,
          stage: "scouts",
          kind: "scout",
          role,
          status: "completed",
          candidateId: null,
          candidateRevision: null,
          candidateHeadRevision: null,
          workPackageId: null,
          attempt: 1,
          workflowAttempt: 3,
          workflowReservationId: "reservation-scouts-3",
        })),
      );
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = await store.get(task.id);
    assert.equal(updated.stageRunLimits.scouts, 4);
    assert.equal(updated.decisions.at(-1).sourceRunId, "run-scout-test-inventory");
    assert.deepEqual(updated.decisions.at(-1).sourceRunIds, [
      "run-scout-code-path",
      "run-scout-test-inventory",
    ]);
    assert.deepEqual(updated.events.at(-1).sourceRunIds, ["run-scout-code-path", "run-scout-test-inventory"]);
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects partial and orphaned explicit workflow identities instead of treating them as legacy", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    for (const [name, workflowIdentity] of [
      ["orphan", { workflowAttempt: 3, workflowReservationId: "missing-reservation" }],
      ["partial", { workflowAttempt: 3 }],
    ]) {
      const response = await createTask(origin, {
        title: `${name} workflow identity`,
        description: "Explicit workflow identity must be complete and backed by the current reservation.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      await store.update(task.id, (draft) => {
        draft.status = "blocked";
        draft.currentStage = "dev-review";
        draft.attemptsByStage["dev-review"] = draft.stageRunLimits["dev-review"];
        const candidate = attachAssemblyLineage(draft, {
          id: "C1",
          revisionNumber: 1,
          headRevision: "candidate-c1-r1",
          status: "ready_for_review",
        });
        draft.candidates.push(candidate);
        draft.stageRunReservations["dev-review"] = {
          id: "reservation-current-review-3",
          stage: "dev-review",
          kind: "review",
          workflowAttempt: 3,
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          reservedAt: "2026-08-04T00:02:00.000Z",
        };
        draft.runs.push({
          id: `run-${name}-review-3`,
          stage: "dev-review",
          kind: "review",
          role: "dev-review",
          status: "failed",
          candidateId: "C1",
          candidateRevision: 1,
          candidateHeadRevision: "candidate-c1-r1",
          workPackageId: null,
          attempt: 1,
          ...workflowIdentity,
        });
      });

      const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
      assert.equal(grantResponse.status, 409, name);
      assert.match((await grantResponse.json()).error, /partial or orphaned workflow identity/i, name);
      const updated = await store.get(task.id);
      assert.equal(updated.stageRunLimits["dev-review"], 3, name);
      assert.equal(updated.decisions.length, 0, name);
    }
  } finally {
    await cleanup(server, directory);
  }
});
