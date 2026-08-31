import { pullRequestBranch } from "./github-pull-request.mjs";

import { now, zeroUsage, activity } from "./orchestrator-stage-support.mjs";
import {
  candidateGateFailure,
  assertCandidateGatesFresh,
  currentCandidate,
} from "./orchestrator-run-policy.mjs";

export class PullRequestOrchestrator {
  constructor({ store, github, mergeActive, worktrees }) {
    this._store = store;
    this._github = github;
    this._mergeActive = mergeActive;
    this._worktrees = worktrees;
  }
  async approvePullRequest(id, note = "", expectedCandidate = null) {
    if (this._mergeActive.has(id))
      throw new Error("This task already has a GitHub PR reconciliation in progress.");
    this._mergeActive.add(id);
    return this._approvePullRequest(id, note, expectedCandidate).finally(() => this._mergeActive.delete(id));
  }

  async reconcilePullRequest(id) {
    if (this._mergeActive.has(id))
      throw new Error("This task already has a GitHub PR reconciliation in progress.");
    this._mergeActive.add(id);
    return this._reconcilePullRequestIntent(id, { operatorRequested: true }).finally(() =>
      this._mergeActive.delete(id),
    );
  }

  async _approvePullRequest(id, note = "", expectedCandidate = null) {
    let task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status === "awaiting-human-approval") {
      const candidate = expectedCandidate
        ? assertExpectedCandidate(task, expectedCandidate)
        : currentCandidate(task);
      if (candidate.status !== "awaiting_human_approval")
        throw new Error("The current candidate has not cleared every gate.");
      assertCandidateGatesFresh(task, candidate);
      if (!candidate.headRevision || !candidate.baseBranch || candidate.baseBranch === "detached") {
        throw new Error("The candidate does not have a named GitHub target and exact head revision.");
      }
      await this._worktrees.verifyCandidate(candidate);
      let staleCandidateError = null;
      try {
        task = await this._store.transition(
          id,
          (draft) => {
            const activeCandidate = draft.candidates?.at(-1);
            if (expectedCandidate && !sameExpectedCandidate(activeCandidate, expectedCandidate)) {
              staleCandidateError = expectedCandidateError(expectedCandidate, activeCandidate);
              return false;
            }
            return (
              draft.status === "awaiting-human-approval" &&
              activeCandidate?.status === "awaiting_human_approval" &&
              candidateGateFailure(draft, activeCandidate) == null
            );
          },
          (draft) => {
            const activeCandidate = currentCandidate(draft);
            const startedAt = now();
            draft.status = "merging";
            draft.pullRequestIntent = {
              candidateId: activeCandidate.id,
              candidateRevision: activeCandidate.revisionNumber,
              baseRevision: activeCandidate.baseRevision,
              headRevision: activeCandidate.headRevision,
              targetBranch: activeCandidate.baseBranch,
              headBranch: pullRequestBranch(draft, activeCandidate),
              remoteName: null,
              repository: null,
              number: null,
              url: null,
              note: note.trim().slice(0, 5_000),
              status: "publishing",
              startedAt,
              openedAt: null,
              mergedAt: null,
              closedAt: null,
              mergeCommitRevision: null,
              lastCheckedAt: null,
              lastError: null,
              consecutivePollFailures: 0,
            };
            draft.events.push(
              activity(
                "approval",
                "GitHub PR intent recorded",
                `${activeCandidate.id} revision ${activeCandidate.revisionNumber} is reserved for a PR into ${activeCandidate.baseBranch}.`,
                "warning",
                "decision",
              ),
            );
          },
        );
      } catch (error) {
        if (staleCandidateError && error?.code === "TASK_TRANSITION_CONFLICT") throw staleCandidateError;
        throw error;
      }
    } else if (task.status !== "merging" || task.pullRequestIntent?.status !== "publishing") {
      throw new Error("The task is not awaiting GitHub PR approval.");
    }
    return this._reconcilePullRequestIntent(id);
  }

  async _reconcilePullRequestIntent(id, { operatorRequested = false } = {}) {
    let task = await this._store.get(id);
    if (!task) throw new Error("Task not found.");
    if (task.status === "completed" && task.pullRequestIntent?.status === "merged") return task;

    const retryablePublication =
      task.status === "blocked" &&
      task.blocker?.code === "pull-request-publication" &&
      task.pullRequestIntent?.status === "failed";
    if (retryablePublication) {
      task = await this._store.transition(
        id,
        (draft) =>
          draft.status === "blocked" &&
          draft.blocker?.code === "pull-request-publication" &&
          draft.pullRequestIntent?.status === "failed",
        (draft) => {
          draft.status = "merging";
          draft.error = null;
          draft.blocker = null;
          draft.pullRequestIntent.status = "publishing";
          draft.pullRequestIntent.lastError = null;
          draft.events.push(
            activity(
              "approval",
              "GitHub PR publication retry requested",
              "The original exact-candidate approval is retained while the remote branch and PR are reconciled idempotently.",
              "warning",
              "decision",
            ),
          );
        },
      );
    }

    const retryableClosedPullRequest =
      task.status === "blocked" &&
      task.blocker?.code === "pull-request-closed" &&
      task.pullRequestIntent?.status === "closed";
    if (retryableClosedPullRequest) {
      task = await this._store.transition(
        id,
        (draft) =>
          draft.status === "blocked" &&
          draft.blocker?.code === "pull-request-closed" &&
          draft.pullRequestIntent?.status === "closed",
        (draft) => {
          draft.status = "awaiting-pr-merge";
          draft.error = null;
          draft.blocker = null;
          draft.pullRequestIntent.status = "open";
          draft.pullRequestIntent.lastError = null;
          draft.events.push(
            activity(
              "approval",
              "GitHub PR recheck requested",
              "The PR will progress only if GitHub now reports the same exact candidate head open or merged.",
              "warning",
              "decision",
            ),
          );
        },
      );
    }

    const intent = task.pullRequestIntent;
    const candidate = currentCandidate(task);
    if (
      !intent ||
      intent.candidateId !== candidate.id ||
      intent.candidateRevision !== candidate.revisionNumber ||
      intent.headRevision !== candidate.headRevision ||
      intent.baseRevision !== candidate.baseRevision
    ) {
      throw new Error(
        operatorRequested
          ? "This task does not have a retained GitHub PR intent for its exact current candidate."
          : "The retained GitHub PR intent no longer matches the exact current candidate revision.",
      );
    }
    assertCandidateGatesFresh(task, candidate);

    if (task.status === "merging" && intent.status === "publishing") {
      try {
        await this._worktrees.verifyCandidate(candidate);
        const pullRequest = await this._github.publish({ task, candidate, intent });
        return this._recordOpenPullRequest(id, pullRequest);
      } catch (error) {
        await this._blockPullRequestPublication(id, candidate, error);
        throw error;
      }
    }

    if (task.status !== "awaiting-pr-merge" || intent.status !== "open") {
      throw new Error(
        operatorRequested
          ? "This task does not have an open GitHub PR that can be reconciled."
          : "The task is not awaiting a GitHub PR merge.",
      );
    }

    let pullRequest;
    try {
      pullRequest = await this._github.inspect(intent);
    } catch (error) {
      if (/branch identity|head moved|exact approved candidate/i.test(error.message)) {
        await this._blockPullRequestDrift(id, candidate, error);
      } else {
        const updated = await this._recordPullRequestPollFailure(id, error);
        if (!operatorRequested) return updated;
      }
      if (operatorRequested) throw error;
      return this._store.get(id);
    }
    if (pullRequest.state === "merged") return this._finalizePullRequestMerge(id, pullRequest);
    if (pullRequest.state === "closed") {
      const error = new Error(
        `GitHub PR #${pullRequest.number} was closed without merging the approved candidate.`,
      );
      await this._blockPullRequestClosed(id, candidate, pullRequest, error);
      if (operatorRequested) throw error;
      return this._store.get(id);
    }
    const updated = await this._updatePullRequestTelemetry(id, (draft) => {
      if (draft.status !== "awaiting-pr-merge" || draft.pullRequestIntent?.status !== "open") return;
      draft.pullRequestIntent.lastCheckedAt = now();
      draft.pullRequestIntent.lastError = null;
      draft.pullRequestIntent.consecutivePollFailures = 0;
      draft.error = null;
    });
    return operatorRequested ? this._store.get(id) : updated;
  }

  async _recordOpenPullRequest(id, pullRequest) {
    return this._store.transition(
      id,
      (draft) => draft.status === "merging" && draft.pullRequestIntent?.status === "publishing",
      (draft) => {
        const candidate = currentCandidate(draft);
        const openedAt = now();
        const intent = draft.pullRequestIntent;
        Object.assign(intent, {
          ...pullRequest,
          status: "open",
          openedAt,
          lastCheckedAt: openedAt,
          lastError: null,
          consecutivePollFailures: 0,
        });
        candidate.status = "pull_request_open";
        candidate.updatedAt = openedAt;
        draft.status = "awaiting-pr-merge";
        draft.currentStage = "approval";
        draft.error = null;
        draft.blocker = null;
        draft.approvals ??= [];
        const approval = {
          id: crypto.randomUUID(),
          stage: "approval",
          note: intent.note,
          createdAt: openedAt,
        };
        draft.approvals.push(approval);
        const artifact = {
          id: crypto.randomUUID(),
          stage: "approval",
          name: `approval-${candidate.id.toLowerCase()}-r${candidate.revisionNumber}.md`,
          kind: "markdown",
          content: `# Human approval and GitHub pull request\n\n- Candidate: ${candidate.id} revision ${candidate.revisionNumber}\n- Repository: ${intent.repository}\n- Target branch: ${intent.targetBranch}\n- PR branch: ${intent.headBranch}\n- Exact candidate head: ${candidate.headRevision}\n- Pull request: [#${intent.number}](${intent.url})\n- Approved at: ${openedAt}\n- Note: ${intent.note || "Approved without an additional note."}\n\nThe task remains open until GitHub reports this exact pull request merged.`,
          createdAt: openedAt,
          model: "Human approval",
          usage: zeroUsage(),
          candidateId: candidate.id,
          candidateRevision: candidate.revisionNumber,
        };
        draft.artifacts.push(artifact);
        draft.events.push(
          activity(
            "approval",
            "Human approval recorded",
            intent.note || "Approved without an additional note.",
            "success",
            "decision",
            { approvalId: approval.id },
          ),
        );
        draft.events.push(
          activity(
            "approval",
            "GitHub PR opened",
            `PR #${intent.number} tracks ${candidate.id} revision ${candidate.revisionNumber} at ${intent.url}.`,
            "success",
            "decision",
            { approvalId: approval.id },
          ),
        );
        draft.events.push(
          activity("approval", "Approval artifact ready", artifact.name, "success", "artifact", {
            artifactId: artifact.id,
            approvalId: approval.id,
          }),
        );
      },
    );
  }

  async _finalizePullRequestMerge(id, pullRequest) {
    return this._store.transition(
      id,
      (draft) =>
        draft.status === "awaiting-pr-merge" &&
        draft.pullRequestIntent?.status === "open" &&
        draft.pullRequestIntent.number === pullRequest.number &&
        draft.pullRequestIntent.headRevision === pullRequest.headRevision,
      (draft) => {
        const candidate = currentCandidate(draft);
        const completedAt = pullRequest.mergedAt ?? now();
        candidate.status = "merged";
        candidate.updatedAt = completedAt;
        draft.status = "completed";
        draft.completedAt = completedAt;
        draft.currentStage = "approval";
        if (!draft.completedStages.includes("approval")) draft.completedStages.push("approval");
        Object.assign(draft.pullRequestIntent, {
          ...pullRequest,
          status: "merged",
          lastCheckedAt: now(),
          lastError: null,
          consecutivePollFailures: 0,
        });
        draft.error = null;
        draft.blocker = null;
        draft.events.push(
          activity(
            "approval",
            "GitHub PR merged",
            `PR #${pullRequest.number} merged ${candidate.id} revision ${candidate.revisionNumber}${pullRequest.mergeCommitRevision ? ` as ${pullRequest.mergeCommitRevision.slice(0, 8)}` : ""}. The task is complete.`,
            "success",
            "decision",
          ),
        );
      },
    );
  }

  async _blockPullRequestPublication(id, candidate, error) {
    await this._store.update(id, (draft) => {
      if (draft.status !== "merging" || draft.pullRequestIntent?.status !== "publishing") return;
      const targetDiverged = error.code === "GITHUB_TARGET_DIVERGED";
      draft.status = "blocked";
      draft.error = error.message;
      draft.blocker = {
        code: targetDiverged ? "target-diverged" : "pull-request-publication",
        detail: error.message,
        detectedAt: now(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateBaseRevision: candidate.baseRevision,
        targetRevision: error.targetRevision ?? null,
        remoteName: error.remoteName ?? draft.pullRequestIntent.remoteName ?? null,
        source: targetDiverged ? "github" : null,
      };
      if (error.remoteName) draft.pullRequestIntent.remoteName = error.remoteName;
      draft.pullRequestIntent.status = "failed";
      draft.pullRequestIntent.lastError = error.message;
      draft.events.push(
        activity(
          "approval",
          targetDiverged ? "GitHub target advanced" : "GitHub PR publication blocked",
          error.message,
          "danger",
          "decision",
        ),
      );
    });
  }

  async _blockPullRequestDrift(id, candidate, error) {
    await this._store.update(id, (draft) => {
      if (draft.status !== "awaiting-pr-merge" || draft.pullRequestIntent?.status !== "open") return;
      draft.status = "blocked";
      draft.error = error.message;
      draft.blocker = {
        code: "pull-request-drift",
        detail: error.message,
        detectedAt: now(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateBaseRevision: candidate.baseRevision,
      };
      draft.pullRequestIntent.status = "failed";
      draft.pullRequestIntent.lastError = error.message;
      draft.events.push(
        activity("approval", "GitHub PR identity changed", error.message, "danger", "decision"),
      );
    });
  }

  async _blockPullRequestClosed(id, candidate, pullRequest, error) {
    await this._store.update(id, (draft) => {
      if (draft.status !== "awaiting-pr-merge" || draft.pullRequestIntent?.status !== "open") return;
      draft.status = "blocked";
      draft.error = error.message;
      draft.blocker = {
        code: "pull-request-closed",
        detail: error.message,
        detectedAt: now(),
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        candidateBaseRevision: candidate.baseRevision,
      };
      Object.assign(draft.pullRequestIntent, {
        ...pullRequest,
        status: "closed",
        lastCheckedAt: now(),
        lastError: error.message,
      });
      draft.events.push(activity("approval", "GitHub PR closed", error.message, "danger", "decision"));
    });
  }

  async _recordPullRequestPollFailure(id, error) {
    return this._updatePullRequestTelemetry(id, (draft) => {
      if (draft.status !== "awaiting-pr-merge" || draft.pullRequestIntent?.status !== "open") return;
      draft.pullRequestIntent.lastCheckedAt = now();
      draft.pullRequestIntent.lastError = error.message;
      draft.pullRequestIntent.consecutivePollFailures =
        (draft.pullRequestIntent.consecutivePollFailures ?? 0) + 1;
    });
  }

  async _updatePullRequestTelemetry(id, updater) {
    if (typeof this._store.updateCore === "function") {
      return this._store.updateCore(id, updater, { touchUpdatedAt: false });
    }
    return this._store.update(id, updater);
  }

  async pollPullRequests() {
    const tasks =
      typeof this._store.listPullRequestTasks === "function"
        ? await this._store.listPullRequestTasks()
        : (await this._store.list()).filter(
            (item) =>
              (item.status === "merging" && item.pullRequestIntent?.status === "publishing") ||
              (item.status === "awaiting-pr-merge" && item.pullRequestIntent?.status === "open"),
          );
    for (let offset = 0; offset < tasks.length; offset += 4) {
      await Promise.all(
        tasks.slice(offset, offset + 4).map(async (task) => {
          if (this._mergeActive.has(task.id)) return;
          this._mergeActive.add(task.id);
          try {
            await this._reconcilePullRequestIntent(task.id);
          } catch {
            // The exact retained state is persisted by reconciliation. Polling is best effort
            // so one unavailable repository cannot prevent other PRs from advancing.
          } finally {
            this._mergeActive.delete(task.id);
          }
        }),
      );
    }
  }
}

function assertExpectedCandidate(task, expectedCandidate) {
  const candidate = task?.candidates?.at(-1) ?? null;
  if (!sameExpectedCandidate(candidate, expectedCandidate)) {
    throw expectedCandidateError(expectedCandidate, candidate);
  }
  return candidate;
}

function sameExpectedCandidate(candidate, expectedCandidate) {
  return Boolean(
    candidate &&
      candidate.id === expectedCandidate?.candidateId &&
      candidate.revisionNumber === expectedCandidate?.candidateRevision &&
      candidate.headRevision === expectedCandidate?.candidateHeadRevision,
  );
}

function expectedCandidateError(expectedCandidate, candidate) {
  const error = new Error(
    "The candidate changed after this action was proposed. The proposal remains reviewable and must be refreshed.",
  );
  error.code = "STALE_CANDIDATE";
  error.evidence = [
    `Expected ${expectedCandidate?.candidateId} revision ${expectedCandidate?.candidateRevision} @ ${expectedCandidate?.candidateHeadRevision}.`,
    candidate
      ? `Current ${candidate.id} revision ${candidate.revisionNumber} @ ${candidate.headRevision ?? "no head revision"}.`
      : "No integration candidate is retained on this task.",
  ];
  return error;
}
