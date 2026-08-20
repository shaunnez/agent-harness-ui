import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isOwnedFile } from "./structured-output.mjs";

const OUTPUT_LIMIT = 512 * 1024;

/**
 * Where candidate worktrees live, and why it is deliberately short and outside the
 * repository.
 *
 * Every character of a candidate's path is paid for repeatedly: on macOS the Bash tool
 * inlines the whole seatbelt profile on the command line, and each deny path expands into
 * a rule per ancestor component, so the cwd's prefix is carried by thousands of rules.
 * Measured on this repository at a fixed worktree count — two registered worktrees, one at
 * a 9-char path and one at 81 chars — the difference was 197,130 exec argument bytes,
 * ≈2,738 B/char, which is 13 worktrees of headroom against a 1 MB ceiling. The old default
 * (`<repo>/.data/worktrees/<task>/<candidate>`) spent that for no benefit: nothing requires
 * a candidate to live inside the checkout it came from. Sweep and numbers in
 * `docs/claude-execution-provider-design.md`.
 *
 * Being outside the repository is a second, smaller win — the operator's checkout no longer
 * contains the harness's working directories at all, so nothing depends on `.data/` staying
 * ignored for status to read clean.
 *
 * `AGENT_HARNESS_WORKTREE_ROOT` overrides it. Shorter is cheaper; a long override is
 * allowed because the preflight in `claude-exec-budget.mjs` measures the consequence rather
 * than assuming it, and it will refuse a stage before the ceiling is crossed.
 */
export function defaultWorktreeRoot(environment = process.env) {
  const configured = environment.AGENT_HARNESS_WORKTREE_ROOT;
  if (configured) return path.resolve(configured);
  return path.join(os.homedir(), ".ah", "w");
}

// Harness worktrees come from `git worktree add`, which copies no installed dependencies.
// Each new worktree is provisioned from the source checkout's own dependency
// directories, so the Test stage can run commands that need them without any package
// manager running and without any lockfile changing.
const DEPENDENCY_DIRECTORY_NAMES = ["node_modules", ".venv", "venv", ".tox", "vendor"];
const DEPENDENCY_SCAN_DEPTH = 4;
const PROVISION_MANIFEST = "agent-harness-provisioned-dependencies.json";

export class GitWorktreeManager {
  #root;
  #prepareQueue = Promise.resolve();

  constructor(root) {
    this.#root = path.resolve(root);
  }

  async base(task, options = {}) {
    const repositoryRoot = await this.repositoryRoot(task.repositoryPath);
    if (!options.allowDirty) await assertClean(repositoryRoot);
    const baseBranch = (await git(repositoryRoot, ["branch", "--show-current"])).stdout.trim() || "detached";
    return {
      repositoryRoot,
      baseRevision: (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim(),
      baseBranch,
      baseRef: baseBranch === "detached" ? null : `refs/heads/${baseBranch}`,
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

  ensureCandidate(candidate) {
    const run = () => this.#ensureCandidate(candidate);
    const pending = this.#prepareQueue.then(run, run);
    this.#prepareQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async #ensureCandidate(candidate) {
    const repositoryRoot = await this.repositoryRoot(candidate.repositoryRoot);
    const worktreePath = path.resolve(candidate.worktreePath);
    if (!worktreePath.startsWith(`${this.#root}${path.sep}`)) {
      throw new Error("Candidate recovery refused a worktree outside harness storage.");
    }
    if (
      await stat(worktreePath)
        .then((result) => result.isDirectory())
        .catch(() => false)
    ) {
      return false;
    }
    if (!candidate.headRevision || !candidate.branch) {
      throw new Error("Candidate recovery requires a recorded branch and revision.");
    }
    const branchRef = `refs/heads/${candidate.branch}`;
    const branchResult = await git(repositoryRoot, ["rev-parse", "--verify", branchRef], {
      allowFailure: true,
    });
    if (branchResult.code !== 0 || branchResult.stdout.trim() !== candidate.headRevision) {
      throw new Error("Candidate recovery refused a branch that no longer matches its recorded revision.");
    }
    const commitResult = await git(repositoryRoot, ["cat-file", "-e", `${candidate.headRevision}^{commit}`], {
      allowFailure: true,
    });
    if (commitResult.code !== 0) {
      throw new Error("Candidate recovery could not find its recorded revision.");
    }
    await mkdir(path.dirname(worktreePath), { recursive: true });
    try {
      await git(repositoryRoot, ["worktree", "add", worktreePath, candidate.branch]);
      await provisionDependencies(repositoryRoot, worktreePath);
      await this.verifyCandidate(candidate);
    } catch (error) {
      await deprovisionDependencies(worktreePath).catch(() => []);
      await git(repositoryRoot, ["worktree", "remove", "--force", worktreePath], {
        allowFailure: true,
      });
      throw error;
    }
    return true;
  }

  async #prepare(task, candidateId, options = {}) {
    const repositoryRoot = await this.repositoryRoot(task.repositoryPath);
    if (!options.allowHistoricalBase && !options.allowDirtySource) await assertClean(repositoryRoot);
    const sourceRevision = (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
    const baseRevision = options.baseRevision ?? sourceRevision;
    if (sourceRevision !== baseRevision && !options.allowHistoricalBase) {
      throw new Error("The source checkout moved after implementation scheduling began.");
    }
    if (options.allowHistoricalBase) {
      const retainedBase = await git(repositoryRoot, ["cat-file", "-e", `${baseRevision}^{commit}`], {
        allowFailure: true,
      });
      if (retainedBase.code !== 0)
        throw new Error("The retained implementation base is no longer available in the repository.");
    }
    const baseBranch = (await git(repositoryRoot, ["branch", "--show-current"])).stdout.trim() || "detached";
    const baseRef = baseBranch === "detached" ? null : `refs/heads/${baseBranch}`;
    const branch = `agent-harness/${task.id.toLowerCase()}-${safeSegment(options.branchId ?? candidateId).toLowerCase()}`;
    const branchCheck = await git(
      repositoryRoot,
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      {
        allowFailure: true,
      },
    );
    if (branchCheck.code === 0)
      throw new Error(
        `The candidate branch ${branch} already exists. Remove it manually or start a new task.`,
      );

    const worktreePath = path.resolve(this.#root, safeSegment(task.id), safeSegment(candidateId));
    if (!worktreePath.startsWith(`${this.#root}${path.sep}`))
      throw new Error("The resolved worktree path escaped harness storage.");
    if (
      await stat(worktreePath)
        .then(() => true)
        .catch(() => false)
    ) {
      throw new Error(`The candidate worktree already exists at ${worktreePath}.`);
    }
    await mkdir(path.dirname(worktreePath), { recursive: true });
    await git(repositoryRoot, ["worktree", "add", "-b", branch, worktreePath, baseRevision]);
    const provisionedDependencyPaths = await provisionDependencies(repositoryRoot, worktreePath);
    for (const dependencyRevision of options.dependencyRevisions ?? []) {
      // A dependency work package that legitimately made no changes has no commit to
      // bring in; the base revision already reflects that outcome.
      if (!dependencyRevision) continue;
      try {
        await git(worktreePath, ["cherry-pick", dependencyRevision]);
      } catch (error) {
        await git(worktreePath, ["cherry-pick", "--abort"], { allowFailure: true });
        throw new Error(
          `Could not prepare ${candidateId} with dependency ${dependencyRevision.slice(0, 8)}: ${error.message}`,
        );
      }
    }
    // Cherry-picking a dependency advances the worktree past `baseRevision`, so the base alone no
    // longer describes where the slice actually starts. Reported explicitly because the caller
    // needs it to pin verification evidence: a dependent slice that commits nothing of its own is
    // still sitting on its predecessor's commit, and claiming the base for it attributes evidence
    // to a revision that is not checked out.
    const preparedRevision = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    return {
      id: candidateId,
      revisionNumber: 1,
      baseRevision,
      preparedRevision,
      baseBranch,
      baseRef,
      headRevision: null,
      branch,
      repositoryRoot,
      worktreePath,
      status: "implementing",
      provisionedDependencyPaths,
      dependencyRevisions: options.dependencyRevisions ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revisions: [],
    };
  }

  async commit(candidate, message, options = {}) {
    if (options.squashFromBase) {
      const currentHead = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
      const retainedHead = candidate.headRevision ?? currentHead;
      const retainedHeadIsAncestor = await git(
        candidate.worktreePath,
        ["merge-base", "--is-ancestor", retainedHead, currentHead],
        {
          allowFailure: true,
        },
      );
      const retainedParent = await git(candidate.worktreePath, ["rev-parse", `${retainedHead}^`], {
        allowFailure: true,
      });
      const squashBase = retainedParent.code === 0 ? retainedParent.stdout.trim() : candidate.baseRevision;
      const baseIsAncestor = await git(
        candidate.worktreePath,
        ["merge-base", "--is-ancestor", candidate.baseRevision, squashBase],
        {
          allowFailure: true,
        },
      );
      if (retainedHeadIsAncestor.code !== 0 || baseIsAncestor.code !== 0 || currentHead === squashBase) {
        throw new Error(
          "The retained package cannot be squashed because its recorded revision is not on the current package lineage.",
        );
      }
      // A dependent slice starts above its dependency commits. Rebuild only the
      // retained package commit and its continuation edits; resetting to the target
      // base would incorrectly attribute dependency files to this package's ownership.
      await git(candidate.worktreePath, ["reset", "--mixed", squashBase]);
    }
    const provisioned = await provisionedDependencies(candidate.worktreePath);
    const status = (await git(candidate.worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"]))
      .stdout;
    const entries = statusEntries(status).filter((entry) => !isProvisionedPath(entry.file, provisioned));
    const files = entries.map((entry) => entry.file);
    if (!files.length) {
      // A caller that has independently confirmed the agent declared this a legitimate
      // no-op (see `parseNoChangesNeeded` in orchestrator.mjs) accepts an empty diff as
      // success rather than the harness assuming every implementation run must produce
      // one. Every other caller keeps the original guard: a silent empty diff still
      // means a stuck or broken run.
      if (options.allowNoChanges) {
        // No commit exists to hand back: `headRevision: null` mirrors the unattempted
        // state a work package starts in, so assembly and dependent slices treat this
        // exactly like "nothing to bring in" rather than cherry-picking a revision that
        // is merely an ancestor already in their history.
        return {
          headRevision: null,
          parentRevision: null,
          files: [],
          summary: "",
          diff: "",
          ownSummary: "",
          ownDiff: "",
          noChangesNeeded: true,
        };
      }
      throw new Error("The implementation agent completed without changing any files.");
    }
    const suspicious = files.find(isSensitivePath);
    if (suspicious)
      throw new Error(
        `Candidate contains a potentially sensitive file (${suspicious}); it was preserved but not committed.`,
      );
    const generated = entries.find(
      (entry) =>
        isGeneratedPath(entry.file) && !(options.allowGeneratedDeletions && entry.code.trim() === "D"),
    );
    if (generated) {
      throw new Error(
        `Candidate contains generated tool state (${generated.file}); remove generated caches and browser/test output before retrying.`,
      );
    }
    if (options.ownedPaths) {
      const outOfScope = files.find((file) => !isOwnedFile(file, options.ownedPaths));
      if (outOfScope) {
        throw new Error(
          `Candidate changed ${outOfScope}, which is outside the work package ownership (${options.ownedPaths.join(", ")}).`,
        );
      }
    }

    const parentRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    await git(candidate.worktreePath, [
      "add",
      "-A",
      "--",
      ".",
      ...(await excludePathspecs(candidate.worktreePath, provisioned)),
    ]);
    await git(candidate.worktreePath, ["commit", "-m", message]);
    const headRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    const summary = (
      await git(candidate.worktreePath, ["diff", "--stat", candidate.baseRevision, headRevision])
    ).stdout.trim();
    const diff = (
      await git(candidate.worktreePath, [
        "diff",
        "--no-ext-diff",
        "--unified=3",
        candidate.baseRevision,
        headRevision,
      ])
    ).stdout;
    const ownSummary = (
      await git(candidate.worktreePath, ["diff", "--stat", parentRevision, headRevision])
    ).stdout.trim();
    const ownDiff = (
      await git(candidate.worktreePath, [
        "diff",
        "--no-ext-diff",
        "--unified=3",
        parentRevision,
        headRevision,
      ])
    ).stdout;
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
      // A work package that legitimately made no changes (`commit`'s `allowNoChanges`
      // path) has no commit to bring in: the base revision every member branched from
      // already reflects that outcome.
      if (!member.headRevision) continue;
      try {
        await git(candidate.worktreePath, ["cherry-pick", member.headRevision]);
      } catch (error) {
        await git(candidate.worktreePath, ["cherry-pick", "--abort"], { allowFailure: true });
        throw new Error(`Candidate assembly conflicted while applying ${member.packageId}: ${error.message}`);
      }
    }
    await assertClean(candidate.worktreePath);
    const headRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    const summary = (
      await git(candidate.worktreePath, ["diff", "--stat", candidate.baseRevision, headRevision])
    ).stdout.trim();
    const diff = (
      await git(candidate.worktreePath, [
        "diff",
        "--no-ext-diff",
        "--unified=3",
        candidate.baseRevision,
        headRevision,
      ])
    ).stdout;
    const files = (
      await git(candidate.worktreePath, ["diff", "--name-only", candidate.baseRevision, headRevision])
    ).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    return { headRevision, files, summary, diff: diff.slice(0, 300_000) };
  }

  async merge(candidate) {
    const repositoryRoot = await this.repositoryRoot(candidate.repositoryRoot);
    await assertClean(repositoryRoot);
    const currentRevision = (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
    if (currentRevision !== candidate.baseRevision) {
      throw new Error(
        "The source branch moved after this candidate was created. Rebase or recreate the candidate before merging.",
      );
    }
    const targetRef =
      candidate.baseRef ??
      (candidate.baseBranch && candidate.baseBranch !== "detached"
        ? `refs/heads/${candidate.baseBranch}`
        : null);
    const currentRefResult = await git(repositoryRoot, ["symbolic-ref", "--quiet", "HEAD"], {
      allowFailure: true,
    });
    const currentRef = currentRefResult.code === 0 ? currentRefResult.stdout.trim() : null;
    if (!targetRef || currentRef !== targetRef) {
      throw new Error("The checked-out target branch no longer matches the candidate's recorded target ref.");
    }
    const candidateRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    if (candidateRevision !== candidate.headRevision) {
      throw new Error("The candidate worktree no longer matches the reviewed revision.");
    }
    await git(repositoryRoot, ["merge", "--ff-only", candidate.headRevision]);
    return candidate.headRevision;
  }

  async mergeState(candidate) {
    const repositoryRoot = await this.repositoryRoot(candidate.repositoryRoot);
    const targetRef =
      candidate.baseRef ??
      (candidate.baseBranch && candidate.baseBranch !== "detached"
        ? `refs/heads/${candidate.baseBranch}`
        : null);
    if (!targetRef) throw new Error("The candidate does not have a recorded target ref.");
    const candidateRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    if (!candidate.headRevision || candidateRevision !== candidate.headRevision) {
      throw new Error("The candidate worktree no longer matches the reviewed revision.");
    }
    const targetResult = await git(repositoryRoot, ["rev-parse", "--verify", targetRef], {
      allowFailure: true,
    });
    if (targetResult.code !== 0) throw new Error("The candidate target ref no longer exists.");
    const targetRevision = targetResult.stdout.trim();
    if (targetRevision === candidate.headRevision) return "merged";
    if (targetRevision === candidate.baseRevision) return "pending";
    return "diverged";
  }

  async refreshCandidate(candidate, options = {}) {
    const repositoryRoot = await this.repositoryRoot(candidate.repositoryRoot);
    await this.verifyCandidate(candidate);
    const targetRef =
      candidate.baseRef ??
      (candidate.baseBranch && candidate.baseBranch !== "detached"
        ? `refs/heads/${candidate.baseBranch}`
        : null);
    if (!targetRef) throw new Error("The candidate does not have a recorded target ref.");
    const targetResult = options.targetRevision
      ? await git(repositoryRoot, ["cat-file", "-e", `${options.targetRevision}^{commit}`], {
          allowFailure: true,
        })
      : await git(repositoryRoot, ["rev-parse", "--verify", targetRef], { allowFailure: true });
    if (targetResult.code !== 0) throw new Error("The candidate target revision no longer exists.");
    const targetRevision = options.targetRevision ?? targetResult.stdout.trim();
    if (targetRevision === candidate.baseRevision) {
      throw new Error("The candidate already starts from the current target revision.");
    }
    if (targetRevision === candidate.headRevision) {
      throw new Error("The candidate is already present on the target branch.");
    }
    const targetAdvanced = await git(
      repositoryRoot,
      ["merge-base", "--is-ancestor", candidate.baseRevision, targetRevision],
      {
        allowFailure: true,
      },
    );
    if (targetAdvanced.code !== 0) {
      throw new Error(
        "The target branch history was rewritten; recreate the candidate instead of refreshing it automatically.",
      );
    }

    // The target may have received the same patch independently (for example, a
    // harness repair was committed directly after a retained candidate was built).
    // Rebasing an equivalent patch can conflict even though there is nothing left to
    // replay. `git cherry` compares patch identities, so only an exact all-applied
    // candidate is collapsed onto the target; mixed or genuinely conflicting
    // candidates still take the ordinary rebase path and fail closed on conflict.
    const candidateCommits = (
      await git(candidate.worktreePath, [
        "rev-list",
        "--reverse",
        `${candidate.baseRevision}..${candidate.headRevision}`,
      ])
    ).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    const cherryRows = (
      await git(candidate.worktreePath, ["cherry", targetRevision, candidate.headRevision])
    ).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    const targetContainsHead =
      (
        await git(repositoryRoot, ["merge-base", "--is-ancestor", candidate.headRevision, targetRevision], {
          allowFailure: true,
        })
      ).code === 0;
    const combinedPatch = (
      await git(candidate.worktreePath, ["diff", "--binary", candidate.baseRevision, candidate.headRevision])
    ).stdout;
    const reverseApplied =
      combinedPatch.trim() &&
      (
        await git(repositoryRoot, ["apply", "--check", "--reverse"], {
          allowFailure: true,
          input: combinedPatch,
        })
      ).code === 0;
    const alreadyApplied =
      targetContainsHead ||
      reverseApplied ||
      (candidateCommits.length > 0 &&
        cherryRows.length === candidateCommits.length &&
        cherryRows.every((row) => row.startsWith("- ")));
    if (alreadyApplied) {
      await git(candidate.worktreePath, ["reset", "--hard", targetRevision]);
      await assertClean(candidate.worktreePath);
      return {
        previousBaseRevision: candidate.baseRevision,
        previousHeadRevision: candidate.headRevision,
        targetRevision,
        headRevision: targetRevision,
        files: [],
        summary: "",
        alreadyApplied: true,
      };
    }

    try {
      await git(candidate.worktreePath, ["rebase", "--onto", targetRevision, candidate.baseRevision]);
    } catch (error) {
      await git(candidate.worktreePath, ["rebase", "--abort"], { allowFailure: true });
      await this.verifyCandidate(candidate);
      throw new Error(
        `Candidate refresh conflicted while replaying it onto ${candidate.baseBranch}: ${error.message}`,
      );
    }
    await assertClean(candidate.worktreePath);
    const headRevision = (await git(candidate.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    if (headRevision === candidate.headRevision) {
      throw new Error("Candidate refresh did not produce a new candidate revision.");
    }
    const summary = (
      await git(candidate.worktreePath, ["diff", "--stat", targetRevision, headRevision])
    ).stdout.trim();
    const files = (
      await git(candidate.worktreePath, ["diff", "--name-only", targetRevision, headRevision])
    ).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    return {
      previousBaseRevision: candidate.baseRevision,
      previousHeadRevision: candidate.headRevision,
      targetRevision,
      headRevision,
      files,
      summary,
    };
  }

  async verifyCandidate(candidate) {
    const worktreeRoot = await this.repositoryRoot(candidate.worktreePath);
    const recordedPath = await realpath(path.resolve(candidate.worktreePath));
    if (worktreeRoot !== recordedPath) {
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
    const worktreePath = await realpath(path.resolve(candidate.worktreePath));
    const worktreeRootBoundary = await realpath(this.#root).catch(() => this.#root);
    if (!worktreePath.startsWith(`${worktreeRootBoundary}${path.sep}`)) {
      throw new Error("Candidate recovery refused a worktree outside harness storage.");
    }
    const worktreeRoot = await this.repositoryRoot(worktreePath);
    if (worktreeRoot !== worktreePath)
      throw new Error("Candidate recovery could not verify the recorded worktree root.");
    if (!candidate.headRevision) throw new Error("Candidate recovery requires a recorded revision.");
    const provisioned = await provisionedDependencies(worktreeRoot);
    const currentHead = (await git(worktreeRoot, ["rev-parse", "HEAD"])).stdout.trim();
    const status = statusEntries(
      (await git(worktreeRoot, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout,
    ).filter((entry) => !isProvisionedPath(entry.file, provisioned));
    if (currentHead === candidate.headRevision && !status.length) return false;
    if (currentHead !== candidate.headRevision) {
      await git(worktreeRoot, ["reset", "--mixed", candidate.headRevision]);
    }
    await git(worktreeRoot, [
      "restore",
      "--source",
      candidate.headRevision,
      "--staged",
      "--worktree",
      "--",
      ".",
    ]);
    // `-x` would otherwise remove the provisioned links, leaving a recovered worktree
    // unable to run the Test stage.
    await git(worktreeRoot, ["clean", "-fdx", ...provisioned.flatMap((entry) => ["-e", entry])]);
    await assertClean(worktreeRoot);
    const recoveredHead = (await git(worktreeRoot, ["rev-parse", "HEAD"])).stdout.trim();
    if (recoveredHead !== candidate.headRevision)
      throw new Error("Candidate recovery did not restore the recorded revision.");
    return true;
  }

  async assertWorktreeClean(worktreePath) {
    await assertClean(await this.repositoryRoot(worktreePath));
    return true;
  }

  async inspectRetainedSlice(candidate, options = {}) {
    const worktreePath = await realpath(path.resolve(candidate.worktreePath));
    const worktreeRootBoundary = await realpath(this.#root).catch(() => this.#root);
    if (!worktreePath.startsWith(`${worktreeRootBoundary}${path.sep}`)) {
      throw new Error("Retained slice validation refused a worktree outside harness storage.");
    }
    const worktreeRoot = await this.repositoryRoot(worktreePath);
    if (worktreeRoot !== worktreePath) {
      throw new Error("Retained slice validation could not verify the recorded worktree root.");
    }
    const headRevision = (await git(worktreeRoot, ["rev-parse", "HEAD"])).stdout.trim();
    if (candidate.headRevision && headRevision !== candidate.headRevision) {
      throw new Error("The retained slice no longer matches its recorded revision.");
    }
    const branch = (await git(worktreeRoot, ["branch", "--show-current"])).stdout.trim();
    if (candidate.branch && branch !== candidate.branch) {
      throw new Error("The retained slice no longer matches its recorded branch.");
    }
    const provisioned = await provisionedDependencies(worktreeRoot);
    const status = statusEntries(
      (await git(worktreeRoot, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout,
    ).filter((entry) => !isProvisionedPath(entry.file, provisioned));
    if (options.requireClean !== false && status.length) {
      throw new Error(
        "The retained slice is not clean and cannot be requalified without another implementation run.",
      );
    }
    const committedFiles = candidate.baseRevision
      ? (await git(worktreeRoot, ["diff", "--name-only", candidate.baseRevision, headRevision])).stdout
          .split(/\r?\n/)
          .filter(Boolean)
      : [];
    const files = [...new Set([...committedFiles, ...status.map((entry) => entry.file)])].sort();
    if (options.ownedPaths) {
      const outOfScope = files.find((file) => !isOwnedFile(file, options.ownedPaths));
      if (outOfScope) {
        throw new Error(
          `The retained slice changed ${outOfScope}, which is outside the current work package ownership (${options.ownedPaths.join(", ")}).`,
        );
      }
    }
    if (candidate.files?.length && options.requireClean !== false) {
      const recordedFiles = [...candidate.files].sort();
      if (JSON.stringify(recordedFiles) !== JSON.stringify([...committedFiles].sort())) {
        throw new Error("The retained slice file set no longer matches its recorded package evidence.");
      }
    }
    return { branch, files, headRevision, worktreePath, clean: status.length === 0 };
  }

  async retainedPatchDisposition(candidate, targetRevision) {
    const retained = await this.inspectRetainedSlice(candidate, { requireClean: true });
    const repositoryRoot = await this.repositoryRoot(candidate.repositoryRoot ?? retained.worktreePath);
    const checkedOutTarget = (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
    if (checkedOutTarget !== targetRevision) {
      throw new Error("The target checkout moved while the retained slice was being compared.");
    }
    const diffArgs = ["diff", "--binary", candidate.baseRevision, retained.headRevision];
    if (candidate.files?.length) diffArgs.push("--", ...candidate.files);
    const patch = (await git(retained.worktreePath, diffArgs)).stdout;
    if (!patch.trim()) return "already-applied";
    const reverse = await git(repositoryRoot, ["apply", "--check", "--reverse"], {
      allowFailure: true,
      input: patch,
    });
    if (reverse.code === 0) return "already-applied";
    const forward = await git(repositoryRoot, ["apply", "--check"], {
      allowFailure: true,
      input: patch,
    });
    return forward.code === 0 ? "pending" : "conflicts";
  }

  async removeWorktree(candidate) {
    const worktreePath = await realpath(path.resolve(candidate.worktreePath));
    const worktreeRootBoundary = await realpath(this.#root).catch(() => this.#root);
    if (!worktreePath.startsWith(`${worktreeRootBoundary}${path.sep}`)) {
      throw new Error("Candidate removal refused a worktree outside harness storage.");
    }
    const worktreeRoot = await this.repositoryRoot(worktreePath);
    if (worktreeRoot !== worktreePath)
      throw new Error("Candidate removal could not verify the recorded worktree root.");
    const repositoryRoot = await this.repositoryRoot(candidate.repositoryRoot);
    const removed = await deprovisionDependencies(worktreePath);
    await git(repositoryRoot, ["worktree", "remove", "--force", worktreePath]);
    return removed;
  }

  async inventory(entries = []) {
    const rows = new Array(entries.length);
    for (let offset = 0; offset < entries.length; offset += 4) {
      await Promise.all(
        entries.slice(offset, offset + 4).map(async (entry, index) => {
          rows[offset + index] = await this.#inventoryRow(entry);
        }),
      );
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
        const provisioned = await provisionedDependencies(repositoryRoot);
        const status = statusEntries(
          (await git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=normal"])).stdout,
        );
        clean = !status.some((entry) => !isProvisionedPath(entry.file, provisioned));
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
      retainedRequired: Boolean(entry.retainedRequired),
      cleanupReady: Boolean(exists && clean && currentState !== "active" && !entry.retainedRequired),
    };
  }

  async repositoryRoot(repositoryPath) {
    const result = await git(repositoryPath, ["rev-parse", "--show-toplevel"]);
    return realpath(path.resolve(result.stdout.trim()));
  }

  /**
   * Exact HEAD plus full working-tree status for a repository the harness does not
   * own. Read-only stages against `task.repositoryPath` run in the operator's real
   * working tree, where there is no candidate to bind to and no existing check at
   * all — and mutating a real working tree is strictly worse than mutating a
   * disposable worktree.
   *
   * Unlike `assertClean` this does not require the tree to *be* clean: an operator's
   * working tree legitimately has uncommitted work in it. It records what was there
   * and requires it to be identical afterwards. Provisioned dependency paths are
   * excluded for the same reason `assertClean` excludes them.
   */
  async snapshotRepository(repositoryPath) {
    // A path that is not a git repository has no HEAD and no status to compare, so
    // it cannot be verified this way. Returning null says so, rather than
    // manufacturing a snapshot that would always agree with itself; the caller
    // decides whether an unverifiable stage may run.
    const repositoryRoot = await this.repositoryRoot(repositoryPath).catch(() => null);
    if (!repositoryRoot) return null;
    const provisioned = await provisionedDependencies(repositoryRoot);
    const headRevision = (await git(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
    const status = statusEntries(
      (await git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"])).stdout,
    )
      .filter((entry) => !isProvisionedPath(entry.file, provisioned))
      .map((entry) => `${entry.code ?? ""} ${entry.file}`)
      .sort();
    return { repositoryRoot, headRevision, status };
  }

  async assertRepositoryUnchanged(repositoryPath, before) {
    if (!before) return null;
    const after = await this.snapshotRepository(repositoryPath);
    if (!after) throw new Error("The stage's source repository is no longer a git repository.");
    if (after.headRevision !== before.headRevision) {
      throw new Error("The stage changed the source repository HEAD revision.");
    }
    if (JSON.stringify(after.status) !== JSON.stringify(before.status)) {
      throw new Error("The stage changed files in the source repository working tree.");
    }
    return after;
  }
}

function normalizeLifecycleState(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
  if (["active", "running", "retained", "stale", "missing", "cleaning", "ready"].includes(normalized))
    return normalized;
  return "retained";
}

async function assertClean(repositoryRoot) {
  const provisioned = await provisionedDependencies(repositoryRoot);
  const status = (await git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=normal"])).stdout;
  const entries = statusEntries(status).filter((entry) => !isProvisionedPath(entry.file, provisioned));
  if (entries.length) {
    throw new Error(
      "The selected repository has uncommitted changes. Commit or stash them before creating or merging a candidate.",
    );
  }
}

// Dependency directories are discovered rather than assumed, so nested (`frontend/node_modules`)
// and non-Node (`.venv`) installs are provisioned alongside a root `node_modules`.
export async function discoverDependencyDirectories(repositoryRoot) {
  const found = [];
  let level = [""];
  for (let depth = 0; depth < DEPENDENCY_SCAN_DEPTH && level.length; depth += 1) {
    const children = [];
    for (const relative of level) {
      const dirents = await readdir(path.join(repositoryRoot, relative), { withFileTypes: true }).catch(
        () => [],
      );
      for (const dirent of dirents) {
        if (dirent.name === ".git") continue;
        const child = relative ? `${relative}/${dirent.name}` : dirent.name;
        const named = DEPENDENCY_DIRECTORY_NAMES.includes(dirent.name);
        if (dirent.isDirectory()) children.push(child);
        else if (named && dirent.isSymbolicLink() && (await isDirectory(path.join(repositoryRoot, child))))
          children.push(child);
      }
    }
    if (!children.length) break;
    const ignored = await ignoredPaths(repositoryRoot, children);
    const next = [];
    for (const child of children) {
      // Only ever link what the source checkout already ignores, so no tracked content is
      // ever reachable through a provisioned path.
      if (!ignored.has(child)) {
        next.push(child);
        continue;
      }
      if (DEPENDENCY_DIRECTORY_NAMES.includes(child.split("/").at(-1))) found.push(child);
      // Ignored directories that are not dependencies (build output, caches, harness
      // storage) are pruned rather than descended into.
    }
    level = next;
  }
  return found.sort();
}

async function ignoredPaths(repositoryRoot, candidates) {
  const result = await git(repositoryRoot, ["check-ignore", "--stdin"], {
    allowFailure: true,
    input: `${candidates.join("\n")}\n`,
  });
  if (result.code !== 0 && result.code !== 1) return new Set();
  return new Set(result.stdout.split(/\r?\n/).filter(Boolean));
}

// Infrastructure entries a dependency directory needs to function. Every other
// dot-entry is treated as tool state rather than an installed package.
const DEPENDENCY_INFRASTRUCTURE_ENTRIES = [
  ".bin",
  ".pnpm",
  ".package-lock.json",
  ".modules.yaml",
  ".yarn-state.yml",
];

function isInheritableDependencyEntry(name) {
  return !name.startsWith(".") || DEPENDENCY_INFRASTRUCTURE_ENTRIES.includes(name);
}

/**
 * Provision a dependency directory as a real, independent clone when the platform
 * and filesystem support it, falling back to a directory of per-entry links when
 * they don't.
 *
 * Both sandboxes resolve symlinks before matching, so any link into the source
 * checkout's dependency directory makes writes through it resolve into shared
 * mutable state and get refused — including ones tools make legitimately (Vite
 * writes `node_modules/.vite-temp` while merely *loading* its config; Playwright
 * writes browser downloads inside `node_modules/playwright-core`; Python writes
 * `__pycache__` throughout `.venv/lib/.../site-packages`). A per-entry link at the
 * top level only ever fixed the first case: writes into an *already-installed*
 * package still traverse a link into the source checkout.
 *
 * Widening the sandbox to admit those paths is the wrong fix: it reopens the escape
 * the symlink resolution closes, and a dependency directory is shared mutable state
 * that every concurrent candidate worktree and the operator's own environment
 * resolve to. Cloning gives each worktree a genuinely independent, fully writable
 * tree instead: `cp -c` (APFS `clonefile`) or `cp --reflink=auto` (Linux) copy
 * near-instantly and use no extra disk until a page is written. Both require the
 * source and destination to be on the same volume, so that is checked first rather
 * than assumed; anywhere it doesn't hold (a different platform, a different
 * volume, a filesystem without clone/reflink support), provisioning falls back to
 * the original per-entry-link strategy, which the sandbox still confines correctly
 * — it is only writes *inside* an installed package that a link can't satisfy.
 */
async function provisionDependencies(repositoryRoot, worktreePath) {
  const entries = [];
  for (const relative of await discoverDependencyDirectories(repositoryRoot)) {
    const destination = path.join(worktreePath, relative);
    if (
      await lstat(destination)
        .then(() => true)
        .catch(() => false)
    )
      continue;
    const source = path.join(repositoryRoot, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    const cloned = await cloneDependencyDirectory(source, destination);
    if (!cloned) await symlinkDependencyEntries(source, destination);
    entries.push({ path: relative, mode: cloned ? "clone" : "symlink" });
  }
  await writeProvisionManifest(worktreePath, entries);
  return entries.map((entry) => entry.path);
}

// Symlink each entry inside a real, worktree-local directory rather than linking the
// whole directory, so the directory itself stays writable for new top-level tool state
// (caches, `.bin` shims regenerated by a package manager) even though this cannot make
// writes *inside* an already-installed package land anywhere but the source checkout.
async function symlinkDependencyEntries(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true }).catch(() => [])) {
    if (!isInheritableDependencyEntry(entry.name)) continue;
    const entryTarget = path.join(source, entry.name);
    const directory = entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(entryTarget)));
    await symlink(
      entryTarget,
      path.join(destination, entry.name),
      process.platform === "win32" ? (directory ? "junction" : "file") : undefined,
    ).catch(() => {});
  }
}

// Attempts a same-volume clone of `source` to `destination` and reports whether it
// produced a real directory. Detected rather than assumed: `clonefile`/reflink support
// is platform- and filesystem-specific, and the harness's worktree storage root can be
// configured onto a different volume than the source checkout it clones from.
async function cloneDependencyDirectory(source, destination) {
  if (process.platform !== "darwin" && process.platform !== "linux") return false;
  const [sourceDevice, destinationParentDevice] = await Promise.all([
    stat(source)
      .then((info) => info.dev)
      .catch(() => null),
    stat(path.dirname(destination))
      .then((info) => info.dev)
      .catch(() => null),
  ]);
  if (sourceDevice === null || destinationParentDevice === null || sourceDevice !== destinationParentDevice)
    return false;
  const args =
    process.platform === "darwin"
      ? ["-c", "-R", "--", source, destination]
      : ["--reflink=auto", "-R", "--", source, destination];
  const succeeded = await runToCompletion("cp", args);
  const created =
    succeeded &&
    (await lstat(destination)
      .then((info) => info.isDirectory())
      .catch(() => false));
  if (!created) {
    await rm(destination, { recursive: true, force: true }).catch(() => {});
    return false;
  }
  return true;
}

function runToCompletion(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

// The manifest lives in the worktree's private Git directory, never in its working tree,
// so it cannot be committed and cannot collide with the shared `info/exclude`.
async function manifestPath(repositoryRoot) {
  const result = await git(repositoryRoot, ["rev-parse", "--absolute-git-dir"], { allowFailure: true });
  if (result.code !== 0) return null;
  return path.join(result.stdout.trim(), PROVISION_MANIFEST);
}

async function writeProvisionManifest(worktreePath, entries) {
  const file = await manifestPath(worktreePath);
  if (!file)
    throw new Error("Could not resolve the worktree Git directory to record provisioned dependencies.");
  const paths = entries.map((entry) => entry.path);
  await writeFile(file, `${JSON.stringify({ paths, entries }, null, 2)}\n`, "utf8");
}

// Every caller that only needs to filter or exclude provisioned paths (status scanning,
// pathspec exclusion, cleanup) reads this flat list; only deprovisioning needs the mode.
async function provisionedDependencies(repositoryRoot) {
  return (await provisionedDependencyEntries(repositoryRoot)).map((entry) => entry.path);
}

/**
 * Real, outside-the-worktree roots a read-only sandbox must additionally admit into
 * its allow-read list for `worktreePath` to be usable at all. A dependency directory
 * provisioned as a real clone (see `provisionDependencies`) lives entirely inside the
 * worktree and needs nothing extra. One provisioned as a per-entry symlink — the
 * fallback used when clone/reflink is unavailable, e.g. the worktree store and the
 * source checkout are on different volumes — resolves, for anything the sandbox
 * actually opens, through to the source checkout's own copy. Both Claude's and
 * Codex's sandboxes resolve symlinks before matching, so a sandbox confined to
 * `[worktreePath]` alone denies an ordinary read through such a link even though the
 * calling stage is read-only and the target is vendored, non-secret code.
 */
export async function symlinkedDependencySourceRoots(worktreePath, repositoryRoot) {
  const entries = await provisionedDependencyEntries(worktreePath);
  return entries
    .filter((entry) => entry.mode === "symlink")
    .map((entry) => path.join(repositoryRoot, entry.path));
}

export async function provisionedDependencyEntries(repositoryRoot) {
  const file = await manifestPath(repositoryRoot);
  if (!file) return [];
  const raw = await readFile(file, "utf8").catch(() => null);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data.entries)) {
      return data.entries.filter(
        (entry) =>
          entry &&
          typeof entry.path === "string" &&
          entry.path &&
          (entry.mode === "clone" || entry.mode === "symlink"),
      );
    }
    // A manifest written before clone support recorded only paths; every provisioned
    // path from that era was a symlink structure, so it is read back as one.
    if (Array.isArray(data.paths)) {
      return data.paths
        .filter((value) => typeof value === "string" && value)
        .map((value) => ({ path: value, mode: "symlink" }));
    }
    return [];
  } catch {
    return [];
  }
}

async function deprovisionDependencies(worktreePath) {
  const entries = await provisionedDependencyEntries(worktreePath);
  const worktreeRoot = await realpath(worktreePath).catch(() => path.resolve(worktreePath));
  for (const { path: relative, mode } of entries) {
    const targetPath = path.join(worktreePath, relative);
    const stats = await lstat(targetPath).catch(() => null);
    if (!stats) continue;
    if (mode === "clone" && !stats.isSymbolicLink()) {
      // A clone is real content, not a pointer: removing it recursively is only safe
      // once its resolved path is confirmed inside the worktree, mirroring the boundary
      // refusals in `removeWorktree`/`recoverCandidate`. A manifest entry can only name
      // paths `discoverDependencyDirectories` found by descending real subdirectories,
      // so this should always hold; the check exists anyway because deleting up to a
      // gigabyte of the operator's real dependencies is not a mistake to risk on "should".
      const resolved = await realpath(targetPath).catch(() => null);
      if (!resolved || !(resolved === worktreeRoot || resolved.startsWith(`${worktreeRoot}${path.sep}`))) {
        throw new Error(
          `Dependency removal refused a clone whose real path escaped the worktree: ${relative}`,
        );
      }
      await rm(targetPath, { recursive: true, force: true });
      continue;
    }
    // Unlink the link itself. Never recurse, so removal can never reach through into the
    // source checkout's dependency directories.
    if (stats.isSymbolicLink()) await unlink(targetPath);
    else await rm(targetPath, { recursive: true, force: true });
  }
  const file = await manifestPath(worktreePath);
  if (file) await rm(file, { force: true });
  return entries.map((entry) => entry.path);
}

// A `.gitignore` entry of `node_modules/` matches directories only, so a symlink named
// `node_modules` is a file to Git and stays untracked: linking alone cannot keep a worktree
// clean. Every harness scan therefore excludes the recorded provisioned paths explicitly,
// and `git add` receives matching pathspec exclusions. The exclusion is exactly this list —
// sensitive-path and generated-path scanning is otherwise unchanged.
function isProvisionedPath(file, provisioned) {
  if (!provisioned.length) return false;
  const normalized = file.replaceAll("\\", "/").replace(/\/+$/, "");
  return provisioned.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
}

/**
 * Exclude only the provisioned paths git does not already ignore.
 *
 * Naming an ignored path in a pathspec makes `git add` fail outright ("use -f if you
 * really want to add them"), and an ignored path needs no exclusion in the first
 * place. This became load-bearing when provisioned directories stopped being
 * symlinks: `node_modules/` in a .gitignore matches a real directory but not a
 * symlink, so the exclusions used to be both necessary and harmless and are now
 * necessary only for the paths the product does not ignore itself.
 */
async function excludePathspecs(repositoryRoot, provisioned) {
  if (!provisioned.length) return [];
  const ignored = await ignoredPaths(repositoryRoot, provisioned);
  return provisioned.filter((entry) => !ignored.has(entry)).map((entry) => `:(exclude)${entry}`);
}

async function isDirectory(target) {
  return stat(target)
    .then((result) => result.isDirectory())
    .catch(() => false);
}

function statusEntries(status) {
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      code: line.slice(0, 2),
      file: line.slice(3).split(" -> ").at(-1)?.replace(/^"|"$/g, "") ?? "",
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
  return String(value)
    .replace(/[^a-z0-9_-]/gi, "-")
    .slice(0, 80);
}

function git(cwd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (options.input !== undefined) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.input);
    }
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
