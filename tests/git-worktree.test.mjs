import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { GitWorktreeManager } from "../server/git-worktree.mjs";

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
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function git(cwd, args) {
  return exec("git", args, { cwd, windowsHide: true });
}
