import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const [repository, output] = process.argv.slice(2);
if (!repository || !output) throw new Error("Usage: h06.mjs <candidate-checkout> <new-output-directory>");
if (!process.env.EVAL_PLAYWRIGHT_MODULE) throw new Error("EVAL_PLAYWRIGHT_MODULE is required.");
await mkdir(output);
const candidate = path.resolve(repository);
const fromCandidate = (name) => import(pathToFileURL(path.join(candidate, name)).href);
const [{ createApiServer }, { LinearIntake }, { createLinearWebhookServer }, { LinearWorkflow }, { SqliteTaskStore }, { TaskControlOrchestrator }] =
  await Promise.all([
    fromCandidate("server/api.mjs"),
    fromCandidate("server/integrations/linear-intake.mjs"),
    fromCandidate("server/integrations/linear-webhook.mjs"),
    fromCandidate("server/integrations/linear-workflow.mjs"),
    fromCandidate("server/sqlite-store.mjs"),
    fromCandidate("server/orchestrator-task-control.mjs"),
  ]);
const exec = promisify(execFile);
const checks = [];
async function check(id, run) {
  try {
    await run();
    checks.push({ id, passed: true });
  } catch (error) {
    checks.push({ id, passed: false, detail: String(error?.message ?? error) });
  }
}
const config = {
  organizationId: "qualification-org",
  appUserId: "qualification-app",
  clientId: "qualification-client",
  harnessUrl: "http://127.0.0.1:5199/",
  projectMappings: {},
};
const issue = {
  id: "qualification-issue",
  identifier: "QUAL-1",
  title: "Synthetic issue",
  description: "No customer data",
  project: { id: "qualification-project", name: "Fixture" },
};
function event(id) {
  return {
    type: "AgentSessionEvent",
    action: "created",
    organizationId: config.organizationId,
    appUserId: config.appUserId,
    oauthClientId: config.clientId,
    webhookTimestamp: Date.now(),
    agentSession: {
      id,
      issue,
      issueId: issue.id,
      organizationId: config.organizationId,
      appUserId: config.appUserId,
      comment: { id: `comment-${id}`, userId: "fixture-human", body: "@Harness import" },
    },
  };
}
async function fixture({ configured = true, withWebhook = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "h06-independent-"));
  await exec("git", ["init", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.name", "Qualification"]);
  await exec("git", ["-C", root, "config", "user.email", "qualification@example.invalid"]);
  await writeFile(path.join(root, "README.md"), "synthetic\n");
  await exec("git", ["-C", root, "add", "README.md"]);
  await exec("git", ["-C", root, "commit", "-m", "synthetic"]);
  const store = new SqliteTaskStore(path.join(root, "tasks.sqlite3"));
  await store.init();
  const project = await store.createProject({ name: "Qualification project", repositoryPath: root });
  const mapped = { ...config, projectMappings: { [issue.project.id]: project.id } };
  const calls = [];
  const client = {
    identity: async () => mapped,
    issue: async () => structuredClone(issue),
    linkSession: async () => calls.push("link"),
    completeSession: async () => calls.push("complete"),
    publishActivity: async () => calls.push("publish"),
  };
  const intake = configured ? new LinearIntake({ store, client, config: mapped }) : null;
  const api = createApiServer({ store, linearIntake: intake, csrfToken: "qualification-csrf" });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const webhook = withWebhook ? createLinearWebhookServer({ intake, signingSecret: "qualification-secret" }) : null;
  if (webhook) await new Promise((resolve) => webhook.listen(0, "127.0.0.1", resolve));
  const close = async () => {
    await intake?.stop();
    if (webhook) await new Promise((resolve) => webhook.close(resolve));
    await new Promise((resolve) => api.close(resolve));
    store.close();
    await rm(root, { recursive: true, force: true });
  };
  return {
    root,
    store,
    mapped,
    calls,
    client,
    intake,
    apiUrl: `http://127.0.0.1:${api.address().port}`,
    webhookUrl: webhook ? `http://127.0.0.1:${webhook.address().port}` : null,
    close,
  };
}
const put = (f, enabled, csrf = "qualification-csrf") =>
  fetch(`${f.apiUrl}/api/integrations/linear`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-agent-harness-csrf": csrf },
    body: JSON.stringify({ enabled }),
  });
async function signed(f, payload) {
  const body = JSON.stringify(payload);
  return fetch(`${f.webhookUrl}/linear/webhook`, {
    method: "POST",
    headers: {
      "linear-signature": createHmac("sha256", "qualification-secret").update(body).digest("hex"),
    },
    body,
  });
}

await check("api-persistence-and-boundary", async () => {
  const f = await fixture();
  try {
    const url = `${f.apiUrl}/api/integrations/linear`;
    assert.equal((await (await fetch(url)).json()).enabled, true);
    assert.equal((await put(f, false, "wrong")).status, 403);
    assert.equal((await put(f, "false")).status, 400);
    assert.equal((await put(f, false)).status, 200);
    assert.equal((await (await fetch(url)).json()).enabled, false);
    const restarted = new LinearIntake({ store: f.store, client: f.client, config: f.mapped });
    assert.equal(restarted.status().enabled, false);
    await restarted.stop();
    assert.equal((await put(f, true)).status, 200);
    assert.equal((await (await fetch(url)).json()).enabled, true);
  } finally {
    await f.close();
  }
});

await check("off-pauses-intake-and-on-resumes", async () => {
  const f = await fixture({ withWebhook: true });
  try {
    f.intake.accept(event("queued-before-off"));
    assert.equal((await put(f, false)).status, 200);
    const ignored = await signed(f, event("new-while-off"));
    assert.equal(ignored.status, 200);
    assert.equal((await ignored.json()).accepted, false);
    await f.intake.drain();
    assert.equal(f.calls.length, 0);
    assert.equal((await f.store.list()).length, 0);
    assert.equal(f.intake.status().recent.length, 1);
    assert.equal((await put(f, true)).status, 200);
    await f.intake.drain();
    assert.equal((await f.store.list()).length, 1);
    assert.equal(f.intake.status().recent[0].status, "completed");
  } finally {
    await f.close();
  }
});

await check("off-waits-for-current-receipt", async () => {
  const f = await fixture();
  let release;
  try {
    let enter;
    const entered = new Promise((resolve) => (enter = resolve));
    f.client.identity = async () => {
      enter();
      await new Promise((resolve) => (release = resolve));
      return f.mapped;
    };
    f.intake.accept(event("first"));
    f.intake.accept(event("second"));
    f.intake.kick();
    await Promise.race([entered, new Promise((_, reject) => setTimeout(() => reject(Error("Receipt did not start")), 5000))]);
    let offSettled = false;
    const off = f.intake.setEnabled(false).then(() => (offSettled = true));
    await Promise.resolve();
    assert.equal(offSettled, false);
    assert.equal(f.intake.accept(event("third")).accepted, false);
    release();
    await off;
    const states = Object.fromEntries(f.intake.status().recent.map((row) => [row.sessionId, row.status]));
    assert.equal(states.first, "completed");
    assert.equal(states.second, "queued");
    await f.intake.drain();
    assert.equal(Object.fromEntries(f.intake.status().recent.map((row) => [row.sessionId, row.status])).second, "queued");
  } finally {
    release?.();
    await f.close();
  }
});

await check("off-pauses-publication", async () => {
  const f = await fixture();
  try {
    const task = await f.store.create({
      title: "Synthetic local task",
      description: "No private data",
      repositoryPath: f.root,
      externalSource: {
        provider: "linear",
        organizationId: config.organizationId,
        issueId: issue.id,
        sessionId: "linear-session",
      },
    });
    const workflow = new LinearWorkflow({
      store: f.store,
      client: f.client,
      config: f.mapped,
      orchestrator: {},
      isEnabled: () => f.intake.status().enabled,
    });
    workflow.enqueue(task, "linear-session", "independent-message", { type: "response", body: "Synthetic update" });
    assert.equal((await put(f, false)).status, 200);
    await workflow.drain();
    assert.equal(f.calls.length, 0);
    assert.equal(workflow.status().recent[0].status, "queued");
    const local = await f.store.create({ title: "Still local", description: "Manual work remains available", repositoryPath: f.root });
    assert.equal(local.status, "queued");
    assert.equal((await put(f, true)).status, 200);
    await workflow.drain();
    assert.ok(f.calls.includes("publish"));
  } finally {
    await f.close();
  }
});

await check("off-pauses-linear-replies-but-local-grill-works", async () => {
  const f = await fixture();
  const orchestrator = new TaskControlOrchestrator({ store: f.store, active: new Map(), run: async () => {} });
  try {
    const task = await f.store.create({
      title: "Local Grill control",
      description: "Synthetic task",
      repositoryPath: f.root,
      externalSource: {
        provider: "linear",
        organizationId: config.organizationId,
        issueId: issue.id,
        sessionId: "linear-session",
      },
      grillPolicy: "manual",
    });
    await f.store.update(task.id, (draft) => {
      draft.status = "awaiting-grill";
      draft.currentStage = "grill";
      draft.grillSession = {
        status: "open",
        createdAt: new Date().toISOString(),
        questions: [{
          id: "Q1",
          question: "Choose local option?",
          whyItMatters: "Checks manual access.",
          allowCustom: true,
          answer: null,
          options: [{ label: "Local choice", description: "Synthetic", recommended: true }],
        }],
      };
    });
    const workflow = new LinearWorkflow({
      store: f.store,
      client: f.client,
      config: f.mapped,
      orchestrator,
      isEnabled: () => f.intake.status().enabled,
    });
    assert.equal(workflow.accept({
      type: "AgentSessionEvent",
      action: "prompted",
      agentSession: { id: "linear-session", issueId: issue.id },
      agentActivity: {
        id: "fixture-reply",
        agentSessionId: "linear-session",
        userId: "fixture-human",
        content: { type: "prompt", body: "@Harness answer Q1: Local choice" },
      },
    }), true);
    assert.equal((await put(f, false)).status, 200);
    await workflow.drain();
    assert.equal((await f.store.get(task.id)).grillSession.questions[0].answer, null);
    assert.equal(workflow.status().recent[0].status, "queued");
    await orchestrator.answerGrillQuestion(task.id, {
      source: "operator", questionId: "Q1", answer: "Local choice",
    });
    assert.equal((await f.store.get(task.id)).grillSession.questions[0].answer, "Local choice");
  } finally {
    await orchestrator.shutdown();
    await f.close();
  }
});

await check("unconfigured-fails-closed-and-local-continues", async () => {
  const f = await fixture({ configured: false });
  try {
    const status = await (await fetch(`${f.apiUrl}/api/integrations/linear`)).json();
    assert.equal(status.configured, false);
    assert.equal(status.enabled, false);
    assert.equal((await put(f, true)).status, 409);
    const created = await fetch(`${f.apiUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-harness-csrf": "qualification-csrf" },
      body: JSON.stringify({ title: "Local only", description: "No Linear", repositoryPath: f.root, workflow: "investigate" }),
    });
    assert.equal(created.status, 201, await created.clone().text());
  } finally {
    await f.close();
  }
});

await check("frontier-integrations-control", async () => {
  const contents = `import React from 'react';import {createRoot} from 'react-dom/client';import {WorldSettings} from ${JSON.stringify(path.join(candidate, "src/frontier/views/WorldSettings.tsx"))};import {defaultPreferences} from ${JSON.stringify(path.join(candidate, "src/frontier/app/preferences.ts"))};const gateway={linearIntegration:async()=>({configured:true,enabled:true,changing:false}),setLinearIntegration:async(enabled)=>{window.changes.push(enabled);return {configured:true,enabled,changing:false}}};window.changes=[];createRoot(document.getElementById('root')).render(<WorldSettings preferences={defaultPreferences} onChange={()=>{}} snapshot={{tasks:[],connection:'connected',status:null}} mode="live" onRetry={()=>{}} gateway={gateway} connected={true} busy={false} error={null} command={async(action)=>{await action()}} onExecution={()=>{}} onAddProject={()=>{}}/>);`;
  const bundle = await build({
    stdin: { contents, resolveDir: candidate, loader: "tsx" },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    logLevel: "silent",
  });
  const server = createServer((request, response) => {
    response.setHeader("content-type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? bundle.outputFiles[0].text : '<!doctype html><html><head><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    const { chromium } = await import(pathToFileURL(process.env.EVAL_PLAYWRIGHT_MODULE).href);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Integrations" }).click({ timeout: 3000 });
    const toggle = page.getByRole("checkbox", { name: "Enable Linear integration" });
    await toggle.waitFor();
    assert.equal(await toggle.isChecked(), true);
    await toggle.uncheck();
    assert.equal(await toggle.isChecked(), false);
    assert.deepEqual(await page.evaluate(() => window.changes), [false]);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, "frontier-integrations.png") });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

const result = { caseId: "H06", graderVersion: "h06-v1", repository: candidate, checks, passed: checks.every((entry) => entry.passed), inferenceCalls: 0 };
await writeFile(path.join(output, "checks.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(result));
process.exitCode = result.passed ? 0 : 1;
