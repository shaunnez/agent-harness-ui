import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { GitWorktreeManager } from "../server/git-worktree.mjs";
import { createApiServer } from "../server/api.mjs";
import { TaskOrchestrator } from "../server/orchestrator.mjs";
import { RepositoryAuthorityService } from "../server/repository-authority.mjs";
import { JsonTaskStore } from "../server/store.mjs";
import { parseWorkPackages } from "../server/structured-output.mjs";

const exec = promisify(execFile);

async function git(cwd, ...args) {
  return (await exec("git", args, { cwd, windowsHide: true })).stdout.trim();
}

async function createRemoteFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-harness-authority-"));
  const remote = path.join(root, "remote.git");
  const operator = path.join(root, "operator");
  const pusher = path.join(root, "pusher");
  await mkdir(operator);
  await git(root, "init", "--bare", remote);
  await git(operator, "init", "-b", "main");
  await git(operator, "config", "user.name", "Harness Test");
  await git(operator, "config", "user.email", "harness@example.test");
  await mkdir(path.join(operator, ".agent-harness"));
  await writeFile(path.join(operator, "feature.txt"), "initial\n");
  await writeFile(
    path.join(operator, ".agent-harness", "verification.json"),
    `${JSON.stringify({ version: 1, commands: [{ id: "test", command: ["node", "--version"] }] })}\n`,
  );
  await git(operator, "add", "feature.txt", ".agent-harness/verification.json");
  await git(operator, "commit", "-m", "initial");
  const initial = await git(operator, "rev-parse", "HEAD");
  await git(operator, "remote", "add", "origin", remote);
  await git(operator, "push", "-u", "origin", "main");
  await git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  await git(root, "clone", remote, pusher);
  await git(pusher, "config", "user.name", "Harness Test");
  await git(pusher, "config", "user.email", "harness@example.test");
  return { root, remote, operator, pusher, initial };
}

async function advanceRemote(fixture, content) {
  await writeFile(path.join(fixture.pusher, "feature.txt"), content);
  await git(fixture.pusher, "add", "feature.txt");
  await git(fixture.pusher, "commit", "-m", content.trim());
  await git(fixture.pusher, "push", "origin", "main");
  return git(fixture.pusher, "rev-parse", "HEAD");
}

function planBinding(authority, artifactId) {
  return {
    disposition: "changes-required",
    evidence: [],
    changesRemainNecessary: true,
    artifactId,
    repositoryAuthorityId: authority.id,
    repositoryRevision: authority.selectedRevision,
    repositoryTargetRef: authority.targetRef,
    repositoryAuthorityCheckedAt: authority.capturedAt,
    createdAt: authority.capturedAt,
  };
}

test("task creation persists the fetched target revision", async () => {
  const fixture = await createRemoteFixture();
  let server;
  try {
    const advanced = await advanceRemote(fixture, "advanced before task creation\n");
    const store = new JsonTaskStore(path.join(fixture.root, "tasks.json"));
    await store.init();
    server = createApiServer({
      store,
      orchestrator: {},
      suggestedRepository: fixture.operator,
      csrfToken: "authority-test-token",
      repositoryAuthorityService: new RepositoryAuthorityService(),
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}/api/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-harness-csrf": "authority-test-token",
      },
      body: JSON.stringify({
        title: "Captured at creation",
        description: "Bind investigation to the fetched target.",
        repositoryPath: fixture.operator,
        workflow: "implement",
        priority: "medium",
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 201, body.error);
    const created = body.task;
    assert.equal(created.repositoryAuthority.selectedRevision, advanced);
    assert.equal(created.repositoryAuthority.source, "tracked-upstream");
    assert.equal(created.repositoryAuthorityStatus, "bound");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("captures fetched target authority and reads it from a detached worktree without touching dirty files", async () => {
  const fixture = await createRemoteFixture();
  try {
    const dirtyBytes = Buffer.from("operator-only dirty bytes\n\0retained", "utf8");
    await writeFile(path.join(fixture.operator, "feature.txt"), dirtyBytes);
    await writeFile(path.join(fixture.operator, "untracked.txt"), "operator untracked\n");
    const advanced = await advanceRemote(fixture, "remote advance\n");
    const authority = await new RepositoryAuthorityService().capture(fixture.operator);

    assert.equal(authority.source, "tracked-upstream");
    assert.equal(authority.selectedRevision, advanced);
    assert.equal(authority.localHead, fixture.initial);
    assert.equal(authority.checkoutDirty, true);
    assert.equal(authority.relationship, "behind");
    assert.deepEqual(await readFile(path.join(fixture.operator, "feature.txt")), dirtyBytes);
    assert.equal(await git(fixture.operator, "rev-parse", "HEAD"), fixture.initial);

    const manager = new GitWorktreeManager(path.join(fixture.root, "worktrees"));
    const workspace = await manager.prepareEvidence(
      { id: "AH-001", repositoryPath: fixture.operator },
      authority,
      "capture-test",
    );
    assert.equal(await git(workspace.worktreePath, "rev-parse", "HEAD"), advanced);
    assert.equal(
      await readFile(path.join(workspace.worktreePath, "feature.txt"), "utf8"),
      "remote advance\n",
    );
    assert.equal(
      await readFile(path.join(workspace.worktreePath, "untracked.txt"), "utf8").catch(() => null),
      null,
    );
    await manager.removeEvidence(workspace);

    await git(fixture.operator, "remote", "set-url", "origin", path.join(fixture.root, "missing.git"));
    const frozen = await new RepositoryAuthorityService().capture(fixture.operator, {
      frozenRevision: fixture.initial,
    });
    assert.equal(frozen.source, "frozen-experiment");
    assert.equal(frozen.selectedRevision, fixture.initial);
    assert.equal(frozen.remoteVerification.status, "not-applicable");
    assert.deepEqual(await readFile(path.join(fixture.operator, "feature.txt")), dirtyBytes);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("stale plans fail approval and implementation before attempts, then revalidate at the new revision", async () => {
  const fixture = await createRemoteFixture();
  try {
    const authorityService = new RepositoryAuthorityService();
    const initialAuthority = await authorityService.capture(fixture.operator);
    const store = new JsonTaskStore(path.join(fixture.root, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Revision-bound change",
      description: "Change the feature only after a fresh plan.",
      repositoryPath: fixture.operator,
      repositoryAuthority: initialAuthority,
      workflow: "implement",
      priority: "medium",
    });
    const planArtifactId = crypto.randomUUID();
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-plan-approval";
      draft.currentStage = "plan";
      draft.completedStages = ["triage", "scouts", "grill", "specification", "plan"];
      draft.artifacts.push({
        id: planArtifactId,
        runId: null,
        stage: "plan",
        name: "implementation-plan.md",
        kind: "markdown",
        content: "# Original plan",
        createdAt: initialAuthority.capturedAt,
        model: "gpt-5.6-sol",
        reasoning: "high",
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
        repositoryAuthorityId: initialAuthority.id,
        repositoryRevision: initialAuthority.selectedRevision,
        repositoryTargetRef: initialAuthority.targetRef,
        repositoryAuthorityCheckedAt: initialAuthority.capturedAt,
      });
      draft.workPackages = parseWorkPackages(
        '<work-packages>{"packages":[{"id":"S1","title":"Feature","description":"Update the feature.","dependencies":[],"ownedPaths":["feature.txt"],"verificationCommandIds":["test"]}]}</work-packages>',
      );
      draft.planResult = planBinding(initialAuthority, planArtifactId);
    });
    const advanced = await advanceRemote(fixture, "advanced after plan\n");
    const manager = new GitWorktreeManager(path.join(fixture.root, "worktrees"));
    const orchestrator = new TaskOrchestrator(store, {
      repositoryAuthorityService: authorityService,
      worktreeManager: manager,
      readVerificationManifest: async () => ({
        version: 1,
        commands: [{ id: "test", command: ["node", "--version"] }],
      }),
      runCodex: async () => ({
        finalText:
          '<work-packages>{"disposition":"changes-required","evidence":[],"packages":[{"id":"S1","title":"Feature","description":"Update the feature at the new revision.","dependencies":[],"ownedPaths":["feature.txt"],"verificationCommandIds":["test"]}]}</work-packages>',
        usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, totalTokens: 2 },
      }),
    });

    await assert.rejects(orchestrator.approvePlan(task.id), /Revalidate the retained plan/i);
    let blocked = await store.get(task.id);
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.blocker.code, "stale-plan");
    assert.equal(blocked.blocker.currentRevision, advanced);
    assert.equal(blocked.attemptsByStage.implement ?? 0, 0);
    assert.equal(blocked.candidates.length, 0);

    assert.deepEqual(await orchestrator.revalidatePlan(task.id), { started: true });
    for (let count = 0; count < 200; count += 1) {
      const current = await store.get(task.id);
      if (current.status === "awaiting-plan-approval") break;
      if (current.status === "failed") assert.fail(current.error);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const revalidated = await store.get(task.id);
    assert.equal(revalidated.status, "awaiting-plan-approval");
    assert.equal(revalidated.planResult.repositoryRevision, advanced);
    assert.equal(revalidated.artifacts.filter((artifact) => artifact.stage === "plan").length, 2);
    assert.equal(revalidated.planRevalidation.priorArtifactId, planArtifactId);
    assert.ok(revalidated.planRevalidation.replacementArtifactId);
    const replacementArtifact = revalidated.artifacts.find(
      (artifact) => artifact.id === revalidated.planRevalidation.replacementArtifactId,
    );
    assert.equal(replacementArtifact.repositoryRevision, advanced);
    assert.equal(replacementArtifact.contextManifest.repositoryRevision, advanced);

    await orchestrator.approvePlan(task.id);
    const secondAdvance = await advanceRemote(fixture, "advanced before implementation\n");
    await assert.rejects(
      orchestrator.start(task.id, "implementation"),
      /Revalidate the retained plan before implementation/i,
    );
    blocked = await store.get(task.id);
    assert.equal(blocked.blocker.currentRevision, secondAdvance);
    assert.equal(blocked.attemptsByStage.implement ?? 0, 0);
    assert.equal(blocked.candidates.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("already-satisfied evidence creates no candidate and only a human closure completes the task", async () => {
  const fixture = await createRemoteFixture();
  try {
    const authorityService = new RepositoryAuthorityService();
    const authority = await authorityService.capture(fixture.operator);
    const store = new JsonTaskStore(path.join(fixture.root, "tasks.json"));
    await store.init();
    const task = await store.create({
      title: "Already implemented",
      description: "Confirm the committed feature.",
      repositoryPath: fixture.operator,
      repositoryAuthority: authority,
      workflow: "implement",
      priority: "low",
    });
    await store.update(task.id, (draft) => {
      draft.status = "awaiting-already-satisfied";
      draft.currentStage = "plan";
      draft.workPackages = [];
      draft.planResult = {
        ...planBinding(authority, "plan-evidence"),
        disposition: "already-satisfied",
        changesRemainNecessary: false,
        evidence: [{ path: "feature.txt", detail: "The committed file already contains the outcome." }],
      };
    });
    const orchestrator = new TaskOrchestrator(store, { repositoryAuthorityService: authorityService });
    assert.equal(await orchestrator.start(task.id, "implementation"), false);
    assert.equal((await store.get(task.id)).status, "awaiting-already-satisfied");
    assert.equal((await store.get(task.id)).candidates.length, 0);
    await orchestrator.closeAlreadySatisfied(task.id, "Evidence reviewed by operator.");
    const closed = await store.get(task.id);
    assert.equal(closed.status, "closed");
    assert.equal(closed.closure.reason, "already-satisfied");
    assert.equal(closed.closure.source, "operator");
    assert.equal(closed.candidates.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
