import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiServer } from "../server/api.mjs";
import { GitWorktreeManager } from "../server/git-worktree.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { parseFocusedTestEvidence } from "../server/structured-output.mjs";
import { formatApprovalStage, formatApprovalTimestamp, getApprovalHistory } from "../src/components/runtimeApprovalHistory.js";
import { promisify } from "node:util";

const exec = promisify(execFile);

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
    assert.equal(sliceRow.label, "slice");
    assert.equal(sliceRow.taskId, sliceTask.id);
    assert.equal(sliceRow.workPackageId, "S1");
    assert.equal(sliceRow.currentState, "retained");
    assert.equal(sliceRow.cleanupReady, true);
    assert.equal(sliceRow.exists, true);
    assert.equal(sliceRow.clean, true);
    assert.equal(candidateRow.label, "candidate");
    assert.equal(candidateRow.taskId, candidateTask.id);
    assert.equal(candidateRow.workPackageId, "C1");
    assert.equal(candidateRow.currentState, "retained");
    assert.equal(candidateRow.recordedHeadRevision, candidateCommitted.headRevision);
    assert.equal(candidateRow.currentHeadRevision, candidateCommitted.headRevision);
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
    assert.equal(row.exists, false);
    assert.equal(row.cleanupReady, false);
    assert.equal(row.currentHeadRevision, null);
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
