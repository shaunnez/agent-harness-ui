import { realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { runProcess } from "./process-runtime.mjs";

const SHA_PATTERN = /^[a-f0-9]{40,64}$/i;

export class RepositoryAuthorityService {
  constructor(options = {}) {
    this._runProcess = options.runProcess ?? runProcess;
    this._now = options.now ?? (() => new Date().toISOString());
    this._fetchTimeoutMs = options.fetchTimeoutMs ?? 60_000;
  }

  async capture(repositoryPath, options = {}) {
    const repositoryRoot = await this.#gitText(repositoryPath, ["rev-parse", "--show-toplevel"]);
    const canonicalRoot = await realpath(repositoryRoot).catch(() => path.resolve(repositoryRoot));
    const [localHead, checkoutBranch, dirtyOutput] = await Promise.all([
      this.#gitText(canonicalRoot, ["rev-parse", "HEAD"]),
      this.#gitText(canonicalRoot, ["branch", "--show-current"]),
      this.#gitText(canonicalRoot, ["status", "--porcelain=v1", "--untracked-files=normal"]),
    ]);
    if (!SHA_PATTERN.test(localHead)) throw new Error("Repository HEAD did not resolve to a commit SHA.");

    const capturedAt = this._now();
    const localBranchRef = checkoutBranch ? `refs/heads/${checkoutBranch}` : null;
    if (options.frozenRevision) {
      const frozenRevision = await this.#gitText(canonicalRoot, [
        "rev-parse",
        "--verify",
        `${options.frozenRevision}^{commit}`,
      ]);
      return {
        id: crypto.randomUUID(),
        repositoryRoot: canonicalRoot,
        checkoutBranch: checkoutBranch || null,
        localBranchRef,
        localHead,
        upstreamBranch: null,
        upstreamRef: null,
        fetchedRevision: null,
        selectedRevision: frozenRevision,
        targetRef: `commit:${frozenRevision}`,
        source: "frozen-experiment",
        checkoutDirty: Boolean(dirtyOutput),
        relationship: localHead === frozenRevision ? "equal" : "unknown",
        capturedAt,
        remoteVerification: { status: "not-applicable", error: null },
      };
    }

    const upstreamBranch = checkoutBranch
      ? await this.#gitOptional(canonicalRoot, [
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{upstream}",
        ])
      : null;
    const upstreamRef = checkoutBranch
      ? await this.#gitOptional(canonicalRoot, ["rev-parse", "--symbolic-full-name", "@{upstream}"])
      : null;

    if (!upstreamBranch || !upstreamRef) {
      return {
        id: crypto.randomUUID(),
        repositoryRoot: canonicalRoot,
        checkoutBranch: checkoutBranch || null,
        localBranchRef,
        localHead,
        upstreamBranch: null,
        upstreamRef: null,
        fetchedRevision: null,
        selectedRevision: localHead,
        targetRef: localBranchRef ?? `commit:${localHead}`,
        source: "local-head",
        checkoutDirty: Boolean(dirtyOutput),
        relationship: "equal",
        capturedAt,
        remoteVerification: { status: "not-configured", error: null },
      };
    }

    const separator = upstreamBranch.indexOf("/");
    const remote = separator > 0 ? upstreamBranch.slice(0, separator) : null;
    const remoteBranch = separator > 0 ? upstreamBranch.slice(separator + 1) : null;
    if (!remote || !remoteBranch) {
      return this.#unverifiedTrackedAuthority({
        canonicalRoot,
        checkoutBranch,
        localBranchRef,
        localHead,
        upstreamBranch,
        upstreamRef,
        dirtyOutput,
        capturedAt,
        error: "The tracked upstream could not be resolved to a remote branch.",
      });
    }

    const fetch = await this.#git(canonicalRoot, [
      "fetch",
      "--no-tags",
      remote,
      `+refs/heads/${remoteBranch}:${upstreamRef}`,
    ]);
    if (fetch.code !== 0) {
      return this.#unverifiedTrackedAuthority({
        canonicalRoot,
        checkoutBranch,
        localBranchRef,
        localHead,
        upstreamBranch,
        upstreamRef,
        dirtyOutput,
        capturedAt,
        error: fetch.stderr.trim() || `git fetch exited with code ${fetch.code}.`,
      });
    }

    const fetchedRevision = await this.#gitText(canonicalRoot, [
      "rev-parse",
      "--verify",
      `${upstreamRef}^{commit}`,
    ]);
    return {
      id: crypto.randomUUID(),
      repositoryRoot: canonicalRoot,
      checkoutBranch: checkoutBranch || null,
      localBranchRef,
      localHead,
      upstreamBranch,
      upstreamRef,
      fetchedRevision,
      selectedRevision: fetchedRevision,
      targetRef: upstreamRef,
      source: "tracked-upstream",
      checkoutDirty: Boolean(dirtyOutput),
      relationship: await this.#relationship(canonicalRoot, localHead, fetchedRevision),
      capturedAt,
      remoteVerification: { status: "verified", error: null },
    };
  }

  #unverifiedTrackedAuthority({
    canonicalRoot,
    checkoutBranch,
    localBranchRef,
    localHead,
    upstreamBranch,
    upstreamRef,
    dirtyOutput,
    capturedAt,
    error,
  }) {
    return {
      id: crypto.randomUUID(),
      repositoryRoot: canonicalRoot,
      checkoutBranch: checkoutBranch || null,
      localBranchRef,
      localHead,
      upstreamBranch,
      upstreamRef,
      fetchedRevision: null,
      selectedRevision: localHead,
      targetRef: upstreamRef,
      source: "local-head",
      checkoutDirty: Boolean(dirtyOutput),
      relationship: "unknown",
      capturedAt,
      remoteVerification: { status: "failed", error: String(error).slice(0, 2_000) },
    };
  }

  async #relationship(repositoryRoot, localHead, fetchedRevision) {
    if (localHead === fetchedRevision) return "equal";
    if (
      (await this.#git(repositoryRoot, ["merge-base", "--is-ancestor", localHead, fetchedRevision])).code ===
      0
    )
      return "behind";
    if (
      (await this.#git(repositoryRoot, ["merge-base", "--is-ancestor", fetchedRevision, localHead])).code ===
      0
    )
      return "ahead";
    return "diverged";
  }

  async #gitOptional(cwd, args) {
    const result = await this.#git(cwd, args);
    return result.code === 0 ? result.stdout.trim() || null : null;
  }

  async #gitText(cwd, args) {
    const result = await this.#git(cwd, args);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `git ${args[0]} exited with code ${result.code}.`);
    }
    return result.stdout.trim();
  }

  #git(cwd, args) {
    return this._runProcess("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: this._fetchTimeoutMs,
      label: "Repository authority",
      stdoutBudgetBytes: 512 * 1024,
    });
  }
}

export function authorityBinding(authority) {
  if (!authority) return {};
  return {
    repositoryAuthorityId: authority.id,
    repositoryRevision: authority.selectedRevision,
    repositoryTargetRef: authority.targetRef,
    repositoryAuthorityCheckedAt: authority.capturedAt,
  };
}

export function sameAuthorityTarget(planBinding, authority) {
  return Boolean(
    planBinding?.repositoryRevision &&
      planBinding.repositoryRevision === authority?.selectedRevision &&
      planBinding.repositoryTargetRef === authority?.targetRef,
  );
}
