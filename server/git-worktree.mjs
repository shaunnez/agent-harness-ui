import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const OUTPUT_LIMIT = 512 * 1024;

export class GitWorktreeManager {
  #root;
  #prepareQueue = Promise.resolve();

  constructor(root) {
    this.#root = path.resolve(root);
  }

  async base(task) {
    const repositoryRoot = await this.repositoryRoot(task.repositoryPath);
    await assertClean(repositoryRoot);
    return {
      repositoryRoot,
      baseRevision: (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim(),
      baseBranch: (await git(repositoryRoot, ["branch", "--show-current"])).stdout.trim() || "detached",
    };
  }

  prepare(task, candidateId, options = {}) {
    const run = () => this.#prepare(task, candidateId, options);
    const pending = this.#prepareQueue.then(run, run);
    this.#prepareQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async #prepare(task, candidateId, options = {}) {
    const repositoryRoot = await this.repositoryRoot(task.repositoryPath);
    await assertClean(repositoryRoot);
    const sourceRevision = (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
    const baseRevision = options.baseRevision ?? sourceRevision;
    if (sourceRevision !== baseRevision) {
      throw new Error("The source checkout moved after implementation scheduling began.");
    }
    const baseBranch = (await git(repositoryRoot, ["branch", "--show-current"])).stdout.trim() || "detached";
    const branch = `agent-harness/${task.id.toLowerCase()}-${safeSegment(options.branchId ?? candidateId).toLowerCase()}`;
    const branchCheck = await git(repositoryRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      allowFailure: true,
    });
    if (branchCheck.code === 0) throw new Error(`The candidate branch ${branch} already exists. Remove it manually or start a new task.`);

    const worktreePath = path.resolve(this.#root, safeSegment(task.id), safeSegment(candidateId));
    if (!worktreePath.startsWith(`${this.#root}${path.sep}`)) throw new Error("The resolved worktree path escaped harness storage.");
    if (await stat(worktreePath).then(() => true).catch(() => false)) {
      throw new Error(`The candidate worktree already exists at ${worktreePath}.`);
    }
    await mkdir(path.dirname(worktreePath), { recursive: true });
    await git(repositoryRoot, ["worktree", "add", "-b", branch, worktreePath, baseRevision]);
    for (const dependencyRevision of options.dependencyRevisions ?? []) {
      try {
        await git(worktreePath, ["cherry-pick", dependencyRevision]);
      } catch (error) {
        await git(worktreePath, ["cherry-pick", "--abort"], { allowFailure: true });
        throw new Error(`Could not prepare ${candidateId} with dependency ${dependencyRevision.slice(0, 8)}: ${error.message}`);
      }
    }
    return {
      id: candidateId,
      revisionNumber: 1,
      baseRevision,
      baseBranch,
      headRevision: null,
      branch,
      repositoryRoot,
      worktreePath,
      status: "implementing",
      dependencyRevisions: options.dependencyRevisions ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revisions: [],
    };
  }

  async commit(candidate, message, options = {}) {
    const status = (await git(candidate.worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout;
    const entries = statusEntries(status);
    const files = entries.map((entry) => entry.file);
    if (!files.length) throw new Error("The implementation agent completed without changing any files.");
    const suspicious = files.find(isSensitivePath);
    if (suspicious) throw new Error(`Candidate contains a potentially sensitive file (${suspicious}); it was preserved but not committed.`);
    const generated = entries.find(
      (entry) => isGeneratedPath(entry.file) && !(options.allowGeneratedDeletions && entry.code.trim() === "D"),
    );
    if (generated) {
      throw new Error(
        `Candidate contains generated tool state (${generated.file}); remove generated caches and browser/test output before retrying.`,
      );
    }

    const parentRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    await git(candidate.worktreePath, ["add", "-A"]);
    await git(candidate.worktreePath, ["commit", "-m", message]);
    const headRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    const summary = (await git(candidate.worktreePath, ["diff", "--stat", candidate.baseRevision, headRevision])).stdout.trim();
    const diff = (await git(candidate.worktreePath, ["diff", "--no-ext-diff", "--unified=3", candidate.baseRevision, headRevision])).stdout;
    const ownSummary = (await git(candidate.worktreePath, ["diff", "--stat", parentRevision, headRevision])).stdout.trim();
    const ownDiff = (await git(candidate.worktreePath, ["diff", "--no-ext-diff", "--unified=3", parentRevision, headRevision])).stdout;
    return {
      headRevision,
      parentRevision,
      files,
      summary,
      diff: diff.slice(0, 300_000),
      ownSummary,
      ownDiff: ownDiff.slice(0, 300_000),
    };
  }

  async assemble(candidate, members) {
    if (!members.length) throw new Error("An integration candidate needs at least one work-package commit.");
    for (const member of members) {
      try {
        await git(candidate.worktreePath, ["cherry-pick", member.headRevision]);
      } catch (error) {
        await git(candidate.worktreePath, ["cherry-pick", "--abort"], { allowFailure: true });
        throw new Error(`Candidate assembly conflicted while applying ${member.packageId}: ${error.message}`);
      }
    }
    await assertClean(candidate.worktreePath);
    const headRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    const summary = (await git(candidate.worktreePath, ["diff", "--stat", candidate.baseRevision, headRevision])).stdout.trim();
    const diff = (await git(candidate.worktreePath, ["diff", "--no-ext-diff", "--unified=3", candidate.baseRevision, headRevision])).stdout;
    const files = (await git(candidate.worktreePath, ["diff", "--name-only", candidate.baseRevision, headRevision])).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    return { headRevision, files, summary, diff: diff.slice(0, 300_000) };
  }

  async merge(candidate) {
    const repositoryRoot = await this.repositoryRoot(candidate.repositoryRoot);
    await assertClean(repositoryRoot);
    const currentRevision = (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
    if (currentRevision !== candidate.baseRevision) {
      throw new Error("The source branch moved after this candidate was created. Rebase or recreate the candidate before merging.");
    }
    const candidateRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    if (candidateRevision !== candidate.headRevision) {
      throw new Error("The candidate worktree no longer matches the reviewed revision.");
    }
    await git(repositoryRoot, ["merge", "--ff-only", candidate.headRevision]);
    return candidate.headRevision;
  }

  async verifyCandidate(candidate) {
    const worktreeRoot = await this.repositoryRoot(candidate.worktreePath);
    if (worktreeRoot !== path.resolve(candidate.worktreePath)) {
      throw new Error("The candidate worktree no longer resolves to its recorded path.");
    }
    await assertClean(worktreeRoot);
    const headRevision = (await git(worktreeRoot, ["rev-parse", "HEAD"])).stdout.trim();
    if (!candidate.headRevision || headRevision !== candidate.headRevision) {
      throw new Error("The candidate worktree no longer matches its recorded revision.");
    }
    return headRevision;
  }

  async recoverCandidate(candidate) {
    const worktreePath = path.resolve(candidate.worktreePath);
    if (!worktreePath.startsWith(`${this.#root}${path.sep}`)) {
      throw new Error("Candidate recovery refused a worktree outside harness storage.");
    }
    const worktreeRoot = await this.repositoryRoot(worktreePath);
    if (worktreeRoot !== worktreePath) throw new Error("Candidate recovery could not verify the recorded worktree root.");
    if (!candidate.headRevision) throw new Error("Candidate recovery requires a recorded revision.");
    const currentHead = (await git(worktreeRoot, ["rev-parse", "HEAD"])).stdout.trim();
    const status = (await git(worktreeRoot, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout.trim();
    if (currentHead === candidate.headRevision && !status) return false;
    if (currentHead !== candidate.headRevision) {
      await git(worktreeRoot, ["reset", "--mixed", candidate.headRevision]);
    }
    await git(worktreeRoot, ["restore", "--source", candidate.headRevision, "--staged", "--worktree", "--", "."]);
    await git(worktreeRoot, ["clean", "-fdx"]);
    await assertClean(worktreeRoot);
    const recoveredHead = (await git(worktreeRoot, ["rev-parse", "HEAD"])).stdout.trim();
    if (recoveredHead !== candidate.headRevision) throw new Error("Candidate recovery did not restore the recorded revision.");
    return true;
  }

  async inventory(entries = []) {
    const rows = [];
    for (const entry of entries) {
      rows.push(await this.#inventoryRow(entry));
    }
    return rows;
  }

  async #inventoryRow(entry) {
    const worktreePath = path.resolve(entry.worktreePath);
    const exists = await stat(worktreePath)
      .then((result) => result.isDirectory())
      .catch(() => false);
    let headRevision = null;
    let clean = false;
    let repositoryRoot = null;
    if (exists) {
      try {
        repositoryRoot = await this.repositoryRoot(worktreePath);
        headRevision = (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
        const status = (await git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=normal"])).stdout.trim();
        clean = !status;
      } catch {
        clean = false;
      }
    }
    const lifecycleState = normalizeLifecycleState(entry.lifecycleState);
    const currentState = !exists
      ? "stale"
      : lifecycleState === "active" || lifecycleState === "running"
        ? "active"
        : lifecycleState === "stale" || lifecycleState === "missing"
          ? "stale"
          : "retained";
    return {
      id: entry.id ?? `${entry.kind}:${entry.taskId}:${entry.workPackageId ?? worktreePath}`,
      kind: entry.kind,
      taskId: entry.taskId,
      workPackageId: entry.workPackageId ?? null,
      label: entry.label,
      worktreePath,
      branch: entry.branch ?? null,
      baseRevision: entry.baseRevision ?? null,
      headRevision: entry.headRevision ?? null,
      recordedHeadRevision: entry.recordedHeadRevision ?? entry.headRevision ?? null,
      gitExists: exists,
      gitHeadRevision: headRevision,
      gitClean: exists ? clean : null,
      lifecycleState,
      currentState,
      cleanupReady: Boolean(exists && clean && currentState !== "active"),
    };
  }

  async repositoryRoot(repositoryPath) {
    const result = await git(repositoryPath, ["rev-parse", "--show-toplevel"]);
    return path.resolve(result.stdout.trim());
  }
}

function normalizeLifecycleState(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replaceAll("_", "-");
  if (["active", "running", "retained", "stale", "missing", "cleaning", "ready"].includes(normalized)) return normalized;
  return "retained";
}

async function assertClean(repositoryRoot) {
  const status = (await git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=normal"])).stdout.trim();
  if (status) throw new Error("The selected repository has uncommitted changes. Commit or stash them before creating or merging a candidate.");
}

function changedFiles(status) {
  return statusEntries(status).map((entry) => entry.file);
}

function statusEntries(status) {
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2),
      file: line.slice(3).split(" -> ").at(-1)?.replace(/^\"|\"$/g, "") ?? "",
    }))
    .filter((entry) => entry.file);
}

function isSensitivePath(file) {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  const name = normalized.split("/").at(-1) ?? normalized;
  return (
    (name.startsWith(".env") && !name.endsWith(".example") && !name.endsWith(".sample")) ||
    name.endsWith(".pem") ||
    name.endsWith(".p12") ||
    name.endsWith(".pfx") ||
    name === "id_rsa" ||
    name === "id_ed25519"
  );
}

function isGeneratedPath(file) {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  return [
    ".tmp/",
    ".pnpm-store/",
    ".playwright-cli/",
    ".data/",
    ".cache/",
    ".npm/",
    "node_modules/",
    "playwright-report/",
    "test-results/",
    "coverage/",
  ].some((segment) => normalized === segment.slice(0, -1) || normalized.startsWith(segment));
}

function safeSegment(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, "-").slice(0, 80);
}

function git(cwd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-OUTPUT_LIMIT);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-OUTPUT_LIMIT);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code === 0 || options.allowFailure) resolve(result);
      else reject(new Error(stderr.trim() || `git ${args[0]} failed with code ${result.code}.`));
    });
  });
}
