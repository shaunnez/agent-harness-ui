import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 512 * 1024;
const PR_FIELDS = [
  "number",
  "url",
  "state",
  "isDraft",
  "baseRefName",
  "baseRefOid",
  "headRefName",
  "headRefOid",
  "mergedAt",
  "closedAt",
  "mergeCommit",
].join(",");

export class GitHubPullRequestManager {
  #run;

  constructor(options = {}) {
    this.#run = options.run ?? runCommand;
  }

  async publish({ task, candidate, intent = null }) {
    if (!candidate?.headRevision || !candidate?.baseBranch || candidate.baseBranch === "detached") {
      throw new Error("The candidate needs an exact head revision and named target branch before a GitHub PR can be raised.");
    }
    const repository = intent?.repository ?? await this.#repository(candidate.repositoryRoot);
    const headBranch = intent?.headBranch ?? pullRequestBranch(task, candidate);
    const targetBranch = candidate.baseBranch;
    const remoteBaseRevision = await this.#remoteRevision(candidate.repositoryRoot, `refs/heads/${targetBranch}`);
    if (remoteBaseRevision !== candidate.baseRevision) {
      const error = new Error(
        `GitHub target ${targetBranch} advanced from ${candidate.baseRevision.slice(0, 8)} to ${remoteBaseRevision.slice(0, 8)}. Refresh the candidate before raising a PR.`,
      );
      error.code = "GITHUB_TARGET_DIVERGED";
      error.targetRevision = remoteBaseRevision;
      throw error;
    }

    await this.#run("git", ["push", "origin", `${candidate.headRevision}:refs/heads/${headBranch}`], {
      cwd: candidate.worktreePath,
    });
    const remoteHeadRevision = await this.#remoteRevision(candidate.repositoryRoot, `refs/heads/${headBranch}`);
    if (remoteHeadRevision !== candidate.headRevision) {
      throw new Error("The pushed GitHub branch does not match the exact approved candidate revision.");
    }

    let pullRequest = await this.#find(repository, headBranch, targetBranch);
    if (!pullRequest) {
      await this.#run("gh", [
        "pr",
        "create",
        "--repo",
        repository,
        "--base",
        targetBranch,
        "--head",
        headBranch,
        "--title",
        `${task.id}: ${task.title}`.slice(0, 240),
        "--body",
        pullRequestBody(task, candidate, intent?.note ?? ""),
        "--no-maintainer-edit",
      ], { cwd: candidate.worktreePath });
      pullRequest = await this.#find(repository, headBranch, targetBranch);
    }
    if (!pullRequest) throw new Error("GitHub accepted the PR request but the created pull request could not be resolved.");
    return validatePullRequest(pullRequest, {
      repository,
      headBranch,
      targetBranch,
      headRevision: candidate.headRevision,
      baseRevision: candidate.baseRevision,
    });
  }

  async inspect(intent) {
    if (!intent?.repository || !intent?.number) throw new Error("The retained GitHub PR intent is missing its repository or PR number.");
    const result = await this.#run("gh", [
      "pr",
      "view",
      String(intent.number),
      "--repo",
      intent.repository,
      "--json",
      PR_FIELDS,
    ]);
    return validatePullRequest(JSON.parse(result.stdout), {
      repository: intent.repository,
      headBranch: intent.headBranch,
      targetBranch: intent.targetBranch,
      headRevision: intent.headRevision,
    });
  }

  async fetchTarget(candidate) {
    if (!candidate?.baseBranch || candidate.baseBranch === "detached") {
      throw new Error("The candidate does not have a named GitHub target branch.");
    }
    const ref = `refs/heads/${candidate.baseBranch}`;
    const expected = await this.#remoteRevision(candidate.repositoryRoot, ref);
    await this.#run("git", ["fetch", "--no-tags", "origin", ref], { cwd: candidate.worktreePath });
    const fetched = await this.#run("git", ["rev-parse", "FETCH_HEAD"], { cwd: candidate.worktreePath });
    const revision = fetched.stdout.trim().toLowerCase();
    if (revision !== expected) throw new Error("The fetched GitHub target changed while the candidate refresh was being prepared.");
    return revision;
  }

  async #find(repository, headBranch, targetBranch) {
    const result = await this.#run("gh", [
      "pr",
      "list",
      "--repo",
      repository,
      "--head",
      headBranch,
      "--base",
      targetBranch,
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      PR_FIELDS,
    ]);
    const rows = JSON.parse(result.stdout);
    if (!Array.isArray(rows)) throw new Error("GitHub returned an invalid pull request list.");
    return rows.find((row) => row.headRefName === headBranch && row.baseRefName === targetBranch) ?? null;
  }

  async #repository(repositoryRoot) {
    const result = await this.#run("git", ["remote", "get-url", "origin"], { cwd: repositoryRoot });
    return parseGitHubRepository(result.stdout.trim());
  }

  async #remoteRevision(repositoryRoot, ref) {
    const result = await this.#run("git", ["ls-remote", "--exit-code", "origin", ref], { cwd: repositoryRoot });
    const [revision, resolvedRef] = result.stdout.trim().split(/\s+/);
    if (!/^[0-9a-f]{40}$/i.test(revision ?? "") || resolvedRef !== ref) {
      throw new Error(`GitHub remote did not resolve ${ref} to one exact commit.`);
    }
    return revision.toLowerCase();
  }
}

export function parseGitHubRepository(remoteUrl) {
  const value = String(remoteUrl ?? "").trim().replace(/\.git$/, "");
  const match = value.match(/^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[/:]([^/]+\/[^/]+)$/i);
  if (!match) throw new Error("The origin remote is not a supported GitHub repository URL.");
  return match[1];
}

export function pullRequestBranch(task, candidate) {
  const segment = (value) => String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `agent-harness/${segment(task.id)}-${segment(candidate.id)}-r${candidate.revisionNumber}-${candidate.headRevision.slice(0, 8)}`;
}

function pullRequestBody(task, candidate, note) {
  return [
    "## Agent Harness candidate",
    "",
    `- Task: ${task.id}`,
    `- Candidate: ${candidate.id} revision ${candidate.revisionNumber}`,
    `- Exact head: \`${candidate.headRevision}\``,
    `- Qualified base: \`${candidate.baseRevision}\``,
    `- Target: \`${candidate.baseBranch}\``,
    "- Candidate-bound Development Review, Test, and Final Review were fresh when this PR was raised.",
    "",
    note ? `## Human approval note\n\n${note}` : "Approved without an additional note.",
    "",
    `Raised by the local Agent Harness for ${task.id}. The Harness will reconcile this exact PR and complete the task only after GitHub reports it merged.`,
  ].join("\n");
}

function validatePullRequest(row, expected) {
  if (!row || !Number.isInteger(row.number) || !row.url) throw new Error("GitHub returned incomplete pull request identity.");
  if (row.headRefName !== expected.headBranch || row.baseRefName !== expected.targetBranch) {
    throw new Error("The GitHub pull request branch identity does not match the retained approval intent.");
  }
  if (String(row.headRefOid ?? "").toLowerCase() !== String(expected.headRevision).toLowerCase()) {
    throw new Error("The GitHub pull request head moved away from the exact approved candidate revision.");
  }
  if (expected.baseRevision && String(row.baseRefOid ?? "").toLowerCase() !== String(expected.baseRevision).toLowerCase()) {
    const error = new Error("The GitHub target advanced while the pull request was being published. Refresh the candidate before retrying.");
    error.code = "GITHUB_TARGET_DIVERGED";
    error.targetRevision = row.baseRefOid ?? null;
    throw error;
  }
  const state = row.mergedAt ? "merged" : row.state === "OPEN" ? "open" : "closed";
  return {
    repository: expected.repository,
    number: row.number,
    url: row.url,
    state,
    isDraft: Boolean(row.isDraft),
    targetBranch: row.baseRefName,
    targetRevision: row.baseRefOid ?? null,
    headBranch: row.headRefName,
    headRevision: row.headRefOid,
    mergedAt: row.mergedAt ?? null,
    closedAt: row.closedAt ?? null,
    mergeCommitRevision: row.mergeCommit?.oid ?? null,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);
    timeout.unref();
    const collect = (target, chunk) => {
      const next = target + chunk.toString("utf8");
      return next.length > OUTPUT_LIMIT ? next.slice(-OUTPUT_LIMIT) : next;
    };
    child.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk); });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (timedOut) return reject(new Error(`${command} exceeded ${Math.round(timeoutMs / 1_000)} seconds.`));
      if (code === 0) return resolve({ stdout, stderr });
      const detail = stderr.trim() || stdout.trim() || `${command} exited with code ${code}.`;
      reject(new Error(detail));
    });
  });
}
