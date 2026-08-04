import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { GitWorktreeManager, discoverDependencyDirectories } from "../server/git-worktree.mjs";

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
    assert.match(assembled.summary, /feature\.txt/);
    assert.match(assembled.summary, /second\.txt/);
    assert.equal(await manager.verifyCandidate(candidate), assembled.headRevision);
    await manager.merge(candidate);
    assert.equal((await readFile(path.join(repository, "feature.txt"), "utf8")).replaceAll("\r\n", "\n"), "candidate\n");
    assert.equal((await readFile(path.join(repository, "second.txt"), "utf8")).replaceAll("\r\n", "\n"), "parallel\n");

    const unsafeCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C2");
    await writeFile(path.join(unsafeCandidate.worktreePath, ".env"), "SECRET=do-not-commit\n", "utf8");
    await assert.rejects(() => manager.commit(unsafeCandidate, "unsafe"), /potentially sensitive file/);

    const generatedCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C3");
    await mkdir(path.join(generatedCandidate.worktreePath, ".tmp", "npm-cache"), { recursive: true });
    await writeFile(path.join(generatedCandidate.worktreePath, ".tmp", "npm-cache", "state.json"), "{}\n", "utf8");
    await assert.rejects(() => manager.commit(generatedCandidate, "generated"), /generated tool state/);

    const pnpmCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C4");
    await mkdir(path.join(pnpmCandidate.worktreePath, ".pnpm-store", "v11"), { recursive: true });
    await writeFile(path.join(pnpmCandidate.worktreePath, ".pnpm-store", "v11", "state.json"), "{}\n", "utf8");
    await assert.rejects(() => manager.commit(pnpmCandidate, "pnpm cache"), /generated tool state/);

    const recoveryCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C5");
    await writeFile(path.join(recoveryCandidate.worktreePath, "repair-target.txt"), "committed\n", "utf8");
    const recoveryCommit = await manager.commit(recoveryCandidate, "recorded candidate");
    recoveryCandidate.headRevision = recoveryCommit.headRevision;
    await writeFile(path.join(recoveryCandidate.worktreePath, "repair-target.txt"), "dirty partial repair\n", "utf8");
    await mkdir(path.join(recoveryCandidate.worktreePath, ".pnpm-store", "partial"), { recursive: true });
    await writeFile(path.join(recoveryCandidate.worktreePath, ".pnpm-store", "partial", "state.json"), "{}\n", "utf8");
    assert.equal(await manager.recoverCandidate(recoveryCandidate), true);
    assert.equal((await readFile(path.join(recoveryCandidate.worktreePath, "repair-target.txt"), "utf8")).replaceAll("\r\n", "\n"), "committed\n");
    assert.equal((await git(recoveryCandidate.worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout.trim(), "");

    const cleanupCandidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C6");
    await mkdir(path.join(cleanupCandidate.worktreePath, ".pnpm-store"), { recursive: true });
    await writeFile(path.join(cleanupCandidate.worktreePath, ".pnpm-store", "tracked.json"), "{}\n", "utf8");
    await git(cleanupCandidate.worktreePath, ["add", "-f", ".pnpm-store/tracked.json"]);
    await git(cleanupCandidate.worktreePath, ["commit", "-m", "candidate accidentally tracks generated state"]);
    cleanupCandidate.headRevision = (await git(cleanupCandidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    await rm(path.join(cleanupCandidate.worktreePath, ".pnpm-store", "tracked.json"));
    const cleaned = await manager.commit(cleanupCandidate, "repair removes generated state", { allowGeneratedDeletions: true });
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

test("a symlinked dependency directory is not ignored by git status", async () => {
  // The exclusion in the harness scans exists because of this: `.gitignore` entries such as
  // `node_modules/` match directories, and a symlink named `node_modules` is a file to Git.
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-harness-symlink-ignore-"));
  const repository = path.join(directory, "repository");
  try {
    await git(directory, ["init", "repository"]);
    await writeFile(path.join(repository, ".gitignore"), "node_modules/\n", "utf8");
    await mkdir(path.join(repository, "node_modules", "left-pad"), { recursive: true });
    await writeFile(path.join(repository, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n", "utf8");
    const realStatus = (await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
    assert.doesNotMatch(realStatus, /node_modules/, "a real node_modules directory is ignored");

    await rm(path.join(repository, "node_modules"), { recursive: true, force: true });
    await mkdir(path.join(repository, "installed"), { recursive: true });
    await symlinkDirectory(path.join(repository, "installed"), path.join(repository, "node_modules"));
    const linkStatus = (await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
    assert.match(linkStatus, /^\?\? node_modules$/m, "a symlinked node_modules is NOT ignored, so linking alone is insufficient");
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
      assert.deepEqual(worktree.provisionedDependencyPaths, [".venv", "frontend/node_modules", "node_modules"]);
      // Every provisioned path resolves to the source checkout's installed dependencies.
      assert.equal(
        (await readFile(path.join(worktree.worktreePath, "node_modules", "left-pad", "index.js"), "utf8")).trim(),
        "module.exports = 1;",
      );
      assert.equal(
        (await readFile(path.join(worktree.worktreePath, "frontend", "node_modules", "vite", "index.js"), "utf8")).trim(),
        "module.exports = 2;",
      );
      assert.equal((await readFile(path.join(worktree.worktreePath, ".venv", "pyvenv.cfg"), "utf8")).trim(), "home = /usr");
      assert.equal((await lstat(path.join(worktree.worktreePath, "node_modules"))).isSymbolicLink(), true);
      // Provisioning never writes a lockfile.
      assert.equal((await readFile(path.join(worktree.worktreePath, "package-lock.json"), "utf8")).trim(), '{"lockfileVersion":3}');
      // A clean worktree despite the provisioned dependencies being present.
      assert.equal(await manager.assertWorktreeClean(worktree.worktreePath), true);
    }

    // A simulated Test run: it resolves dependencies through the worktree and writes a
    // report, which is cleaned up afterwards. The worktree is clean on both sides of the run.
    assert.deepEqual(await readdir(path.join(slice.worktreePath, "node_modules")), ["left-pad"]);
    await mkdir(path.join(slice.worktreePath, "test-results"), { recursive: true });
    await writeFile(path.join(slice.worktreePath, "test-results", "report.json"), "{}\n", "utf8");
    await assert.rejects(() => manager.assertWorktreeClean(slice.worktreePath), /uncommitted changes/, "report output is still seen");
    await rm(path.join(slice.worktreePath, "test-results"), { recursive: true, force: true });
    assert.equal(await manager.assertWorktreeClean(slice.worktreePath), true, "clean again after a Test run");

    await writeFile(path.join(slice.worktreePath, "feature.txt"), "implemented\n", "utf8");
    const committed = await manager.commit(slice, "slice with provisioned dependencies");
    assert.equal(await manager.assertWorktreeClean(slice.worktreePath), true, "clean after the commit");
    assert.deepEqual(committed.files, ["feature.txt"], "no provisioned path reaches the commit");
    const tracked = (await git(slice.worktreePath, ["ls-files"])).stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(
      tracked.some((file) => file.startsWith("node_modules") || file.startsWith(".venv") || file.includes("/node_modules")),
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

    const assembled = await manager.assemble(candidate, [{ packageId: "S1", headRevision: committed.headRevision }]);
    candidate.headRevision = assembled.headRevision;
    assert.equal(await manager.verifyCandidate(candidate), assembled.headRevision);

    // Recovery keeps the worktree usable for a rerun instead of stripping its dependencies.
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "dirty\n", "utf8");
    assert.equal(await manager.recoverCandidate(candidate), true);
    assert.equal((await readFile(path.join(candidate.worktreePath, "node_modules", "left-pad", "index.js"), "utf8")).trim(), "module.exports = 1;");
    assert.equal(await manager.recoverCandidate(candidate), false, "a provisioned worktree reads as already recovered");

    // Removal unlinks the provisioned paths and leaves the source dependencies intact.
    const removed = await manager.removeWorktree(candidate);
    assert.deepEqual(removed, [".venv", "frontend/node_modules", "node_modules"]);
    assert.equal(await exists(candidate.worktreePath), false);
    assert.deepEqual(await readdir(path.join(repository, "node_modules")), ["left-pad"]);
    assert.equal((await readFile(path.join(repository, "node_modules", "left-pad", "index.js"), "utf8")).trim(), "module.exports = 1;");
    assert.equal((await readFile(path.join(repository, "frontend", "node_modules", "vite", "index.js"), "utf8")).trim(), "module.exports = 2;");
    assert.equal((await readFile(path.join(repository, ".venv", "pyvenv.cfg"), "utf8")).trim(), "home = /usr");
    await manager.base(task);
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
    await writeFile(path.join(repository, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n", "utf8");

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
  await writeFile(path.join(repository, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n", "utf8");
  await mkdir(path.join(repository, "frontend", "node_modules", "vite"), { recursive: true });
  await writeFile(path.join(repository, "frontend", "node_modules", "vite", "index.js"), "module.exports = 2;\n", "utf8");
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
  return lstat(target).then(() => true).catch(() => false);
}

async function git(cwd, args) {
  return exec("git", args, { cwd, windowsHide: true });
}
