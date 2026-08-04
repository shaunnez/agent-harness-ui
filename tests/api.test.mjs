import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { GitWorktreeManager } from "../server/git-worktree.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { parseFocusedTestEvidence } from "../server/structured-output.mjs";
import { attachRunArtifact, refreshGateFreshness, RUNTIME_FRESHNESS_REASONS } from "../server/run-activity.mjs";
import { formatApprovalStage, formatApprovalTimestamp, getApprovalHistory } from "../src/components/runtimeApprovalHistory.js";
import { promisify } from "node:util";

const exec = promisify(execFile);
const TEST_CSRF_TOKEN = "test-csrf-token";
const nativeFetch = globalThis.fetch;

function fetch(input, init = {}) {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    if (!headers.has("x-agent-harness-csrf")) headers.set("x-agent-harness-csrf", TEST_CSRF_TOKEN);
  }
  return nativeFetch(input, { ...init, headers });
}

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
  const server = createApiServer({ store, orchestrator, suggestedRepository: directory, csrfToken: TEST_CSRF_TOKEN });
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

async function git(cwd, args) {
  return exec("git", args, { cwd, windowsHide: true });
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

test("returns backward-compatible structured run activity through task APIs", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Structured run API",
      description: "Expose only telemetry retained from the runtime.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.runs.push({
        id: "RUN-API",
        kind: "agent",
        status: "completed",
        stage: "triage",
        role: "triage",
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        startedAt: "2026-08-03T00:00:00.000Z",
        completedAt: "2026-08-03T00:00:01.000Z",
        durationMs: 1_000,
        artifactId: null,
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2, totalTokens: 12, credits: 0.1, cost: 0.001 },
        credits: 0.1,
        apiEstimate: 0.001,
        candidateId: null,
        candidateRevision: null,
        workPackageId: null,
        attempt: 1,
        retryOfRunId: null,
        repairOfRunId: null,
        toolCalls: [{ id: "cmd-api", name: "command_execution", category: "repository-command", phase: "completed", result: "Exit code 0" }],
        test: null,
        gateResult: null,
        error: null,
        source: "codex-jsonl",
      });
      draft.events.push({
        id: "event-api",
        at: "2026-08-03T00:00:01.000Z",
        category: "tool",
        tone: "success",
        stage: "triage",
        title: "Repository command completed",
        detail: "git status --short",
        runId: "RUN-API",
        toolCall: draft.runs[0].toolCalls[0],
      });
    });

    const detail = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    const list = await (await fetch(`${origin}/api/tasks`)).json();
    const health = await (await fetch(`${origin}/api/health`)).json();
    assert.equal(health.runtimeSchemaVersion, 5);
    assert.equal(detail.task.runs[0].id, "RUN-API");
    assert.equal(detail.task.runs[0].toolCalls[0].result, "Exit code 0");
    assert.equal(detail.task.events.at(-1).runId, "RUN-API");
    assert.equal(list.tasks[0].runs[0].apiEstimate, 0.001);
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
      headers: { "content-type": "application/json", "x-agent-harness-csrf": TEST_CSRF_TOKEN, origin: "https://hostile.example" },
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
      headers: { host: "hostile.example", "content-type": "application/json", "x-agent-harness-csrf": TEST_CSRF_TOKEN },
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
      ["POST", "/api/tasks/AH-999/cancel"],
      ["POST", "/api/tasks/AH-999/approve-merge"],
    ];
    for (const [method, target] of mutationTargets) {
      const hostile = await nativeFetch(`${origin}${target}`, {
        method,
        headers: { origin: "https://hostile.example", "content-type": "application/json", "x-agent-harness-csrf": TEST_CSRF_TOKEN },
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
      draft.usage = { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, totalTokens: 120, cost: 0.01, credits: 0.5 };
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
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 2, totalTokens: 12, cost: 0.001, credits: 0.05 },
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
      body: JSON.stringify({ score: 4, outcome: "accepted", rubric: { correctness: 5, maintainability: 3 }, notes: "Human review" }),
    });
    assert.equal(humanResponse.status, 200);
    const blindResponse = await fetch(`${origin}/api/tasks/${task.id}/evaluation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "blind", score: 5, outcome: "accepted", rubric: { overall: 5 }, notes: "Locked blind review" }),
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
      attachments: [{ name: "reference.html", type: "text/html", size: Buffer.byteLength(content), data: Buffer.from(content).toString("base64") }],
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

test("returns live changelog commits, changed files, and a selected file diff", async () => {
  const { directory, origin, server } = await createServer();
  try {
    await exec("git", ["init", "-b", "main"], { cwd: directory });
    await exec("git", ["config", "user.name", "Harness Test"], { cwd: directory });
    await exec("git", ["config", "user.email", "harness@example.test"], { cwd: directory });
    const tracked = path.join(directory, "CHANGELOG_TEST.txt");
    await writeFile(tracked, "first\n", "utf8");
    await exec("git", ["add", "CHANGELOG_TEST.txt"], { cwd: directory });
    await exec("git", ["commit", "-m", "first changelog commit"], { cwd: directory });
    await writeFile(tracked, "first\nsecond\n", "utf8");
    await exec("git", ["add", "CHANGELOG_TEST.txt"], { cwd: directory });
    await exec("git", ["commit", "-m", "second changelog commit"], { cwd: directory });

    const commitsResponse = await fetch(`${origin}/api/changelog`);
    assert.equal(commitsResponse.status, 200);
    const commits = (await commitsResponse.json()).commits;
    assert.equal(commits.length, 2);
    assert.equal(commits[0].subject, "second changelog commit");

    const detailResponse = await fetch(`${origin}/api/changelog/${commits[0].sha}`);
    assert.equal(detailResponse.status, 200);
    const commit = (await detailResponse.json()).commit;
    assert.equal(commit.files[0].path, "CHANGELOG_TEST.txt");

    const diffResponse = await fetch(`${origin}/api/changelog/${commits[0].sha}/file?path=${encodeURIComponent("CHANGELOG_TEST.txt")}`);
    assert.equal(diffResponse.status, 200);
    const diff = await diffResponse.json();
    assert.match(diff.diff, /\+second/);
  } finally {
    await cleanup(server, directory);
  }
});

test("persists an allowed Sol model policy and snapshots it on new tasks", async () => {
  const { directory, origin, server } = await createServer();
  try {
    const settingsResponse = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedModels: ["gpt-5.6-sol", "gpt-5.6-luna"],
        defaultModel: "gpt-5.6-sol",
        defaultReasoning: "xhigh",
      }),
    });
    assert.equal(settingsResponse.status, 200);
    const settings = (await settingsResponse.json()).settings;
    assert.equal(settings.defaultModel, "gpt-5.6-sol");
    assert.equal(settings.defaultReasoning, "xhigh");

    const createResponse = await createTask(origin, {
      title: "Sol task",
      description: "Use the selected model policy.",
      repositoryPath: directory,
      workflow: "investigate",
      priority: "medium",
      model: "gpt-5.6-sol",
      reasoning: "xhigh",
    });
    assert.equal(createResponse.status, 201);
    const task = (await createResponse.json()).task;
    assert.equal(task.agentConfig.model, "gpt-5.6-sol");
    assert.equal(task.agentConfig.reasoning, "xhigh");
    assert.equal(task.agentConfig.stagePolicies.plan.model, "gpt-5.6-sol");
    assert.equal(task.agentConfig.stagePolicies.test.reasoning, "xhigh");
    assert.equal(task.models[0].model, "gpt-5.6-sol");
  } finally {
    await cleanup(server, directory);
  }
});

test("rejects a task model outside the configured allowlist", async () => {
  const { directory, origin, server } = await createServer();
  try {
    await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedModels: ["gpt-5.6-luna"],
        defaultModel: "gpt-5.6-luna",
        defaultReasoning: "medium",
      }),
    });
    const response = await createTask(origin, {
      title: "Disallowed model",
      description: "This should not run with Sol.",
      repositoryPath: directory,
      workflow: "investigate",
      model: "gpt-5.6-sol",
      reasoning: "xhigh",
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /allowed runtime list/i);
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

test("returns persisted focused test evidence without dropping the Markdown artifact", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Focused test payload",
      description: "Return structured test evidence.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-final-review";
      draft.currentStage = "test";
      draft.artifacts.push({
        id: "artifact-1",
        stage: "test",
        name: "test-c1-r2.md",
        kind: "markdown",
        content:
          "PASS\n\n<focused-test-evidence>\n{\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"rows\":[{\"id\":\"row-1\",\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"title\":\"runtime.test.mjs\",\"artifactReferences\":[{\"name\":\"Markdown test artifact\",\"kind\":\"markdown\",\"path\":\"artifacts/test.md\"}],\"assertions\":[{\"label\":\"workspace renders the test artifact\",\"actual\":\"present\",\"expected\":\"present\"}],\"failureDetails\":null}]}\n</focused-test-evidence>",
        createdAt: "2026-08-01T12:00:00.000Z",
        model: "GPT-5.4-mini",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        candidateId: "C1",
        candidateRevision: 2,
        focusedTest: parseFocusedTestEvidence(
          "PASS\n\n<focused-test-evidence>\n{\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"rows\":[{\"id\":\"row-1\",\"candidateId\":\"C1\",\"candidateRevision\":2,\"command\":\"npm.cmd run test:runtime\",\"status\":\"passed\",\"durationMs\":900,\"title\":\"runtime.test.mjs\",\"artifactReferences\":[{\"name\":\"Markdown test artifact\",\"kind\":\"markdown\",\"path\":\"artifacts/test.md\"}],\"assertions\":[{\"label\":\"workspace renders the test artifact\",\"actual\":\"present\",\"expected\":\"present\"}],\"failureDetails\":null}]}\n</focused-test-evidence>",
        ),
      });
    });

    const fetched = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    assert.equal(fetched.task.artifacts[0].kind, "markdown");
    assert.equal(fetched.task.artifacts[0].focusedTest.candidateId, "C1");
    assert.equal(fetched.task.artifacts[0].focusedTest.rows[0].candidateRevision, 2);
    assert.equal(fetched.task.artifacts[0].focusedTest.rows[0].artifactReferences[0].kind, "markdown");
  } finally {
    await cleanup(server, directory);
  }
});

test("serializes the authoritative freshness projection, stale reason, run status, and Markdown audit artifact", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Freshness projection payload",
      description: "Expose exact candidate-bound gate state.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.candidates.push({
        id: "C1",
        revisionNumber: 2,
        baseRevision: "a".repeat(40),
        baseBranch: "main",
        headRevision: "b".repeat(40),
        status: "ready_for_review",
        revisions: [],
      });
      draft.artifacts.push({
        id: "ART-DEV",
        stage: "dev-review",
        kind: "markdown",
        name: "dev-review-c1-r2.md",
        content: "# retained review evidence\n\nPASS",
        createdAt: "2026-08-03T00:01:00.000Z",
        candidateId: "C1",
        candidateRevision: 2,
        gateResult: {
          schemaVersion: 1,
          stage: "dev-review",
          verdict: "PASS",
          reportedVerdict: "PASS",
          candidateId: "C1",
          candidateRevision: 2,
          evaluatedAt: "2026-08-03T00:01:00.000Z",
          blockingReasons: [],
          findings: [],
        },
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      });
      draft.runs.push({
        id: "RUN-DEV",
        kind: "review",
        status: "completed",
        stage: "dev-review",
        role: "dev-review",
        model: "gpt-5.6-luna",
        reasoning: "xhigh",
        startedAt: "2026-08-03T00:00:00.000Z",
        completedAt: "2026-08-03T00:01:00.000Z",
        durationMs: 60_000,
        artifactId: "ART-DEV",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        credits: null,
        apiEstimate: null,
        candidateId: "C1",
        candidateRevision: 2,
        workPackageId: null,
        attempt: 1,
        retryOfRunId: null,
        repairOfRunId: null,
        toolCalls: [],
        test: null,
        gateResult: null,
        evidenceError: null,
        freshness: null,
        error: null,
        source: "codex-jsonl",
      });
      draft.events.push({ id: "EVENT-DEV", runId: "RUN-DEV", category: "agent", tone: "success", stage: "dev-review", title: "Review complete", detail: "PASS" });
      attachRunArtifact(draft, "RUN-DEV", draft.artifacts[0]);
      refreshGateFreshness(draft);
    });

    const fetched = await (await fetch(`${origin}/api/tasks/${task.id}`)).json();
    const freshness = fetched.task.gateFreshness["dev-review"];
    assert.equal(freshness.fresh, true);
    assert.deepEqual(freshness.target, { candidateId: "C1", candidateRevision: 2 });
    assert.equal(freshness.sourceRunId, "RUN-DEV");
    assert.equal(fetched.task.runs[0].status, "completed");
    assert.equal(fetched.task.runs[0].freshness.reasonCode, "fresh");
    assert.equal(fetched.task.events.at(-1).freshness.reasonCopy, RUNTIME_FRESHNESS_REASONS.fresh);
    assert.equal(fetched.task.artifacts[0].content, "# retained review evidence\n\nPASS");
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

test("returns the current candidate diff only after verifying the recorded worktree and head revision", async () => {
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-repo-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Inspect diff",
      description: "Return the current candidate diff.",
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

    const response = await fetch(`${origin}/api/tasks/${task.id}/candidates/C1/diff`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.candidateId, "C1");
    assert.equal(payload.revisionNumber, 1);
    assert.equal(payload.headRevision, committed.headRevision);
    assert.equal(payload.worktreePath, candidate.worktreePath);
    assert.match(payload.diff, /feature\.txt/);
    assert.equal(payload.truncated, false);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
  }
});

test("returns a read-only worktree inventory with slice and candidate rows", async () => {
  const { directory, origin, server, store } = await createServer();
  const sliceRepository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-inventory-slice-"));
  const candidateRepository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-inventory-candidate-"));
  try {
    for (const repository of [sliceRepository, candidateRepository]) {
      await git(repository, ["init"]);
      await git(repository, ["config", "user.name", "Agent Harness Test"]);
      await git(repository, ["config", "user.email", "agent-harness@example.test"]);
      await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
      await git(repository, ["add", "README.md"]);
      await git(repository, ["commit", "-m", "base"]);
    }

    const sliceTask = await store.create({
      title: "Inventory rows",
      description: "Expose retained harness worktrees.",
      repositoryPath: sliceRepository,
      workflow: "implement",
      priority: "medium",
    });
    const sliceManager = new GitWorktreeManager(path.join(sliceRepository, ".data", "worktrees"));
    const sliceBase = await sliceManager.base(sliceTask);
    const slice = await sliceManager.prepare(sliceTask, "S1", { baseRevision: sliceBase.baseRevision, branchId: "slice-1" });
    await writeFile(path.join(slice.worktreePath, "slice.txt"), "slice\n", "utf8");
    const sliceCommitted = await sliceManager.commit(slice, "slice worktree");

    const candidateTask = await store.create({
      title: "Inventory candidate",
      description: "Expose retained candidate worktrees.",
      repositoryPath: candidateRepository,
      workflow: "implement",
      priority: "medium",
    });
    const candidateManager = new GitWorktreeManager(path.join(candidateRepository, ".data", "worktrees"));
    const candidateBase = await candidateManager.base(candidateTask);
    const candidate = await candidateManager.prepare(candidateTask, "C1", { baseRevision: candidateBase.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "candidate.txt"), "candidate\n", "utf8");
    const candidateCommitted = await candidateManager.commit(candidate, "candidate worktree");

    await store.update(sliceTask.id, (draft) => {
      draft.workPackages.push({
        id: "S1",
        batch: 1,
        title: "Read-only inventory contract",
        description: "Backend inventory projection.",
        status: "retained",
        attempts: 1,
        dependencies: [],
        ownedPaths: ["server/git-worktree.mjs", "server/api.mjs", "tests/api.test.mjs"],
        worktreePath: slice.worktreePath,
        branch: slice.branch,
        baseRevision: slice.baseRevision,
        headRevision: sliceCommitted.headRevision,
      });
    });
    await store.update(candidateTask.id, (draft) => {
      draft.candidates.push({
        ...candidate,
        headRevision: candidateCommitted.headRevision,
        status: "ready_for_review",
      });
    });

    const response = await fetch(`${origin}/api/runtime/worktrees`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.rows.length, 2);
    const sliceRow = payload.rows.find((row) => row.kind === "slice");
    const candidateRow = payload.rows.find((row) => row.kind === "candidate");
    assert.equal(sliceRow.id, `slice:${sliceTask.id}:S1`);
    assert.equal(sliceRow.label, "S1 slice");
    assert.equal(sliceRow.taskId, sliceTask.id);
    assert.equal(sliceRow.workPackageId, "S1");
    assert.equal(sliceRow.currentState, "retained");
    assert.equal(sliceRow.cleanupReady, true);
    assert.equal(sliceRow.gitExists, true);
    assert.equal(sliceRow.gitClean, true);
    assert.equal(candidateRow.id, `candidate:${candidateTask.id}:C1`);
    assert.equal(candidateRow.label, "C1 candidate");
    assert.equal(candidateRow.taskId, candidateTask.id);
    assert.equal(candidateRow.workPackageId, "C1");
    assert.equal(candidateRow.currentState, "retained");
    assert.equal(candidateRow.recordedHeadRevision, candidateCommitted.headRevision);
    assert.equal(candidateRow.gitHeadRevision, candidateCommitted.headRevision);
  } finally {
    await cleanup(server, directory);
    await rm(sliceRepository, { recursive: true, force: true });
    await rm(candidateRepository, { recursive: true, force: true });
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
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), `${"x".repeat(1000)}\n`.repeat(400), "utf8");
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

test("grants one bounded repair attempt when review exhausts the allowance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exhausted review repair",
      description: "Recover a repair-required candidate after the review allowance is exhausted.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimit;
      draft.candidates.push({ id: "C1", status: "repair_required" });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.status, "failed");
    assert.equal(updated.stageRunLimit, 4);
    assert.equal(updated.attemptsByStage["dev-review"], 3);
    assert.equal(updated.candidates.at(-1).status, "repair_required");
    assert.equal(updated.events.at(-1).title, "One repair attempt granted");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants one bounded stage attempt to a repaired candidate at an exhausted ready gate", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exhausted ready gate",
      description: "Allow a repaired candidate to re-enter review after its prior review allowance was exhausted.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "ready-for-review";
      draft.currentStage = "dev-review";
      draft.attemptsByStage["dev-review"] = draft.stageRunLimit;
      draft.candidates.push({ id: "C1", status: "ready_for_review" });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    assert.deepEqual(await grantResponse.json(), { granted: true });

    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.status, "failed");
    assert.equal(updated.stageRunLimit, 4);
    assert.equal(updated.candidates.at(-1).status, "ready_for_review");
    assert.equal(updated.events.at(-1).title, "One stage attempt granted");
  } finally {
    await cleanup(server, directory);
  }
});

test("grants a usable slot when a failed repair already exceeded the allowance", async () => {
  const { directory, origin, server, store } = await createServer();
  try {
    const response = await createTask(origin, {
      title: "Exceeded repair allowance",
      description: "Guarantee one usable slot after a failed repair crosses the prior limit.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await response.json();
    await store.update(task.id, (draft) => {
      draft.status = "failed";
      draft.currentStage = "implement";
      draft.attemptsByStage.implement = draft.stageRunLimit + 1;
      draft.candidates.push({ id: "C1", status: "repair_required" });
    });

    const grantResponse = await fetch(`${origin}/api/tasks/${task.id}/grant-retry`, { method: "POST" });
    assert.equal(grantResponse.status, 200);
    const updated = (await (await fetch(`${origin}/api/tasks/${task.id}`)).json()).task;
    assert.equal(updated.stageRunLimit, updated.attemptsByStage.implement + 1);
    assert.equal(updated.status, "failed");
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

function rawHttpRequest(origin, pathname, { method, headers, body }) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: url.port, path: pathname, method, headers }, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode }));
    });
    request.on("error", reject);
    request.end(body);
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
