import "./git-env.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLinearClient } from "../server/integrations/linear-client.mjs";
import { LinearIntake } from "../server/integrations/linear-intake.mjs";
import { LinearWorkflow } from "../server/integrations/linear-workflow.mjs";
import { grillUpdate, taskUpdates } from "../server/integrations/linear-updates.mjs";
import { linearGrillReference } from "../server/linear-grill-contract.mjs";
import { TaskControlOrchestrator } from "../server/orchestrator-task-control.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";

const config = {
  organizationId: "org",
  appUserId: "app",
  clientId: "client",
  harnessUrl: "http://localhost:5199/",
  projectMappings: {},
};
const question = (id) => ({
  id,
  question: `Decide ${id}?`,
  whyItMatters: "Affects acceptance.",
  allowCustom: true,
  answer: null,
  options: [
    { label: "First", description: "First choice", recommended: true },
    { label: "Second", description: "Second choice", recommended: false },
  ],
});
async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "linear-workflow-"));
  const store = new SqliteTaskStore(path.join(root, "tasks.sqlite3"));
  await store.init();
  const task = await store.create({
    title: "Linear workflow fixture",
    description: "fixture",
    repositoryPath: root,
    externalSource: { provider: "linear", organizationId: "org", issueId: "issue", sessionId: "session" },
    grillPolicy: "manual",
  });
  await store.update(task.id, (draft) => {
    draft.status = "awaiting-grill";
    draft.currentStage = "grill";
    draft.grillSession = {
      status: "open",
      createdAt: "2026-09-22T00:00:00Z",
      questions: [question("Q1"), question("Q2")],
    };
  });
  const sent = new Map();
  const started = [];
  const client = {
    identity: async () => config,
    user: async (id) => ({ id, name: "Human", active: true, app: false, organization: { id: "org" } }),
    publishActivity: async (id, session, content) => {
      sent.set(id, { session, content });
    },
  };
  const orchestrator = new TaskControlOrchestrator({
    store,
    active: new Map(),
    run: async (_id, kind) => {
      started.push(kind);
    },
  });
  const workflow = new LinearWorkflow({ store, client, config, orchestrator });
  t.after(async () => {
    await orchestrator.shutdown();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { store, task, sent, client, started, workflow, orchestrator, root };
}
function prompt(body, id = "reply-1", overrides = {}) {
  return {
    type: "AgentSessionEvent",
    action: "prompted",
    ...config,
    oauthClientId: config.clientId,
    agentSession: { id: "session", issueId: "issue", organizationId: "org", appUserId: "app" },
    agentActivity: { id, agentSessionId: "session", userId: "human", content: { type: "prompt", body } },
    ...overrides,
  };
}
async function answer(f, number = 1, id = "reply-1") {
  const task = await f.store.get(f.task.id);
  const q = task.grillSession.questions.find((item) => !item.answer);
  f.workflow.accept(prompt(`@Harness answer ${linearGrillReference(task, q)}: ${number}`, id));
  await f.workflow.drain();
}

test("manual questions stream one at a time; explicit continuation reserves specification exactly once", async (t) => {
  const f = await setup(t);
  await f.workflow.drain();
  assert.equal(f.sent.size, 1);
  assert.match([...f.sent.values()][0].content.body, /Grill Q1/);
  await answer(f);
  let task = await f.store.get(f.task.id);
  assert.equal(task.grillSession.questions[0].answer, "First");
  assert.equal(task.decisions[0].linearReply.userId, "human");
  assert.equal(task.status, "awaiting-grill");
  assert.deepEqual(f.started, []);
  assert.match([...f.sent.values()].at(-1).content.body, /Grill Q2/);
  await answer(f, 2, "reply-2");
  task = await f.store.get(f.task.id);
  assert.equal(task.grillSession.questions[1].answer, "Second");
  assert.match([...f.sent.values()].at(-1).content.body, /continue/);
  assert.deepEqual(f.started, []);
  const event = prompt(`@Harness continue ${linearGrillReference(task)}`, "finish");
  f.workflow.accept(event);
  await f.workflow.drain();
  f.workflow.accept(event);
  await f.workflow.drain();
  assert.deepEqual(f.started, ["specification"]);
  task = await f.store.get(f.task.id);
  assert.equal(task.grillSession.completionSource, "linear");
  assert.equal(task.grillSession.linearCompletion.eventId, "finish");
});

test("new root mentions can answer, but do not overwrite answers or accept ambiguous prose", async (t) => {
  const f = await setup(t);
  await f.workflow.drain();
  const task = await f.store.get(f.task.id);
  const ref = linearGrillReference(task, task.grillSession.questions[0]);
  const event = prompt("");
  event.action = "created";
  event.agentSession.id = "new-root-session";
  event.agentSession.comment = {
    id: "comment-1",
    userId: "human",
    body: `@harness answer ${ref}: Custom answer`,
  };
  f.workflow.accept(event);
  await f.workflow.drain();
  f.workflow.accept(event);
  await f.workflow.drain();
  f.workflow.accept(prompt(`answer ${ref}: overwrite`, "stale"));
  await f.workflow.drain();
  f.workflow.accept(prompt("Yes, looks good, approve everything", "ambiguous"));
  await f.workflow.drain();
  const result = await f.store.get(task.id);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.grillSession.questions[0].answer, "Custom answer");
  assert.equal(result.grillSession.questions[1].answer, null);
  assert.ok(
    [...f.sent.values()].some(
      (item) => item.session === "new-root-session" && /Grill Q2/.test(item.content.body),
    ),
  );
  assert.deepEqual(f.started, []);
});

test("stale session, changed options, operator race, invalid option and automated authors cannot answer", async (t) => {
  const f = await setup(t);
  const task = await f.store.get(f.task.id);
  const ref = linearGrillReference(task, task.grillSession.questions[0]);
  await f.store.update(task.id, (draft) => {
    draft.grillSession.createdAt = "new-session";
  });
  f.workflow.accept(prompt(`answer ${ref}: 1`));
  await f.workflow.drain();
  assert.equal((await f.store.get(task.id)).decisions.length, 0);
  await answer(f, 99, "bad-option");
  assert.equal((await f.store.get(task.id)).decisions.length, 0);
  f.client.user = async (id) => ({ id, active: true, app: true, organization: { id: "org" } });
  await answer(f, 1, "bot");
  assert.equal((await f.store.get(task.id)).decisions.length, 0);
  f.client.user = async (id) => {
    await f.store.update(task.id, (draft) => {
      draft.grillSession.questions[0].answer = "Answered in UI";
    });
    return { id, active: true, app: false, organization: { id: "org" } };
  };
  await answer(f, 1, "race");
  assert.equal((await f.store.get(task.id)).grillSession.questions[0].answer, "Answered in UI");
});

test("inbox and outbox survive reopen; unknown HTTP outcome reuses the same activity identity", async (t) => {
  const f = await setup(t);
  let fail = true;
  const original = f.client.publishActivity;
  f.client.publishActivity = async (...args) => {
    await original(...args);
    if (fail) throw new Error("uncertain HTTP result");
  };
  await f.workflow.drain();
  assert.equal(f.sent.size, 1);
  const id = [...f.sent.keys()][0];
  f.store.close();
  await f.store.init();
  const restarted = new LinearWorkflow({
    store: f.store,
    client: f.client,
    config,
    orchestrator: f.orchestrator,
  });
  f.store.databaseHandle().prepare("UPDATE linear_workflow_messages SET next_attempt_at = 0").run();
  fail = false;
  await restarted.drain();
  assert.equal(f.sent.size, 1);
  assert.equal([...f.sent.keys()][0], id);
  assert.equal(restarted.status().recent[0].status, "completed");
});

test("committed reply is not reapplied after lost inbox acknowledgement", async (t) => {
  const f = await setup(t);
  await answer(f);
  f.store
    .databaseHandle()
    .prepare("UPDATE linear_workflow_messages SET status = 'queued' WHERE direction = 'in'")
    .run();
  await f.workflow.drain();
  assert.equal((await f.store.get(f.task.id)).decisions.length, 1);
  assert.deepEqual(f.started, []);
});

test("signed-event admission handles prompted messages and rejects mismatched identities", async (t) => {
  const f = await setup(t);
  const intake = new LinearIntake({ store: f.store, config, client: f.client, orchestrator: f.orchestrator });
  intake.setTaskCreator(() => {
    throw new Error("Replies must never create tasks");
  });
  assert.throws(() => intake.accept(prompt("hello", "x", { organizationId: "other" })), /identity/);
  const bad = prompt("hello");
  bad.agentActivity.agentSessionId = "other";
  assert.throws(() => intake.accept(bad), /identity/);
  assert.equal(intake.accept(prompt("hello")).accepted, true);
  await intake.drain();
  await intake.stop();
  assert.equal((await f.store.list()).length, 1);
  assert.equal(f.sent.size, 2); // command guidance plus current question
});

test("milestones include bounded evidence, candidate freshness, PR state and manual decisions", async (t) => {
  const f = await setup(t);
  const task = await f.store.get(f.task.id);
  task.status = "awaiting-human-approval";
  task.artifacts = ["specification", "plan", "dev-review", "test", "final-review"].map((stage) => ({
    id: stage,
    stage,
    content: "Useful summary\n```json\nsecret raw payload\n```\n" + "x".repeat(2000),
  }));
  task.artifacts[2].candidateId = "candidate";
  task.artifacts[2].candidateRevision = 1;
  task.artifacts[2].gateResult = { verdict: "PASS", findings: [] };
  task.candidates = [{ id: "candidate", revisionNumber: 2 }];
  task.pullRequestIntent = {
    status: "open",
    url: "https://github.com/example/repo/pull/1",
    candidateId: "candidate",
    candidateRevision: 2,
    headRevision: "sha",
  };
  const updates = taskUpdates(task, config);
  assert.equal(updates.length, 7);
  assert.match(updates[2].content.body, /stale; rerun required/);
  assert.ok(updates.every((item) => !item.content.body.includes("secret raw payload")));
  assert.ok(updates.every((item) => item.content.body.length < 2000));
  assert.match(updates.at(-1).content.body, /Awaiting merge; the task is not complete/);
  task.pullRequestIntent.status = "merged";
  assert.match(taskUpdates(task, config).at(-1).content.body, /Merge confirmed/);
  task.grillPolicy = "auto-accept-recommendations";
  task.status = "awaiting-grill";
  assert.equal(grillUpdate(task, config), null);
});

test("actual client uses human identity and stable activity UUID with read-before-retry", async () => {
  const calls = [];
  let exists = false;
  const client = createLinearClient({
    clientId: "app",
    clientSecret: "private",
    fetchImpl: async (url, options) => {
      if (url.includes("oauth")) return Response.json({ access_token: "secret", expires_in: 3600 });
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.query.includes("HarnessReplyUser"))
        return Response.json({
          data: { user: { id: "human", app: false, active: true, organization: { id: "org" } } },
        });
      if (body.query.includes("HarnessActivityReceipt"))
        return Response.json({ data: { agentActivities: { nodes: exists ? [{ id: "uuid" }] : [] } } });
      exists = true;
      return Response.json({ data: { agentActivityCreate: { success: true } } });
    },
  });
  assert.equal((await client.user("human")).app, false);
  await client.publishActivity("uuid", "session", { type: "elicitation", body: "Question" });
  await client.publishActivity("uuid", "session", { type: "elicitation", body: "Question" });
  assert.equal(calls.filter((call) => call.query.includes("HarnessProgress")).length, 1);
  assert.equal(calls.find((call) => call.query.includes("HarnessProgress")).variables.input.id, "uuid");
});

test("blocked delivery can be retried and obsolete questions are superseded instead of posted", async (t) => {
  const f = await setup(t);
  f.client.publishActivity = async () => {
    throw new Error("provider unavailable");
  };
  for (let i = 0; i < 5; i++) {
    f.store.databaseHandle().prepare("UPDATE linear_workflow_messages SET next_attempt_at = 0").run();
    await f.workflow.drain();
  }
  const message = f.workflow.status().recent[0];
  assert.equal(message.status, "blocked");
  assert.equal(f.workflow.retry(message.id), true);
  await f.store.update(f.task.id, (draft) => {
    draft.status = "closed";
  });
  const sent = [];
  f.client.publishActivity = async (_id, _session, content) => sent.push(content);
  await f.workflow.drain();
  assert.equal(f.workflow.status().recent.find((item) => item.id === message.id).status, "superseded");
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /closed/);
});

test("changed options and changed answers invalidate answer and continue references", async (t) => {
  const f = await setup(t);
  const before = await f.store.get(f.task.id);
  const ref = linearGrillReference(before, before.grillSession.questions[0]);
  await f.store.update(f.task.id, (draft) => {
    draft.grillSession.questions[0].options[0].label = "Changed";
  });
  f.workflow.accept(prompt(`answer ${ref}: 1`));
  await f.workflow.drain();
  assert.equal((await f.store.get(f.task.id)).decisions.length, 0);
  await answer(f, 1, "new-answer");
  await answer(f, 1, "next-answer");
  const completeRef = linearGrillReference(await f.store.get(f.task.id));
  await f.store.update(f.task.id, (draft) => {
    draft.grillSession.questions[0].answer = "Edited in Harness";
  });
  f.workflow.accept(prompt(`continue ${completeRef}`, "old-continue"));
  await f.workflow.drain();
  assert.deepEqual(f.started, []);
  assert.equal((await f.store.get(f.task.id)).status, "awaiting-grill");
  assert.equal([...f.sent.values()].at(-1).content.type, "elicitation");
});

test("inactive or cross-workspace humans, auto-Grill tasks and unsupported commands cannot advance", async (t) => {
  const f = await setup(t);
  f.client.user = async (id) => ({ id, active: false, app: false, organization: { id: "org" } });
  await answer(f, 1, "inactive");
  f.client.user = async (id) => ({ id, active: true, app: false, organization: { id: "other" } });
  await answer(f, 1, "cross-workspace");
  f.client.user = async (id) => ({ id, active: true, app: false, organization: { id: "org" } });
  await f.store.update(f.task.id, (draft) => {
    draft.grillPolicy = "auto-accept-recommendations";
  });
  await answer(f, 1, "automated");
  f.workflow.accept(prompt("approve and raise PR", "approval"));
  await f.workflow.drain();
  assert.equal((await f.store.get(f.task.id)).decisions.length, 0);
  assert.deepEqual(f.started, []);
});

test("Off pauses incoming answers and outbound milestones while local manual Grill still works", async (t) => {
  const f = await setup(t);
  const intake = new LinearIntake({ store: f.store, client: f.client, config, orchestrator: f.orchestrator });
  intake.setTaskCreator(() => {
    throw new Error("Must not import a task");
  });
  t.after(() => intake.stop());
  const task = await f.store.get(f.task.id);
  const reply = prompt(`answer ${linearGrillReference(task, task.grillSession.questions[0])}: 1`);
  assert.equal(intake.accept(reply).accepted, true);
  await intake.setEnabled(false);
  await intake.drain();
  assert.equal(f.sent.size, 0);
  assert.deepEqual(await f.store.get(f.task.id), task);
  assert.equal(intake.accept(prompt("continue ignored", "while-off")).accepted, false);
  await f.orchestrator.answerGrillQuestion(f.task.id, {
    source: "operator",
    questionId: "Q1",
    answer: "Local operator decision",
  });
  assert.equal((await f.store.get(f.task.id)).grillSession.questions[0].answer, "Local operator decision");
  await intake.drain();
  assert.equal(f.sent.size, 0);
  await intake.setEnabled(true);
  await intake.drain();
  assert.equal((await f.store.get(f.task.id)).grillSession.questions[0].answer, "Local operator decision");
  assert.ok(f.sent.size > 0);
  assert.equal(f.started.length, 0);
  await intake.stop();
});

test("Off lets the current outbound request settle but pauses the next activity", async (t) => {
  const f = await setup(t);
  const intake = new LinearIntake({ store: f.store, client: f.client, config, orchestrator: f.orchestrator });
  intake.setTaskCreator(() => {});
  const task = await f.store.get(f.task.id);
  f.workflow.enqueue(task, "session", "first-message", { type: "response", body: "First" });
  f.workflow.enqueue(task, "session", "second-message", { type: "response", body: "Second" });
  let release;
  let enter;
  const started = new Promise((resolve) => {
    enter = resolve;
  });
  let calls = 0;
  f.client.publishActivity = async () => {
    calls++;
    enter();
    await new Promise((resolve) => {
      release = resolve;
    });
  };
  intake.kick();
  await started;
  let confirmed = false;
  const off = intake.setEnabled(false).then(() => {
    confirmed = true;
  });
  assert.equal(confirmed, false);
  release();
  await off;
  await intake.drain();
  assert.equal(calls, 1);
  assert.ok(intake.status().workflow.recent.some((row) => row.status === "queued"));
  await intake.stop();
});
