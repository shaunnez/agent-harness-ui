import { getCodexStatus } from "./codex-runtime.mjs";
import { defaultWorktreeRoot, GitWorktreeManager } from "./git-worktree.mjs";
import { GitHubPullRequestManager } from "./github-pull-request.mjs";
import { RepositoryAuthorityService } from "./repository-authority.mjs";
import {
  readVerificationManifest,
  readVerificationManifestAtRevision,
  runRepositoryVerification,
} from "./verification.mjs";

export class OrchestratorRuntimeContext {
  _store;
  _active = new Map();
  _mergeActive = new Set();
  _refreshActive = new Set();
  _runCodex;
  _getStatus;
  _worktrees;
  _github;
  _runVerification;
  _runPackageVerification;
  _packageVerificationQueue = Promise.resolve();
  _packageConcurrency;
  _readVerificationManifest;
  _readVerificationManifestInjected;
  _readVerificationManifestAtRevision;
  _repositoryAuthority;

  constructor(store, options = {}) {
    this._store = store;
    this._runCodex = options.runCodex ?? null;
    this._getStatus = options.getStatus ?? getCodexStatus;
    this._worktrees = options.worktreeManager ?? new GitWorktreeManager(defaultWorktreeRoot());
    this._github = options.pullRequestManager ?? new GitHubPullRequestManager();
    this._repositoryAuthority = options.repositoryAuthorityService ?? new RepositoryAuthorityService();
    // The same injection seam `runCodex` and `worktreeManager` already use, for the same
    // reason: harness verification spawns real processes in a real worktree, so a test about
    // gate ingestion, freshness or retry accounting should be able to supply the observation
    // rather than stand up a repository to obtain it. The real path is exercised directly in
    // `tests/verification.test.mjs`, including against a real git worktree.
    this._runVerification = options.runVerification ?? runRepositoryVerification;
    this._readVerificationManifest = options.readVerificationManifest ?? readVerificationManifest;
    this._readVerificationManifestInjected = Boolean(options.readVerificationManifest);
    this._readVerificationManifestAtRevision =
      options.readVerificationManifestAtRevision ??
      (options.readVerificationManifest
        ? async (repositoryPath) => options.readVerificationManifest(repositoryPath)
        : readVerificationManifestAtRevision);
    // Production slices qualify with the same repository-owned, argv-only manifest as
    // Focused Test. Unit tests that inject a model runner keep their existing lightweight
    // seam unless they explicitly inject package verification; real runtime execution never
    // gets that exemption.
    this._runPackageVerification =
      options.runPackageVerification ??
      (this._runCodex
        ? null
        : async ({
            worktreePath,
            workPackage,
            workPackageId,
            attempt,
            headRevision,
            signal,
            manifest = null,
          }) => {
            return this._runVerification({
              worktreePath,
              candidate: { id: workPackageId, revisionNumber: attempt, headRevision },
              commandIds: workPackage.verificationCommandIds,
              executionKind: "focused-package",
              signal,
              manifest,
            });
          });
    this._packageConcurrency = Number.isInteger(options.packageConcurrency)
      ? Math.max(1, Math.min(8, options.packageConcurrency))
      : 3;
  }
}
