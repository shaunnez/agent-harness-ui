import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { GitWorktreeManager } from "../server/git-worktree.mjs";

const exec = promisify(execFile);

// WP0b: a `git worktree add --detach` checkout shares one `refs/heads` namespace with
// the whole repository it came from. A task ID assigned sequentially by the local task
// store has no relationship to that repository's real branch history, so the plain
// candidate branch name (`agent-harness/<task-id>-<candidate-id>`) can already exist as
// a ref from prior harness usage against the same repository. These tests prove
// `GitWorktreeManager.prepare` disambiguates instead of failing, that repeated
// collisions keep resolving, that the common no-collision case is unaffected, and that
// downstream code reads the branch actually allocated rather than recomputing it.

test("prepares a worktree with a disambiguated branch when the plain name already exists", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-branch-collision-"));
  const repository = path.join(directory, "repository");
  try {
    await seedRepository(directory, repository);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-001", repositoryPath: repository };
    const base = await manager.base(task);

    // Simulate a repository that already has real harness branches from prior usage,
    // exactly the collision the WP0 spike reproduced against this repository.
    await git(repository, ["branch", "agent-harness/ah-001-c1", base.baseRevision]);

    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    assert.equal(candidate.branch, "agent-harness/ah-001-c1-2");
    // A successful `show-ref --verify` (no throw) confirms the disambiguated branch is a
    // real ref in the repository, not just a string on the returned object.
    await git(repository, ["show-ref", "--verify", "--quiet", "refs/heads/agent-harness/ah-001-c1-2"]);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("resolves a second and third collision in a row instead of failing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-branch-collision-multi-"));
  const repository = path.join(directory, "repository");
  try {
    await seedRepository(directory, repository);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-001", repositoryPath: repository };
    const base = await manager.base(task);

    await git(repository, ["branch", "agent-harness/ah-001-c1", base.baseRevision]);
    await git(repository, ["branch", "agent-harness/ah-001-c1-2", base.baseRevision]);
    await git(repository, ["branch", "agent-harness/ah-001-c1-3", base.baseRevision]);

    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    assert.equal(candidate.branch, "agent-harness/ah-001-c1-4");
    await git(repository, ["show-ref", "--verify", "--quiet", "refs/heads/agent-harness/ah-001-c1-4"]);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("keeps the plain, undecorated branch name when no collision exists", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-branch-no-collision-"));
  const repository = path.join(directory, "repository");
  try {
    await seedRepository(directory, repository);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-002", repositoryPath: repository };
    const base = await manager.base(task);

    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    assert.equal(candidate.branch, "agent-harness/ah-002-c1");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("downstream consumers read the actually-allocated branch, not a recomputed one", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-branch-downstream-"));
  const repository = path.join(directory, "repository");
  try {
    await seedRepository(directory, repository);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-003", repositoryPath: repository };
    const base = await manager.base(task);
    await git(repository, ["branch", "agent-harness/ah-003-s1-a1", base.baseRevision]);

    const slice = await manager.prepare(task, "S1-A1", { baseRevision: base.baseRevision, branchId: "S1-A1" });
    // A downstream consumer that only ever reads `slice.branch` (as
    // `orchestrator-work-packages.mjs` does when it sets `target.branch = slice.branch`)
    // sees the disambiguated name, never the recomputed `agent-harness/ah-003-s1-a1`.
    assert.equal(slice.branch, "agent-harness/ah-003-s1-a1-2");
    assert.notEqual(slice.branch, "agent-harness/ah-003-s1-a1");

    await writeFile(path.join(slice.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(slice, "slice change");
    slice.headRevision = committed.headRevision;
    // `verifyCandidate`/`inspectRetainedSlice` and every other recovery path key off the
    // recorded `candidate.branch`, so a slice that only remembers the disambiguated name
    // must still be independently verifiable.
    const inspected = await manager.inspectRetainedSlice(slice, { requireClean: true });
    assert.equal(inspected.branch, "agent-harness/ah-003-s1-a1-2");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function seedRepository(directory, repository) {
  await git(directory, ["init", "repository"]);
  await git(repository, ["config", "user.name", "Agent Harness Test"]);
  await git(repository, ["config", "user.email", "agent-harness@example.test"]);
  await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
  await writeFile(path.join(repository, ".gitignore"), ".data/\n", "utf8");
  await git(repository, ["add", "README.md", ".gitignore"]);
  await git(repository, ["commit", "-m", "base"]);
}

async function git(cwd, args) {
  return exec("git", args, { cwd, windowsHide: true });
}
