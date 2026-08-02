import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { formatApprovalStage, formatApprovalTimestamp, getApprovalHistory } from "../src/components/runtimeApprovalHistory.js";

async function createServer() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-"));
  const store = new JsonTaskStore(path.join(directory, "tasks.json"));
  await store.init();
  let startedId = null;
  let recordedDecision = null;
  let grillAnswer = null;
  let grillFinish = null;
  let approvedSpecification = null;
  const orchestrator = {
    status: async () => ({ available: true, authenticated: true, authMethod: "ChatGPT" }),
    start(id) {
      startedId = id;
      return true;
    },
    cancel: () => false,
    async recordDecision(id, input) {
      recordedDecision = { id, ...input };
    },
    async answerGrillQuestion(id, input) {
      grillAnswer = { id, ...input };
    },
    async finishGrill(id, input) {
      grillFinish = { id, ...input };
      return { started: true };
    },
    async approveSpecification(id, note) {
      approvedSpecification = { id, note };
      return { started: false, completed: true };
    },
    async approvePlan() {},
    async approveMerge() {},
  };
  const server = createApiServer({ store, orchestrator, suggestedRepository: directory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    directory,
    origin: `http://127.0.0.1:${address.port}`,
    server,
    store,
    startedIdRef: () => startedId,
    recordedDecisionRef: () => recordedDecision,
    grillAnswerRef: () => grillAnswer,
    grillFinishRef: () => grillFinish,
    approvedSpecificationRef: () => approvedSpecification,
  };
}

async function cleanup(server, directory) {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}

async function createTask(origin, payload) {
  return fetch(`${origin}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

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

test("exposes a shared runtime schema version on local runtime endpoints", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const healthResponse = await fetch(`${origin}/api/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(Number.isInteger(health.runtimeSchemaVersion), true);

    const runtimeResponse = await fetch(`${origin}/api/runtime/status`);
    assert.equal(runtimeResponse.status, 200);
    const runtime = await runtimeResponse.json();
    assert.equal(Number.isInteger(runtime.runtimeSchemaVersion), true);
    assert.equal(runtime.runtimeSchemaVersion, health.runtimeSchemaVersion);
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
    const answerResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: "Q1", answer: "Preserve compatibility" }),
    });
    assert.equal(answerResponse.status, 201);
    assert.deepEqual(grillAnswerRef(), {
      id: task.id,
      questionId: "Q1",
      answer: "Preserve compatibility",
    });

    const finishResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acceptRemaining: true }),
    });
    assert.equal(finishResponse.status, 202);
    assert.deepEqual(grillFinishRef(), { id: task.id, acceptRemaining: true });
  } finally {
    await cleanup(server, directory);
  }
});

test("exposes approval history in the task payload", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Approval history",
      description: "Return persisted approval records.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.approvals.push(
        { id: "A1", stage: "specification", note: "Specification approved.", createdAt: "2026-08-01T10:15:00.000Z" },
        { id: "A2", stage: "plan", note: "Plan approved.", createdAt: "2026-08-01T10:20:00.000Z" },
      );
    });

    const fetched = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    assert.deepEqual(fetched.task.approvals, [
      { id: "A1", stage: "specification", note: "Specification approved.", createdAt: "2026-08-01T10:15:00.000Z" },
      { id: "A2", stage: "plan", note: "Plan approved.", createdAt: "2026-08-01T10:20:00.000Z" },
    ]);
  } finally {
    await cleanup(server, directory);
  }
});

test("formats approval history for the inspector", () => {
  const approvals = getApprovalHistory([
    { id: "A1", stage: "specification", note: "Specification approved.", createdAt: "2026-08-01T10:15:00.000Z" },
  ]);
  assert.equal(approvals.length, 1);
  assert.equal(formatApprovalStage(approvals[0].stage), "Task specification");
  assert.notEqual(formatApprovalTimestamp(approvals[0].createdAt), approvals[0].createdAt);
  assert.deepEqual(getApprovalHistory(undefined), []);
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

test("grants one bounded repair attempt to a blocked candidate", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Repair candidate",
      description: "Recover a blocked candidate without discarding its history.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "blocked";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimit;
      draft.candidates.push({ id: "C1", status: "repair_required" });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.status, "failed");
    assert.equal(updated.stageRunLimit, 4);
    assert.equal(updated.attemptsByStage.implement, 3);
    assert.equal(updated.candidates.at(-1).status, "repair_required");
    assert.equal(updated.events.at(-1).title, "One repair attempt granted");
  } finally {
    await cleanup(server, directory);
  }
});

for (const [name, payload] of [
  ["rejects invalid workflow values", { workflow: "review" }],
  ["rejects missing workflow values", {}],
  ["rejects empty workflow values", { workflow: "" }],
]) {
  test(name, async () => {
    const { directory, origin, server } = await createServer();
    try {
      const response = await createTask(origin, {
        title: "Invalid workflow task",
        description: "This should fail.",
        repositoryPath: directory,
        ...payload,
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid workflow" });
    } finally {
      await cleanup(server, directory);
    }
  });
}

for (const [name, payload] of [
  ["rejects missing grill question IDs", { answer: "Preserve compatibility" }],
  ["rejects blank grill question IDs", { questionId: "   ", answer: "Preserve compatibility" }],
  ["rejects missing grill answers", { questionId: "Q1" }],
  ["rejects blank grill answers", { questionId: "Q1", answer: "   " }],
]) {
  test(name, async () => {
    const { directory, origin, server, grillAnswerRef } = await createServer();
    try {
      const response = await createTask(origin, {
        title: "Grill boundary validation",
        description: "Keep malformed grill answers out of orchestration.",
        repositoryPath: directory,
        workflow: "implement",
      });
      const { task } = await response.json();
      const answerResponse = await fetch(`${origin}/api/tasks/${task.id}/grill/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(answerResponse.status, 400);
      assert.deepEqual(await answerResponse.json(), { error: "Question ID and answer are required." });
      assert.equal(grillAnswerRef(), null);
    } finally {
      await cleanup(server, directory);
    }
  });
}
