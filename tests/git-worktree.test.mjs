import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  defaultWorktreeRoot,
  GitWorktreeManager,
  discoverDependencyDirectories,
  provisionedDependencyEntries,
} from "../server/git-worktree.mjs";

const exec = promisify(execFile);

test("creates, commits, and fast-forward merges an isolated candidate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-git-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await writeFile(path.join(repository, ".gitignore"), ".data/\n", "utf8");
    await git(repository, ["add", "README.md", ".gitignore"]);
    await git(repository, ["commit", "-m", "base"]);

    const manager = new GitWorktreeManager(path.join(repository, ".data", "worktrees"));
    const task = { id: "AH-001", repositoryPath: repository };
    const base = await manager.base(task);
    const firstSlice = await manager.prepare(task, "S1-A1", { baseRevision: base.baseRevision });
    await writeFile(path.join(firstSlice.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const firstCommit = await manager.commit(firstSlice, "first slice");
    const secondSlice = await manager.prepare(task, "S2-A1", { baseRevision: base.baseRevision });
    await writeFile(path.join(secondSlice.worktreePath, "second.txt"), "parallel\n", "utf8");
    const secondCommit = await manager.commit(secondSlice, "second slice");
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    const assembled = await manager.assemble(candidate, [
      { packageId: "S1", headRevision: firstCommit.headRevision },
      { packageId: "S2", headRevision: secondCommit.headRevision },
    ]);
    candidate.headRevision = assembled.headRevision;

    assert.deepEqual(firstCommit.files, ["feature.txt"]);
    const retainedSlice = { ...firstSlice, headRevision: firstCommit.headRevision, files: firstCommit.files };
    const retainedInspection = await manager.inspectRetainedSlice(retainedSlice, {
      ownedPaths: ["feature.txt"],
    });
    assert.equal(retainedInspection.clean, true);
    assert.deepEqual(retainedInspection.files, ["feature.txt"]);
    assert.equal(await manager.retainedPatchDisposition(retainedSlice, base.baseRevision), "pending");
    await writeFile(path.join(firstSlice.worktreePath, "outside.txt"), "unfinished\n", "utf8");
    const dirtyInspection = await manager.inspectRetainedSlice(retainedSlice, { requireClean: false });
    assert.equal(dirtyInspection.clean, false);
    assert.deepEqual(dirtyInspection.files, ["feature.txt", "outside.txt"]);
    await assert.rejects(
      () => manager.inspectRetainedSlice(retainedSlice, { ownedPaths: ["feature.txt"], requireClean: false }),
      /outside the current work package ownership/i,
    );
    await rm(path.join(firstSlice.worktreePath, "outside.txt"));
    assert.match(assembled.summary, /feature\.txt/);
    assert.match(assembled.summary, /second\.txt/);
    assert.equal(await manager.verifyCandidate(candidate), assembled.headRevision);
    await manager.merge(candidate);
    assert.equal(
      await manager.retainedPatchDisposition(retainedSlice, assembled.headRevision),
      "already-applied",
    );
    assert.equal(
      (await readFile(path.join(repository, "feature.txt"), "utf8")).replaceAll("\r\n", "\n"),
      "candidate\n",
    );
    assert.equal(
      (await readFile(path.join(repository, "second.txt"), "utf8")).replaceAll("\r\n", "\n"),
      "parallel\n",
    );

    const unsafeCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C2");
    await writeFile(path.join(unsafeCandidate.worktreePath, ".env"), "SECRET=do-not-commit\n", "utf8");
    await assert.rejects(() => manager.commit(unsafeCandidate, "unsafe"), /potentially sensitive file/);

    const generatedCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C3");
    await mkdir(path.join(generatedCandidate.worktreePath, ".tmp", "npm-cache"), { recursive: true });
    await writeFile(
      path.join(generatedCandidate.worktreePath, ".tmp", "npm-cache", "state.json"),
      "{}\n",
      "utf8",
    );
    await assert.rejects(() => manager.commit(generatedCandidate, "generated"), /generated tool state/);

    const pnpmCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C4");
    await mkdir(path.join(pnpmCandidate.worktreePath, ".pnpm-store", "v11"), { recursive: true });
    await writeFile(
      path.join(pnpmCandidate.worktreePath, ".pnpm-store", "v11", "state.json"),
      "{}\n",
      "utf8",
    );
    await assert.rejects(() => manager.commit(pnpmCandidate, "pnpm cache"), /generated tool state/);

    const recoveryCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C5");
    await writeFile(path.join(recoveryCandidate.worktreePath, "repair-target.txt"), "committed\n", "utf8");
    const recoveryCommit = await manager.commit(recoveryCandidate, "recorded candidate");
    recoveryCandidate.headRevision = recoveryCommit.headRevision;
    await writeFile(
      path.join(recoveryCandidate.worktreePath, "repair-target.txt"),
      "dirty partial repair\n",
      "utf8",
    );
    await mkdir(path.join(recoveryCandidate.worktreePath, ".pnpm-store", "partial"), { recursive: true });
    await writeFile(
      path.join(recoveryCandidate.worktreePath, ".pnpm-store", "partial", "state.json"),
      "{}\n",
      "utf8",
    );
    assert.equal(await manager.recoverCandidate(recoveryCandidate), true);
    assert.equal(
      (await readFile(path.join(recoveryCandidate.worktreePath, "repair-target.txt"), "utf8")).replaceAll(
        "\r\n",
        "\n",
      ),
      "committed\n",
    );
    assert.equal(
      (
        await git(recoveryCandidate.worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"])
      ).stdout.trim(),
      "",
    );

    const cleanupCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C6");
    await mkdir(path.join(cleanupCandidate.worktreePath, ".pnpm-store"), { recursive: true });
    await writeFile(path.join(cleanupCandidate.worktreePath, ".pnpm-store", "tracked.json"), "{}\n", "utf8");
    await git(cleanupCandidate.worktreePath, ["add", "-f", ".pnpm-store/tracked.json"]);
    await git(cleanupCandidate.worktreePath, [
      "commit",
      "-m",
      "candidate accidentally tracks generated state",
    ]);
    cleanupCandidate.headRevision = (
      await git(cleanupCandidate.worktreePath, ["rev-parse", "HEAD"])
    ).stdout.trim();
    await rm(path.join(cleanupCandidate.worktreePath, ".pnpm-store", "tracked.json"));
    const cleaned = await manager.commit(cleanupCandidate, "repair removes generated state", {
      allowGeneratedDeletions: true,
    });
    assert.equal(cleaned.files.includes(".pnpm-store/tracked.json"), true);

    const scopedCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C7");
    await mkdir(path.join(scopedCandidate.worktreePath, "src"), { recursive: true });
    await writeFile(path.join(scopedCandidate.worktreePath, "src", "owned.ts"), "export {};\n", "utf8");
    const scopedCommit = await manager.commit(scopedCandidate, "owned change", { ownedPaths: ["SRC"] });
    assert.deepEqual(scopedCommit.files, ["src/owned.ts"]);

    const escapedCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C8");
    await writeFile(path.join(escapedCandidate.worktreePath, "outside.txt"), "not owned\n", "utf8");
    await assert.rejects(
      () => manager.commit(escapedCandidate, "out of scope", { ownedPaths: ["src"] }),
      /outside the work package ownership/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("only accepts an empty diff as success when the caller explicitly allows a no-op", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-noop-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-NOOP", repositoryPath: repository };
    const base = await manager.base(task);

    // A stuck or broken agent that produced nothing without justification still fails
    // the way it always has: the caller must ask for the no-op path explicitly.
    const unjustified = await manager.prepare(task, "S1-A1", { baseRevision: base.baseRevision });
    await assert.rejects(() => manager.commit(unjustified, "S1"), /completed without changing any files/);

    // A work package whose own verification already confirmed nothing needed to change.
    const noopSlice = await manager.prepare(task, "S2-A1", { baseRevision: base.baseRevision });
    const noop = await manager.commit(noopSlice, "S2", { allowNoChanges: true });
    assert.equal(noop.noChangesNeeded, true);
    assert.equal(noop.headRevision, null);
    assert.deepEqual(noop.files, []);

    // A real change is committed normally regardless of `allowNoChanges`.
    const realSlice = await manager.prepare(task, "S3-A1", { baseRevision: base.baseRevision });
    await writeFile(path.join(realSlice.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const real = await manager.commit(realSlice, "S3", { allowNoChanges: true });
    assert.equal(real.noChangesNeeded, undefined);
    assert.ok(real.headRevision);
    await writeFile(path.join(realSlice.worktreePath, "contract.test.txt"), "repair\n", "utf8");
    const squashed = await manager.commit(realSlice, "S3 qualification repair", { squashFromBase: true });
    assert.equal(squashed.parentRevision, base.baseRevision);
    assert.deepEqual(squashed.files.sort(), ["contract.test.txt", "feature.txt"]);
    assert.equal(
      (
        await git(realSlice.worktreePath, ["rev-list", "--count", `${base.baseRevision}..HEAD`])
      ).stdout.trim(),
      "1",
    );

    // Assembly skips a no-op member entirely rather than cherry-picking a null revision.
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    const assembled = await manager.assemble(candidate, [
      { packageId: "S2", headRevision: noop.headRevision },
      { packageId: "S3", headRevision: squashed.headRevision },
    ]);
    assert.deepEqual(assembled.files, ["contract.test.txt", "feature.txt"]);

    // A dependent slice tolerates a no-op dependency's null revision the same way.
    const dependentSlice = await manager.prepare(task, "S4-A1", {
      baseRevision: base.baseRevision,
      dependencyRevisions: [noop.headRevision, squashed.headRevision],
      branchId: "S4-A1",
    });
    assert.equal(
      (await readFile(path.join(dependentSlice.worktreePath, "feature.txt"), "utf8")).replaceAll(
        "\r\n",
        "\n",
      ),
      "candidate\n",
    );
    assert.equal(
      (await readFile(path.join(dependentSlice.worktreePath, "contract.test.txt"), "utf8")).replaceAll(
        "\r\n",
        "\n",
      ),
      "repair\n",
    );
    const dependentBase = (await git(dependentSlice.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(dependentSlice.worktreePath, "dependent.txt"), "initial\n", "utf8");
    const dependent = await manager.commit(dependentSlice, "S4", {
      ownedPaths: ["dependent.txt", "dependent-repair.txt"],
    });
    dependentSlice.headRevision = dependent.headRevision;
    await writeFile(path.join(dependentSlice.worktreePath, "dependent-repair.txt"), "continued\n", "utf8");
    const continued = await manager.commit(dependentSlice, "S4 qualification repair", {
      ownedPaths: ["dependent.txt", "dependent-repair.txt"],
      squashFromBase: true,
    });
    assert.equal(continued.parentRevision, dependentBase);
    assert.deepEqual(continued.files.sort(), ["dependent-repair.txt", "dependent.txt"]);
    assert.equal(
      (
        await git(dependentSlice.worktreePath, ["rev-list", "--count", `${dependentBase}..HEAD`])
      ).stdout.trim(),
      "1",
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("can create an isolated exact-HEAD worktree without touching dirty source files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-dirty-source-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "committed\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);

    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-DIRTY", repositoryPath: repository };
    const base = await manager.base(task);
    await writeFile(path.join(repository, "README.md"), "operator draft\n", "utf8");

    await assert.rejects(
      () => manager.prepare(task, "C-BLOCKED", { baseRevision: base.baseRevision }),
      /uncommitted changes/i,
    );
    const candidate = await manager.prepare(task, "C1", {
      baseRevision: base.baseRevision,
      allowDirtySource: true,
    });

    assert.equal(await readFile(path.join(candidate.worktreePath, "README.md"), "utf8"), "committed\n");
    assert.equal(await readFile(path.join(repository, "README.md"), "utf8"), "operator draft\n");
    await assert.rejects(
      () => manager.merge({ ...candidate, headRevision: base.baseRevision }),
      /uncommitted changes/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("refuses to merge a candidate into a sibling branch at the same base revision", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-target-ref-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-REF", repositoryPath: repository };
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate");
    candidate.headRevision = committed.headRevision;

    await git(repository, ["checkout", "-b", "sibling", base.baseRevision]);
    await assert.rejects(() => manager.merge(candidate), /recorded target ref/i);
    assert.equal((await git(repository, ["rev-parse", "HEAD"])).stdout.trim(), base.baseRevision);
    await git(repository, ["checkout", "--detach", base.baseRevision]);
    await assert.rejects(() => manager.merge(candidate), /recorded target ref/i);
    await git(repository, ["checkout", candidate.baseBranch]);
    assert.equal(await manager.merge(candidate), committed.headRevision);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("refreshes a clean candidate onto an advanced target without rewriting the recorded revision", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-refresh-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-REFRESH", repositoryPath: repository };
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate");
    candidate.headRevision = committed.headRevision;

    await writeFile(path.join(repository, "README.md"), "base\ntarget advanced\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "advance target"]);
    const targetRevision = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();

    assert.equal(await manager.mergeState(candidate), "diverged");
    const refreshed = await manager.refreshCandidate(candidate);
    assert.equal(refreshed.previousBaseRevision, base.baseRevision);
    assert.equal(refreshed.previousHeadRevision, committed.headRevision);
    assert.equal(refreshed.targetRevision, targetRevision);
    assert.notEqual(refreshed.headRevision, committed.headRevision);
    assert.deepEqual(refreshed.files, ["feature.txt"]);
    assert.equal(
      (await readFile(path.join(candidate.worktreePath, "README.md"), "utf8")).replaceAll("\r\n", "\n"),
      "base\ntarget advanced\n",
    );
    assert.equal(
      (await readFile(path.join(candidate.worktreePath, "feature.txt"), "utf8")).replaceAll("\r\n", "\n"),
      "candidate\n",
    );

    candidate.baseRevision = refreshed.targetRevision;
    candidate.headRevision = refreshed.headRevision;
    assert.equal(await manager.mergeState(candidate), "pending");
    assert.equal(await manager.merge(candidate), refreshed.headRevision);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("aborts a conflicting candidate refresh and restores the recorded head", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-refresh-conflict-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "shared.txt"), "base\n", "utf8");
    await git(repository, ["add", "shared.txt"]);
    await git(repository, ["commit", "-m", "base"]);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-CONFLICT", repositoryPath: repository };
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(path.join(candidate.worktreePath, "shared.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate");
    candidate.headRevision = committed.headRevision;
    await writeFile(path.join(repository, "shared.txt"), "target\n", "utf8");
    await git(repository, ["add", "shared.txt"]);
    await git(repository, ["commit", "-m", "advance target"]);

    await assert.rejects(() => manager.refreshCandidate(candidate), /refresh conflicted/i);
    assert.equal(await manager.verifyCandidate(candidate), committed.headRevision);
    assert.equal(
      (await readFile(path.join(candidate.worktreePath, "shared.txt"), "utf8")).replaceAll("\r\n", "\n"),
      "candidate\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("refresh collapses an equivalent candidate patch already committed on the target", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-refresh-applied-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await git(repository, ["config", "user.name", "Agent Harness Test"]);
    await git(repository, ["config", "user.email", "agent-harness@example.test"]);
    await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "base"]);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-APPLIED", repositoryPath: repository };
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });
    await writeFile(
      path.join(candidate.worktreePath, "reporter.ts"),
      "export const reporter = 'json';\n",
      "utf8",
    );
    const committed = await manager.commit(candidate, "candidate reporter");
    candidate.headRevision = committed.headRevision;

    await writeFile(path.join(repository, "reporter.ts"), "export const reporter = 'json';\n", "utf8");
    await writeFile(path.join(repository, "unrelated.txt"), "landed in the same target commit\n", "utf8");
    await git(repository, ["add", "reporter.ts", "unrelated.txt"]);
    await git(repository, ["commit", "-m", "larger target change"]);
    const targetRevision = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();

    const refreshed = await manager.refreshCandidate(candidate);
    assert.equal(refreshed.alreadyApplied, true);
    assert.equal(refreshed.headRevision, targetRevision);
    assert.deepEqual(refreshed.files, []);
    assert.equal(
      await manager.verifyCandidate({ ...candidate, headRevision: targetRevision }),
      targetRevision,
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("a symlinked dependency directory is not ignored by git status", async () => {
  // The exclusion in the harness scans exists because of this: `.gitignore` entries such as
  // `node_modules/` match directories, and a symlink named `node_modules` is a file to Git.
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-symlink-ignore-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await writeFile(path.join(repository, ".gitignore"), "node_modules/\n", "utf8");
    await mkdir(path.join(repository, "node_modules", "left-pad"), { recursive: true });
    await writeFile(
      path.join(repository, "node_modules", "left-pad", "index.js"),
      "module.exports = 1;\n",
      "utf8",
    );
    const realStatus = (await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
    assert.doesNotMatch(realStatus, /node_modules/, "a real node_modules directory is ignored");

    await rm(path.join(repository, "node_modules"), { recursive: true, force: true });
    await mkdir(path.join(repository, "installed"), { recursive: true });
    await symlinkDirectory(path.join(repository, "installed"), path.join(repository, "node_modules"));
    const linkStatus = (await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
    assert.match(
      linkStatus,
      /^\?\? node_modules$/m,
      "a symlinked node_modules is NOT ignored, so linking alone is insufficient",
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("provisions nested and non-Node dependencies into slice and candidate worktrees", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-provision-"));
  const repository = path.join(directory, "repository");
  try {
    await seedRepository(directory, repository);
    await seedDependencies(repository);

    assert.deepEqual(await discoverDependencyDirectories(await realRepository(repository)), [
      ".venv",
      "frontend/node_modules",
      "node_modules",
    ]);

    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-DEPS", repositoryPath: repository };
    const base = await manager.base(task);

    const slice = await manager.prepare(task, "S1-A1", { baseRevision: base.baseRevision });
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });

    for (const worktree of [slice, candidate]) {
      assert.deepEqual(worktree.provisionedDependencyPaths, [
        ".venv",
        "frontend/node_modules",
        "node_modules",
      ]);
      // Every provisioned path resolves to the source checkout's installed dependencies.
      assert.equal(
        (
          await readFile(path.join(worktree.worktreePath, "node_modules", "left-pad", "index.js"), "utf8")
        ).trim(),
        "module.exports = 1;",
      );
      assert.equal(
        (
          await readFile(
            path.join(worktree.worktreePath, "frontend", "node_modules", "vite", "index.js"),
            "utf8",
          )
        ).trim(),
        "module.exports = 2;",
      );
      assert.equal(
        (await readFile(path.join(worktree.worktreePath, ".venv", "pyvenv.cfg"), "utf8")).trim(),
        "home = /usr",
      );
      assert.equal((await lstat(path.join(worktree.worktreePath, "node_modules"))).isSymbolicLink(), false);
      assert.equal((await lstat(path.join(worktree.worktreePath, "node_modules"))).isDirectory(), true);

      const modeByPath = new Map(
        (await provisionedDependencyEntries(worktree.worktreePath)).map((entry) => [entry.path, entry.mode]),
      );
      assert.deepEqual([...modeByPath.keys()].sort(), [".venv", "frontend/node_modules", "node_modules"]);
      const nodeModulesMode = modeByPath.get("node_modules");
      if (nodeModulesMode === "clone") {
        // A clone is real, independent content: an installed package is its own copy,
        // not a pointer back into the source checkout.
        assert.equal(
          (await lstat(path.join(worktree.worktreePath, "node_modules", "left-pad"))).isSymbolicLink(),
          false,
        );
        assert.notEqual(
          await realpath(path.join(worktree.worktreePath, "node_modules", "left-pad")),
          await realpath(path.join(repository, "node_modules", "left-pad")),
          "a cloned package does not resolve back to the source checkout",
        );
      } else {
        // Without clone/reflink support the directory itself is worktree-local and
        // writable, while each installed package inside it is a link and therefore
        // still immutable. A wholesale directory link makes every path under it resolve
        // into the shared source checkout, and both sandboxes resolve symlinks before
        // matching — so tool caches written under node_modules (vite's `.vite-temp`,
        // written while merely loading its config) are refused and the stage fails.
        assert.equal(
          (await lstat(path.join(worktree.worktreePath, "node_modules", "left-pad"))).isSymbolicLink(),
          true,
        );
        assert.equal(
          await realpath(path.join(worktree.worktreePath, "node_modules", "left-pad")),
          await realpath(path.join(repository, "node_modules", "left-pad")),
          "a linked package still resolves to the source checkout",
        );
      }

      // A tool cache created during a stage stays inside the worktree instead of
      // contaminating the source checkout that every other worktree shares.
      await writeFile(path.join(worktree.worktreePath, "node_modules", ".tool-cache"), "local\n", "utf8");
      assert.equal(
        await stat(path.join(repository, "node_modules", ".tool-cache"))
          .then(() => true)
          .catch(() => false),
        false,
        "the source checkout is untouched by a worktree-local cache write",
      );
      await rm(path.join(worktree.worktreePath, "node_modules", ".tool-cache"), { force: true });
      // Provisioning never writes a lockfile.
      assert.equal(
        (await readFile(path.join(worktree.worktreePath, "package-lock.json"), "utf8")).trim(),
        '{"lockfileVersion":3}',
      );
      // A clean worktree despite the provisioned dependencies being present.
      assert.equal(await manager.assertWorktreeClean(worktree.worktreePath), true);
    }

    // A simulated Test run: it resolves dependencies through the worktree and writes a
    // report, which is cleaned up afterwards. The worktree is clean on both sides of the run.
    assert.deepEqual(await readdir(path.join(slice.worktreePath, "node_modules")), ["left-pad"]);
    await mkdir(path.join(slice.worktreePath, "test-results"), { recursive: true });
    await writeFile(path.join(slice.worktreePath, "test-results", "report.json"), "{}\n", "utf8");
    await assert.rejects(
      () => manager.assertWorktreeClean(slice.worktreePath),
      /uncommitted changes/,
      "report output is still seen",
    );
    await rm(path.join(slice.worktreePath, "test-results"), { recursive: true, force: true });
    assert.equal(await manager.assertWorktreeClean(slice.worktreePath), true, "clean again after a Test run");

    await writeFile(path.join(slice.worktreePath, "feature.txt"), "implemented\n", "utf8");
    const committed = await manager.commit(slice, "slice with provisioned dependencies");
    assert.equal(await manager.assertWorktreeClean(slice.worktreePath), true, "clean after the commit");
    assert.deepEqual(committed.files, ["feature.txt"], "no provisioned path reaches the commit");
    const tracked = (await git(slice.worktreePath, ["ls-files"])).stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(
      tracked.some(
        (file) =>
          file.startsWith("node_modules") || file.startsWith(".venv") || file.includes("/node_modules"),
      ),
      false,
      "no provisioned path is tracked",
    );
    slice.headRevision = committed.headRevision;
    assert.equal(await manager.verifyCandidate(slice), committed.headRevision);

    // Provisioned paths are excluded narrowly: sensitive and generated scanning is unchanged.
    await writeFile(path.join(candidate.worktreePath, "deploy.pem"), "key\n", "utf8");
    await assert.rejects(() => manager.commit(candidate, "unsafe"), /potentially sensitive file/);
    await rm(path.join(candidate.worktreePath, "deploy.pem"));
    await mkdir(path.join(candidate.worktreePath, "test-results"), { recursive: true });
    await writeFile(path.join(candidate.worktreePath, "test-results", "report.json"), "{}\n", "utf8");
    await assert.rejects(() => manager.commit(candidate, "generated"), /generated tool state/);
    await rm(path.join(candidate.worktreePath, "test-results"), { recursive: true, force: true });

    const assembled = await manager.assemble(candidate, [
      { packageId: "S1", headRevision: committed.headRevision },
    ]);
    candidate.headRevision = assembled.headRevision;
    assert.equal(await manager.verifyCandidate(candidate), assembled.headRevision);

    // Recovery keeps the worktree usable for a rerun instead of stripping its dependencies.
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "dirty\n", "utf8");
    assert.equal(await manager.recoverCandidate(candidate), true);
    assert.equal(
      (
        await readFile(path.join(candidate.worktreePath, "node_modules", "left-pad", "index.js"), "utf8")
      ).trim(),
      "module.exports = 1;",
    );
    assert.equal(
      await manager.recoverCandidate(candidate),
      false,
      "a provisioned worktree reads as already recovered",
    );

    // Removal unlinks the provisioned paths and leaves the source dependencies intact.
    const removed = await manager.removeWorktree(candidate);
    assert.deepEqual(removed, [".venv", "frontend/node_modules", "node_modules"]);
    assert.equal(await exists(candidate.worktreePath), false);
    assert.deepEqual(await readdir(path.join(repository, "node_modules")), ["left-pad"]);
    assert.equal(
      (await readFile(path.join(repository, "node_modules", "left-pad", "index.js"), "utf8")).trim(),
      "module.exports = 1;",
    );
    assert.equal(
      (await readFile(path.join(repository, "frontend", "node_modules", "vite", "index.js"), "utf8")).trim(),
      "module.exports = 2;",
    );
    assert.equal(
      (await readFile(path.join(repository, ".venv", "pyvenv.cfg"), "utf8")).trim(),
      "home = /usr",
    );
    assert.equal(await manager.ensureCandidate(candidate), true, "the exact retained branch is reattached");
    assert.equal(await manager.verifyCandidate(candidate), assembled.headRevision);
    assert.equal(
      (
        await readFile(path.join(candidate.worktreePath, "node_modules", "left-pad", "index.js"), "utf8")
      ).trim(),
      "module.exports = 1;",
      "reattachment reprovisions dependencies",
    );
    assert.equal(await manager.ensureCandidate(candidate), false, "an existing candidate is left unchanged");
    await manager.removeWorktree(candidate);
    await manager.base(task);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("a write inside a cloned dependency directory succeeds, which a symlinked one could not", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-clone-write-"));
  const repository = path.join(directory, "repository");
  try {
    await seedRepository(directory, repository);
    await seedDependencies(repository);

    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const task = { id: "AH-CLONE", repositoryPath: repository };
    const base = await manager.base(task);
    const candidate = await manager.prepare(task, "C1", { baseRevision: base.baseRevision });

    const modeByPath = new Map(
      (await provisionedDependencyEntries(candidate.worktreePath)).map((entry) => [entry.path, entry.mode]),
    );
    if (modeByPath.get("node_modules") !== "clone") {
      t.skip("this host has no same-volume clonefile/reflink support; the symlink fallback is covered above");
      return;
    }

    // A per-entry symlink made `node_modules` itself writable but left every installed
    // package resolving through a link into the source checkout, so a write anywhere
    // *inside* an already-installed package (a build artifact, a downloaded browser, a
    // rewritten file) still landed in shared state and would be refused by a resolved-path
    // sandbox. A clone is real, independent content throughout, so the same write succeeds
    // and never reaches the source checkout at all.
    const worktreeReal = await realpath(candidate.worktreePath);
    const newFile = path.join(candidate.worktreePath, "node_modules", "left-pad", "generated-cache.json");
    await writeFile(newFile, "{}\n", "utf8");
    assert.ok(
      (await realpath(newFile)).startsWith(`${worktreeReal}${path.sep}`),
      "the write's resolved path stays inside the worktree",
    );
    assert.equal(
      await stat(path.join(repository, "node_modules", "left-pad", "generated-cache.json"))
        .then(() => true)
        .catch(() => false),
      false,
      "the write never reaches the source checkout",
    );

    // Rewriting a file that was already part of the installed package, not just adding a
    // new one, is the case a wholesale directory link could never satisfy either.
    await writeFile(
      path.join(candidate.worktreePath, "node_modules", "left-pad", "index.js"),
      "module.exports = 99;\n",
      "utf8",
    );
    assert.equal(
      (await readFile(path.join(repository, "node_modules", "left-pad", "index.js"), "utf8")).trim(),
      "module.exports = 1;",
      "the source checkout's installed package is unaffected by a worktree-local edit",
    );

    // Removal still recursively deletes the clone and leaves the source dependencies intact.
    const removed = await manager.removeWorktree(candidate);
    assert.deepEqual(removed, [".venv", "frontend/node_modules", "node_modules"]);
    assert.equal(await exists(candidate.worktreePath), false);
    assert.equal(
      (await readFile(path.join(repository, "node_modules", "left-pad", "index.js"), "utf8")).trim(),
      "module.exports = 1;",
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("does not provision tracked directories that share a dependency name", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-provision-tracked-"));
  const repository = path.join(directory, "repository");
  try {
    await seedRepository(directory, repository);
    // A committed `vendor/` is source, not an installed dependency, so it must not be linked.
    await mkdir(path.join(repository, "vendor", "upstream"), { recursive: true });
    await writeFile(path.join(repository, "vendor", "upstream", "patch.js"), "module.exports = 3;\n", "utf8");
    await git(repository, ["add", "vendor"]);
    await git(repository, ["commit", "-m", "vendored source"]);
    await mkdir(path.join(repository, "node_modules", "left-pad"), { recursive: true });
    await writeFile(
      path.join(repository, "node_modules", "left-pad", "index.js"),
      "module.exports = 1;\n",
      "utf8",
    );

    assert.deepEqual(await discoverDependencyDirectories(await realRepository(repository)), ["node_modules"]);
    const manager = new GitWorktreeManager(path.join(directory, "worktrees"));
    const slice = await manager.prepare({ id: "AH-VENDOR", repositoryPath: repository }, "S1-A1");
    assert.deepEqual(slice.provisionedDependencyPaths, ["node_modules"]);
    assert.equal((await lstat(path.join(slice.worktreePath, "vendor"))).isDirectory(), true);
    assert.equal((await lstat(path.join(slice.worktreePath, "vendor"))).isSymbolicLink(), false);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function seedRepository(directory, repository) {
  await git(directory, ["init", "repository"]);
  await git(repository, ["config", "user.name", "Agent Harness Test"]);
  await git(repository, ["config", "user.email", "agent-harness@example.test"]);
  await writeFile(path.join(repository, "README.md"), "base\n", "utf8");
  await writeFile(path.join(repository, "package-lock.json"), '{"lockfileVersion":3}\n', "utf8");
  await writeFile(path.join(repository, ".gitignore"), "node_modules/\n.venv/\n.data/\n", "utf8");
  await mkdir(path.join(repository, "frontend"), { recursive: true });
  await writeFile(path.join(repository, "frontend", "package.json"), "{}\n", "utf8");
  await git(repository, ["add", "-A"]);
  await git(repository, ["commit", "-m", "base"]);
}

async function seedDependencies(repository) {
  await mkdir(path.join(repository, "node_modules", "left-pad"), { recursive: true });
  await writeFile(
    path.join(repository, "node_modules", "left-pad", "index.js"),
    "module.exports = 1;\n",
    "utf8",
  );
  await mkdir(path.join(repository, "frontend", "node_modules", "vite"), { recursive: true });
  await writeFile(
    path.join(repository, "frontend", "node_modules", "vite", "index.js"),
    "module.exports = 2;\n",
    "utf8",
  );
  await mkdir(path.join(repository, ".venv"), { recursive: true });
  await writeFile(path.join(repository, ".venv", "pyvenv.cfg"), "home = /usr\n", "utf8");
}

async function realRepository(repository) {
  return (await git(repository, ["rev-parse", "--show-toplevel"])).stdout.trim();
}

async function symlinkDirectory(target, linkPath) {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

async function exists(target) {
  return lstat(target)
    .then(() => true)
    .catch(() => false);
}

async function git(cwd, args) {
  return exec("git", args, { cwd, windowsHide: true });
}

test("places candidate worktrees outside the repository, at a short path", () => {
  // Every character of a candidate's cwd is carried by thousands of seatbelt rules in the
  // exec arguments of every sandboxed Bash command. Measured on this repository at a fixed
  // worktree count: 420,514 bytes at a 9-char path against 617,644 at 81 chars, ≈2,738
  // B/char, which is 13 worktrees of headroom against a 1 MB ceiling. So the default is
  // short and outside the checkout, and the old `<repo>/.data/worktrees` default is gone.
  const root = defaultWorktreeRoot({});
  assert.ok(path.isAbsolute(root), "an absolute root is what keeps the escape guard meaningful");
  assert.equal(root, path.join(os.homedir(), ".ah", "w"));
  assert.ok(!root.includes(".data"), "candidates no longer live inside the repository");
  // Comfortably shorter than the path it replaced, which is the entire point.
  assert.ok(root.length < path.join(process.cwd(), ".data", "worktrees").length);

  // Overridable, because a host with a long home directory should be able to do better, and
  // because the preflight measures the consequence rather than assuming it.
  assert.equal(defaultWorktreeRoot({ AGENT_HARNESS_WORKTREE_ROOT: "/tmp/ahw" }), "/tmp/ahw");
  // Resolved, never used as given: a relative override would move with the process cwd.
  assert.ok(path.isAbsolute(defaultWorktreeRoot({ AGENT_HARNESS_WORKTREE_ROOT: "relative/root" })));
});
