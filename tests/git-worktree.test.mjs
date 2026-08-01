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
    const candidate = await manager.prepare({ id: "AH-001", repositoryPath: repository }, "C1");
    await writeFile(path.join(candidate.worktreePath, "feature.txt"), "candidate\n", "utf8");
    const committed = await manager.commit(candidate, "candidate");
    candidate.headRevision = committed.headRevision;

    assert.deepEqual(committed.files, ["feature.txt"]);
    assert.match(committed.summary, /feature\.txt/);
    assert.equal(await manager.verifyCandidate(candidate), committed.headRevision);
    await manager.merge(candidate);
    assert.equal((await readFile(path.join(repository, "feature.txt"), "utf8")).replaceAll("\r\n", "\n"), "candidate\n");

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
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function git(cwd, args) {
  return exec("git", args, { cwd, windowsHide: true });
}
