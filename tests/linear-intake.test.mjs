import "./git-env.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createApiServer } from "../server/api.mjs";
import { createLinearClient } from "../server/integrations/linear-client.mjs";
import { LinearIntake, linearTaskInput, readLinearConfig } from "../server/integrations/linear-intake.mjs";
import { createLinearWebhookServer, verifyLinearWebhook } from "../server/integrations/linear-webhook.mjs";
import { SqliteTaskStore } from "../server/sqlite-store.mjs";
import { JsonTaskStore } from "../server/store.mjs";

const exec = promisify(execFile);
const config = {
  organizationId: "org-1",
  appUserId: "app-1",
  clientId: "client-1",
  harnessUrl: "http://localhost:5199/",
  projectMappings: {},
};
const issue = {
  id: "issue-1",
  identifier: "ENG-123",
  title: "Fix intake",
  description: "Preserve **all** acceptance criteria.\n\n- First\n- Second",
  url: "https://linear.app/example/issue/ENG-123",
  priority: 2,
  priorityLabel: "High",
  project: { id: "linear-project", name: "Delivery" },
  team: { key: "ENG", name: "Engineering" },
  state: { name: "Todo" },
  assignee: { name: "Operator" },
  labels: { nodes: [{ id: "bug", name: "Bug" }] },
  attachments: { nodes: [{ id: "asset", title: "Screenshot", url: "https://example.test/image.png" }] },
  relations: { nodes: [{ type: "blocks", relatedIssue: { identifier: "ENG-124", title: "Next" } }] },
  inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "ENG-122", title: "Previous" } }] },
};
function event(sessionId = "session-1") {
  return {
    type: "AgentSessionEvent",
    action: "created",
    organizationId: config.organizationId,
    appUserId: config.appUserId,
    oauthClientId: config.clientId,
    webhookTimestamp: Date.now(),
    agentSession: {
      id: sessionId,
      issue,
      issueId: issue.id,
      organizationId: config.organizationId,
      appUserId: config.appUserId,
      comment: { body: "@Harness please import this issue." },
    },
    promptContext: "Retained issue context",
    guidance: [{ body: "Use the repo conventions." }],
  };
}
async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "linear-intake-test-"));
  await exec("git", ["init", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.name", "Fixture"]);
  await exec("git", ["-C", root, "config", "user.email", "fixture@example.test"]);
  await writeFile(path.join(root, "README.md"), "fixture\n");
  await exec("git", ["-C", root, "add", "README.md"]);
  await exec("git", ["-C", root, "commit", "-m", "fixture"]);
  const store = new SqliteTaskStore(path.join(root, "tasks.sqlite3"));
  await store.init();
  const project = await store.createProject({ name: "Harness project", repositoryPath: root });
  const localConfig = { ...config, projectMappings: { [issue.project.id]: project.id } };
  const calls = [];
  const client = {
    identity: async () => config,
    issue: async () => structuredClone(issue),
    linkSession: async (...args) => calls.push(["link", ...args]),
    completeSession: async (...args) => calls.push(["complete", ...args]),
  };
  const intake = new LinearIntake({ store, client, config: localConfig });
  const api = createApiServer({
    store,
    linearIntake: intake,
    csrfToken: "csrf-test",
    orchestrator: {
      start() {
        throw new Error("Must not start execution");
      },
    },
  });
  const webhook = createLinearWebhookServer({ intake, signingSecret: "test-secret" });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => webhook.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => api.close(resolve)),
      new Promise((resolve) => webhook.close(resolve)),
    ]);
    await intake.stop();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    project,
    config: localConfig,
    store,
    client,
    intake,
    calls,
    apiUrl: `http://127.0.0.1:${api.address().port}`,
    webhookUrl: `http://127.0.0.1:${webhook.address().port}`,
  };
}
function signed(body) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return {
    method: "POST",
    body: raw,
    headers: { "linear-signature": createHmac("sha256", "test-secret").update(raw).digest("hex") },
  };
}

test("signed mention creates one queued task with the standard policy and repository authority", async (t) => {
  const f = await setup(t);
  const response = await fetch(`${f.webhookUrl}/linear/webhook`, signed(event()));
  assert.equal(response.status, 200);
  await f.intake.drain();
  const tasks = await f.store.list();
  assert.equal(tasks.length, 1);
  const task = tasks[0];
  assert.equal(task.title, "ENG-123: Fix intake");
  assert.ok(task.description.startsWith(issue.description));
  assert.match(task.description, /Linear project: Delivery/);
  assert.match(task.description, /ENG-122 blocks ENG-123/);
  assert.equal(task.repositoryPath, f.root);
  assert.equal(task.status, "queued");
  assert.equal(task.runs.length, 0);
  assert.equal(task.repositoryAuthorityStatus, "bound");
  assert.ok(task.agentConfig.stagePolicies.triage);
  assert.equal(task.priority, "high");
  assert.deepEqual(task.externalSource.issue, issue);
  assert.equal(task.externalSource.promptContext, "Retained issue context");
  assert.equal(f.intake.status().recent[0].status, "completed");
  assert.ok(f.calls.some((call) => call[2] === `http://localhost:5199#task/${task.id}`));
  assert.equal((await fetch(`${f.webhookUrl}/api/tasks`)).status, 404);
  assert.equal((await fetch(`${f.apiUrl}/api/integrations/linear`)).status, 200);
});

test("rejects forged, stale, malformed and cross-workspace webhooks without importing", async (t) => {
  const f = await setup(t);
  const invalid = signed(event());
  invalid.headers["linear-signature"] = "0".repeat(64);
  assert.equal((await fetch(`${f.webhookUrl}/linear/webhook`, invalid)).status, 401);
  assert.equal(
    (
      await fetch(
        `${f.webhookUrl}/linear/webhook`,
        signed({ ...event(), webhookTimestamp: Date.now() - 600_000 }),
      )
    ).status,
    401,
  );
  assert.equal(
    (await fetch(`${f.webhookUrl}/linear/webhook`, signed({ ...event(), organizationId: "other" }))).status,
    403,
  );
  assert.equal(
    (await fetch(`${f.webhookUrl}/linear/webhook`, signed({ ...event(), appUserId: "other" }))).status,
    403,
  );
  assert.equal((await fetch(`${f.webhookUrl}/linear/webhook`, signed("{bad"))).status, 400);
  assert.equal((await fetch(`${f.webhookUrl}/linear/webhook`, signed("x".repeat(1_000_001)))).status, 413);
  assert.equal((await f.store.list()).length, 0);
  assert.throws(() => verifyLinearWebhook(Buffer.from("{}"), "x", "test-secret"), /signature/);
});

test("duplicate delivery, second mention and task edits preserve one original task", async (t) => {
  const f = await setup(t);
  f.intake.accept(event());
  f.intake.accept(event());
  await f.intake.drain();
  const [task] = await f.store.list();
  await f.store.update(task.id, (draft) => {
    draft.description = "Operator edited this brief.";
  });
  f.config.projectMappings = {}; // Even a moved or unmapped issue must reuse its already-created task.
  f.intake.accept(event("session-2"));
  await f.intake.drain();
  assert.equal((await f.store.list()).length, 1);
  assert.equal((await f.store.get(task.id)).description, "Operator edited this brief.");
  assert.ok(f.intake.status().recent.every((receipt) => receipt.taskId === task.id));
  assert.deepEqual(
    f.intake.status().counts.map((row) => ({ ...row })),
    [{ status: "completed", count: 2 }],
  );
});

test("durable receipt survives restart; crash after task commit cannot duplicate intake", async (t) => {
  const f = await setup(t);
  f.intake.accept(event());
  await f.intake.stop();
  const input = linearTaskInput(issue, event(), f.project);
  // Simulate a task commit immediately followed by loss of the worker before receipt update.
  const [a, b] = await Promise.all([f.store.create(input), f.store.create(input)]);
  assert.equal(a.id, b.id);
  f.store.close();
  const reopenedStore = new SqliteTaskStore(path.join(f.root, "tasks.sqlite3"));
  await reopenedStore.init();
  const restarted = new LinearIntake({ store: reopenedStore, client: f.client, config: f.config });
  restarted.setTaskCreator(() => {
    throw new Error("Existing task should be reused before admission");
  });
  await restarted.drain();
  await restarted.stop();
  assert.equal((await reopenedStore.list()).length, 1);
  assert.equal(restarted.status().recent[0].status, "completed");
  assert.equal(restarted.status().recent[0].taskId, a.id);
  reopenedStore.close();
});

test("unmapped projects retain a visible retryable receipt and never guess a repository", async (t) => {
  const f = await setup(t);
  f.config.projectMappings = {};
  f.intake.accept(event());
  await f.intake.drain();
  assert.equal((await f.store.list()).length, 0);
  assert.match(f.intake.status().recent[0].error, /Map this Linear project/);
  for (let attempt = 1; attempt < 5; attempt++) {
    f.store.databaseHandle().exec("UPDATE linear_intake SET next_attempt_at = 0");
    await f.intake.drain();
  }
  assert.equal(f.intake.status().recent[0].status, "blocked");
  f.config.projectMappings = { [issue.project.id]: f.project.id };
  const denied = await fetch(`${f.apiUrl}/api/integrations/linear/retry`, {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
  });
  assert.equal(denied.status, 403);
  f.intake.retry("session-1");
  await f.intake.drain();
  assert.equal((await f.store.list()).length, 1);
});

test("failed Linear acknowledgement retries against the persisted task without reimport", async (t) => {
  const f = await setup(t);
  f.client.completeSession = async () => {
    throw new Error("Linear API request failed (HTTP 429).");
  };
  f.intake.accept(event());
  await f.intake.drain();
  assert.equal((await f.store.list()).length, 1);
  assert.ok(f.intake.status().recent[0].taskId);
  f.client.completeSession = async () => {};
  f.client.issue = async () => {
    throw new Error("Must not refetch issue");
  };
  f.store.databaseHandle().exec("UPDATE linear_intake SET next_attempt_at = 0");
  await f.intake.drain();
  assert.equal(f.intake.status().recent[0].status, "completed");
});

test("follow-up prompts and non-issue mentions do not create tasks", async (t) => {
  const f = await setup(t);
  assert.equal(f.intake.accept({ ...event(), action: "prompted" }).accepted, false);
  const standalone = event();
  delete standalone.agentSession.issue;
  delete standalone.agentSession.issueId;
  assert.equal(f.intake.accept(standalone).accepted, false);
  assert.equal((await f.store.list()).length, 0);
});

test("oversized briefs are blocked, missing descriptions are explicit, and attachment limits are disclosed", () => {
  const project = { name: "Local", repositoryPath: "/repo" };
  assert.throws(
    () => linearTaskInput({ ...issue, description: "a".repeat(20_001) }, event(), project),
    /not silently truncated/,
  );
  const input = linearTaskInput(
    { ...issue, description: null, attachments: { nodes: [], pageInfo: { hasNextPage: true } } },
    event(),
    project,
  );
  assert.match(input.description, /No description was supplied/);
  assert.match(input.description, /first 100 attachments/);
});

test("client renews an expired credential once and does not expose provider error content", async () => {
  let authCount = 0;
  let requests = 0;
  const client = createLinearClient({
    clientId: "client",
    clientSecret: "secret",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/oauth/token")) {
        authCount++;
        assert.equal(options.body.get("scope"), "read,write,app:mentionable");
        return Response.json({ access_token: "test-token", expires_in: 3600 });
      }
      requests++;
      if (requests === 1) return new Response(null, { status: 401 });
      if (requests === 3) return Response.json({ errors: [{ message: "private-ticket-secret" }] });
      return Response.json({ data: { viewer: { id: "app" }, organization: { id: "org" } } });
    },
  });
  assert.deepEqual(await client.identity(), { appUserId: "app", organizationId: "org" });
  assert.equal(authCount, 2);
  await assert.rejects(client.identity(), (error) => !error.message.includes("private-ticket-secret"));
});

test("JSON store retains atomic external-source uniqueness too", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "linear-json-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JsonTaskStore(path.join(root, "tasks.json"));
  await store.init();
  const input = linearTaskInput(issue, event(), { name: "Local", repositoryPath: root });
  const results = await Promise.all([store.create(input), store.create(input)]);
  assert.equal(results[0].id, results[1].id);
});

test("configuration is opt-in and validates local mapping shape", async (t) => {
  assert.equal(await readLinearConfig(null), null);
  const root = await mkdtemp(path.join(os.tmpdir(), "linear-config-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "config.json");
  await writeFile(file, JSON.stringify({ ...config, projectMappings: { x: 1 } }));
  await assert.rejects(readLinearConfig(file), /projectMappings/);
});

test("operator task requests cannot forge Linear provenance or deduplication identity", async (t) => {
  const f = await setup(t);
  const input = linearTaskInput(issue, event(), f.project);
  const response = await fetch(`${f.apiUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-harness-csrf": "csrf-test" },
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 201);
  const { task } = await response.json();
  assert.equal(task.externalSource, null);
  f.intake.accept(event());
  await f.intake.drain();
  assert.equal((await f.store.list()).length, 2);
});

test("archived mappings and wrong app credentials never create a task", async (t) => {
  const f = await setup(t);
  await f.store.updateProject(f.project.id, { kind: "archive" });
  f.intake.accept(event());
  await f.intake.drain();
  assert.match(f.intake.status().recent[0].error, /active registered Harness project/);
  assert.equal((await f.store.list()).length, 0);
  f.client.identity = async () => ({ ...config, organizationId: "another-workspace" });
  f.store.databaseHandle().exec("UPDATE linear_intake SET next_attempt_at = 0");
  await f.intake.drain();
  assert.match(f.intake.status().recent[0].error, /different workspace/);
  assert.equal((await f.store.list()).length, 0);
});

test("Linear switch persists, ignores signed deliveries while off, and preserves ordinary task creation", async (t) => {
  const f = await setup(t);
  const url = `${f.apiUrl}/api/integrations/linear`;
  const put = (enabled, csrf = "csrf-test") =>
    fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-agent-harness-csrf": csrf },
      body: JSON.stringify({ enabled }),
    });
  assert.equal((await put(false, "incorrect")).status, 403);
  assert.equal((await put("false")).status, 400);
  f.intake.accept(event("previously-queued"));
  assert.equal((await put(false)).status, 200);
  assert.equal((await (await fetch(url)).json()).enabled, false);
  const ignored = await fetch(`${f.webhookUrl}/linear/webhook`, signed(event("while-off")));
  assert.equal(ignored.status, 200);
  assert.equal((await ignored.json()).accepted, false);
  await f.intake.drain();
  assert.equal(f.calls.length, 0);
  assert.equal((await f.store.list()).length, 0);
  assert.equal(f.intake.status().recent.length, 1);
  const reopened = new LinearIntake({ store: f.store, client: f.client, config: f.config });
  assert.equal(reopened.status().enabled, false);
  await reopened.stop();
  const input = linearTaskInput(issue, event(), f.project);
  const created = await fetch(`${f.apiUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-harness-csrf": "csrf-test" },
    body: JSON.stringify(input),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const ordinary = (await created.json()).task;
  assert.equal(ordinary.externalSource, null);
  assert.equal(ordinary.status, "queued");
  assert.equal(ordinary.runs.length, 0);
  const beforeEnable = await f.store.get(ordinary.id);
  assert.equal((await put(true)).status, 200);
  await f.intake.drain();
  assert.equal(f.intake.status().recent[0].status, "completed");
  assert.equal((await f.store.list()).length, 2);
  assert.deepEqual(await f.store.get(ordinary.id), beforeEnable);
});

test("Off waits for an in-flight receipt, then leaves later receipts queued without more network work", async (t) => {
  const f = await setup(t);
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  f.client.identity = async () => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return config;
  };
  f.intake.accept(event("first"));
  f.intake.accept(event("second"));
  f.intake.kick();
  await started;
  let confirmed = false;
  const off = f.intake.setEnabled(false).then(() => {
    confirmed = true;
  });
  await assert.rejects(f.intake.setEnabled(true), /still completing/);
  assert.equal(confirmed, false);
  assert.equal(f.intake.accept(event("during-disable")).accepted, false);
  release();
  await off;
  assert.equal(confirmed, true);
  const states = Object.fromEntries(f.intake.status().recent.map((row) => [row.sessionId, row.status]));
  assert.equal(states.first, "completed");
  assert.equal(states.second, "queued");
  const calls = f.calls.length;
  await f.intake.drain();
  assert.equal(f.calls.length, calls);
});
