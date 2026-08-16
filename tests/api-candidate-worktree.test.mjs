import test from "node:test";
import {
  assert,
  cleanup,
  createServer,
  createTask,
  defaultWorktreeRoot,
  fetch,
  GitWorktreeManager,
  git,
  mkdtemp,
  os,
  path,
  readFile,
  rm,
  stat,
  writeFile,
} from "./api-test-support.mjs";

test("dispatches candidate refresh and same-candidate Test retry actions", async () => {
  const { directory, origin, server, refreshedCandidateTaskRef, retriedTestTaskRef } = await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Recover a candidate",
      description: "Exercise explicit recovery actions.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await createResponse.json();

    const refreshResponse = await fetch(`${origin}/api/tasks/${task.id}/refresh-candidate`, {
      method: "POST",
    });
    assert.equal(refreshResponse.status, 200);
    assert.equal((await refreshResponse.json()).refreshed, true);
    assert.equal(refreshedCandidateTaskRef(), task.id);

    const retryResponse = await fetch(`${origin}/api/tasks/${task.id}/retry-test`, { method: "POST" });
    assert.equal(retryResponse.status, 202);
    assert.deepEqual(await retryResponse.json(), { started: true });
    assert.equal(retriedTestTaskRef(), task.id);
  } finally {
    await cleanup(server, directory);
  }
});

test("dispatches a clean candidate rebuild after refresh conflict", async () => {
  const { directory, origin, server, rebuiltCandidateTaskRef } = await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Rebuild candidate",
      description: "Exercise the explicit refresh-conflict recovery action.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await createResponse.json();
    const response = await fetch(`${origin}/api/tasks/${task.id}/rebuild-candidate`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rebuilt, true);
    assert.equal(rebuiltCandidateTaskRef(), task.id);
  } finally {
    await cleanup(server, directory);
  }
});

test("dispatches an implementation restart from the latest target", async () => {
  const { directory, origin, server, restartedImplementationTaskRef } = await createServer();
  try {
    const createResponse = await createTask(origin, {
      title: "Restart implementation",
      description: "Exercise pre-candidate target-drift recovery.",
      repositoryPath: directory,
      workflow: "implement",
    });
    const { task } = await createResponse.json();
    const response = await fetch(`${origin}/api/tasks/${task.id}/restart-implementation`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).restarted, true);
    assert.equal(restartedImplementationTaskRef(), task.id);
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
    const slice = await sliceManager.prepare(sliceTask, "S1", {
      baseRevision: sliceBase.baseRevision,
      branchId: "slice-1",
    });
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
    const candidate = await candidateManager.prepare(candidateTask, "C1", {
      baseRevision: candidateBase.baseRevision,
    });
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
    assert.equal(candidateRow.retainedRequired, true);
    assert.equal(candidateRow.cleanupReady, false);

    const refused = await fetch(
      `${origin}/api/tasks/${candidateTask.id}/worktrees/${encodeURIComponent(`candidate:${candidateTask.id}:C1`)}`,
      { method: "DELETE" },
    );
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /still required by the unfinished task/);
    assert.equal(
      await stat(candidate.worktreePath)
        .then(() => true)
        .catch(() => false),
      true,
    );
  } finally {
    await cleanup(server, directory);
    await rm(sliceRepository, { recursive: true, force: true });
    await rm(candidateRepository, { recursive: true, force: true });
  }
});

test("removes a cleanup-ready worktree through the API and refuses an active one", async () => {
  const previousRoot = process.env.AGENT_HARNESS_WORKTREE_ROOT;
  const worktreeRootDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-worktree-root-"));
  // The route removes through the server's own `GitWorktreeManager`, which is rooted at
  // `defaultWorktreeRoot()` — the test worktree has to live under the same root or the
  // manager's own path-escape guard refuses it.
  process.env.AGENT_HARNESS_WORKTREE_ROOT = worktreeRootDirectory;
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-remove-repo-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Remove a slice worktree",
      description: "Exercise DELETE /api/tasks/:id/worktrees/:rowId.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(defaultWorktreeRoot());
    const base = await manager.base(task);
    const slice = await manager.prepare(task, "S1", { baseRevision: base.baseRevision, branchId: "slice-1" });
    await writeFile(path.join(slice.worktreePath, "feature.txt"), "done\n", "utf8");
    const committed = await manager.commit(slice, "slice worktree");
    await store.update(task.id, (draft) => {
      draft.workPackages.push({
        id: "S1",
        batch: 1,
        title: "Cleanup candidate",
        description: "Already committed and idle.",
        status: "ready_for_integration",
        attempts: 1,
        dependencies: [],
        ownedPaths: [],
        verification: [],
        branch: slice.branch,
        worktreePath: slice.worktreePath,
        baseRevision: slice.baseRevision,
        headRevision: committed.headRevision,
        files: committed.files,
        error: null,
      });
    });
    const rowUrl = `${origin}/api/tasks/${task.id}/worktrees/${encodeURIComponent(`slice:${task.id}:S1`)}`;

    // A worktree still in use must never be pulled out from under its running agent,
    // even though the tree itself is clean.
    await store.update(task.id, (draft) => {
      draft.workPackages[0].status = "running";
    });
    const refused = await fetch(rowUrl, { method: "DELETE" });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /not ready for cleanup/);
    assert.equal(
      await stat(slice.worktreePath)
        .then(() => true)
        .catch(() => false),
      true,
    );

    await store.update(task.id, (draft) => {
      draft.workPackages[0].status = "ready_for_integration";
    });
    const removed = await fetch(rowUrl, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const payload = await removed.json();
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0].gitExists, false);
    assert.equal(
      await stat(slice.worktreePath)
        .then(() => true)
        .catch(() => false),
      false,
    );

    const missing = await fetch(
      `${origin}/api/tasks/${task.id}/worktrees/${encodeURIComponent("slice:missing:X")}`,
      { method: "DELETE" },
    );
    assert.equal(missing.status, 404);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
    await rm(worktreeRootDirectory, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.AGENT_HARNESS_WORKTREE_ROOT;
    else process.env.AGENT_HARNESS_WORKTREE_ROOT = previousRoot;
  }
});

test("archiving hides a task, reclaims its clean worktrees, and keeps the dirty ones", async () => {
  const previousRoot = process.env.AGENT_HARNESS_WORKTREE_ROOT;
  const worktreeRootDirectory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-archive-root-"));
  process.env.AGENT_HARNESS_WORKTREE_ROOT = worktreeRootDirectory;
  const { directory, origin, server, store } = await createServer();
  const repository = await mkdtemp(path.join(os.tmpdir(), "agent-harness-api-archive-repo-"));
  try {
    await git(repository, ["init"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const task = await store.create({
      title: "Archive a stranded task",
      description: "Exercise POST /api/tasks/:id/archive.",
      repositoryPath: repository,
      workflow: "implement",
      priority: "medium",
    });
    const manager = new GitWorktreeManager(defaultWorktreeRoot());
    const base = await manager.base(task);
    const clean = await manager.prepare(task, "S1", { baseRevision: base.baseRevision, branchId: "slice-1" });
    await writeFile(path.join(clean.worktreePath, "feature.txt"), "done\n", "utf8");
    const cleanCommitted = await manager.commit(clean, "clean slice");
    const dirty = await manager.prepare(task, "S2", { baseRevision: base.baseRevision, branchId: "slice-2" });
    await writeFile(path.join(dirty.worktreePath, "wip.txt"), "uncommitted\n", "utf8");
    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
      for (const [id, slice, headRevision] of [
        ["S1", clean, cleanCommitted.headRevision],
        ["S2", dirty, null],
      ]) {
        draft.workPackages.push({
          id,
          batch: 1,
          title: `Slice ${id}`,
          description: "Fixture slice.",
          status: "ready_for_integration",
          attempts: 1,
          dependencies: [],
          ownedPaths: [],
          verification: [],
          branch: slice.branch,
          worktreePath: slice.worktreePath,
          baseRevision: slice.baseRevision,
          headRevision,
          files: [],
          error: null,
        });
      }
    });
    const archiveUrl = `${origin}/api/tasks/${task.id}/archive`;

    // An active run owns its worktree; archiving must not pull it out from under the agent.
    await store.update(task.id, (draft) => {
      draft.status = "running";
    });
    const refused = await fetch(archiveUrl, { method: "POST", body: JSON.stringify({}) });
    assert.equal(refused.status, 409);
    assert.match((await refused.json()).error, /Cancel the active run/);
    assert.equal(
      await stat(clean.worktreePath)
        .then(() => true)
        .catch(() => false),
      true,
    );

    await store.update(task.id, (draft) => {
      draft.status = "repair-required";
    });
    const archived = await fetch(archiveUrl, {
      method: "POST",
      body: JSON.stringify({ note: "Superseded by AH-003." }),
    });
    assert.equal(archived.status, 200);
    const payload = await archived.json();
    assert.equal(payload.task.status, "archived");
    // Archiving is a visibility decision, so where the task actually stopped has to survive it.
    assert.equal(payload.task.archive.previousStatus, "repair-required");
    assert.equal(payload.task.archive.note, "Superseded by AH-003.");
    assert.deepEqual(
      payload.removedWorktrees.map((entry) => entry.worktreePath),
      [clean.worktreePath],
    );
    assert.equal(payload.retainedWorktrees.length, 1);
    assert.equal(payload.retainedWorktrees[0].worktreePath, dirty.worktreePath);
    assert.equal(payload.retainedWorktrees[0].reason, "uncommitted changes");
    assert.deepEqual(payload.task.archive.removedWorktrees, [clean.worktreePath]);
    assert.deepEqual(payload.task.archive.retainedWorktrees, [dirty.worktreePath]);

    // The clean tree is gone; the one holding work nobody else has is untouched.
    assert.equal(
      await stat(clean.worktreePath)
        .then(() => true)
        .catch(() => false),
      false,
    );
    assert.equal(await readFile(path.join(dirty.worktreePath, "wip.txt"), "utf8"), "uncommitted\n");

    const again = await fetch(archiveUrl, { method: "POST", body: JSON.stringify({}) });
    assert.equal(again.status, 409);
    assert.match((await again.json()).error, /already archived/);

    // An archived task is terminal: no stage run may be started from it.
    const started = await fetch(`${origin}/api/tasks/${task.id}/repair`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(started.status, 409);
  } finally {
    await cleanup(server, directory);
    await rm(repository, { recursive: true, force: true });
    await rm(worktreeRootDirectory, { recursive: true, force: true });
    if (previousRoot === undefined) delete process.env.AGENT_HARNESS_WORKTREE_ROOT;
    else process.env.AGENT_HARNESS_WORKTREE_ROOT = previousRoot;
  }
});
