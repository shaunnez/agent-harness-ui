import test from "node:test";
import {
  assert,
  CANONICAL_RUN_STAGES,
  cleanup,
  createServer,
  createTask,
  fetch,
  JsonTaskStore,
  nativeFetch,
  path,
  RUN_ACTIVITY_EVENT_LIMIT,
  rawHttpRequest,
  readFile,
  TEST_CSRF_TOKEN,
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
