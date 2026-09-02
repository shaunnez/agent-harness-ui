import { type RuntimeTask, type StageId, workflowStages } from "../../domain";
import { getEffectiveStageRunAttempts, getEffectiveStageRunLimit } from "../../runtime-stage-limits";
import { candidateGateStages, getRuntimeGateFreshness } from "./workflow";

export function nextAction(task: RuntimeTask) {
  const next = deriveNextAction(task);
  if (!next?.action) {
    if (task.actionEligibility?.actions["grant-retry"]?.allowed) {
      return {
        action: "grant-retry" as const,
        label: "Grant one stage attempt",
        title: "Stage retry allowance exhausted",
        detail:
          "The server has authorized exactly one additional attempt while retaining the existing evidence.",
      };
    }
    return null;
  }
  if (!task.actionEligibility) return next;
  return task.actionEligibility.actions[next.action]?.allowed ? next : null;
}

export function deriveNextAction(task: RuntimeTask) {
  const currentAttempts = getEffectiveStageRunAttempts(task);
  const retryAllowanceExhausted = currentAttempts >= getEffectiveStageRunLimit(task);
  const candidate = task.candidates?.at(-1);
  const legacyPlanNeedsRevalidation =
    task.repositoryAuthorityStatus === "legacy-unbound" &&
    (task.currentStage === "plan" ||
      task.currentStage === "implement" ||
      (task.workPackages?.length ?? 0) > 0 ||
      task.artifacts.some((artifact) => artifact.stage === "plan"));
  if (task.blocker?.code === "stale-plan" || legacyPlanNeedsRevalidation)
    return {
      action: "revalidate-plan" as const,
      label: "Revalidate plan against current target",
      title:
        task.repositoryAuthorityStatus === "legacy-unbound" ? "Plan revision is unbound" : "Plan is stale",
      detail:
        task.blocker?.detail ??
        "Retain the historical plan, inspect the current target revision, and produce a new revision-bound plan before approval or implementation.",
    };
  if (task.status === "awaiting-already-satisfied")
    return {
      action: "close-already-satisfied" as const,
      label: "Close — already implemented",
      title: "Human review required",
      detail:
        "Review the concrete repository evidence. The harness will not close this task from model judgement alone.",
    };
  if (
    (task.status === "merging" && task.pullRequestIntent?.status === "publishing") ||
    (task.status === "awaiting-pr-merge" && task.pullRequestIntent?.status === "open") ||
    (task.status === "blocked" &&
      task.blocker?.code === "pull-request-publication" &&
      task.pullRequestIntent?.status === "failed") ||
    (task.status === "blocked" &&
      task.blocker?.code === "pull-request-closed" &&
      task.pullRequestIntent?.status === "closed")
  )
    return {
      action: "reconcile-pr" as const,
      label:
        task.status === "awaiting-pr-merge"
          ? "Check GitHub now"
          : task.blocker?.code === "pull-request-closed"
            ? "Check reopened PR"
            : "Retry PR publication",
      title:
        task.status === "awaiting-pr-merge"
          ? "Awaiting GitHub PR merge"
          : task.blocker?.code === "pull-request-closed"
            ? "GitHub PR closed without merge"
            : "GitHub PR publication needs reconciliation",
      detail:
        task.status === "awaiting-pr-merge"
          ? `The Harness polls GitHub automatically. PR #${task.pullRequestIntent?.number ?? "pending"} must retain the exact approved head before a merge can complete this task.`
          : task.blocker?.code === "pull-request-closed"
            ? "If the same PR was reopened on GitHub, recheck it without changing the approved candidate revision."
            : "Reconcile the exact remote branch and PR identity without changing the approved candidate revision.",
    };
  if (
    (task.status === "merging" && task.mergeIntent?.status === "pending") ||
    (task.status === "blocked" &&
      task.blocker?.code === "merge-reconciliation" &&
      task.mergeIntent?.status === "failed")
  )
    return {
      action: "reconcile-merge" as const,
      label: "Reconcile retained merge",
      title: "Merge intent requires reconciliation",
      detail:
        "Recheck the exact approved candidate and target. If the target advanced, the task will move to candidate refresh and require fresh candidate-bound gates and approval.",
    };
  if (task.status === "blocked" && task.blocker?.code === "target-refresh-conflict")
    return {
      action: "rebuild-candidate" as const,
      label: "Rebuild from latest target",
      title: "Candidate refresh conflicted",
      detail:
        "Retain the prior candidate for audit, re-run its approved work packages from the latest target, and assemble a new exact candidate.",
    };
  if (task.status === "blocked" && task.blocker?.code === "implementation-target-diverged")
    return {
      action: "restart-implementation" as const,
      label: "Restart from latest target",
      title: "Target advanced during implementation",
      detail:
        "Keep prior artifacts for audit, restart the approved packages from the current target, and qualify them under bounded concurrency.",
    };
  const targetDiverged =
    task.status === "blocked" &&
    (task.blocker?.code === "target-diverged" ||
      /target ref (?:diverged|moved)|target branch advanced/i.test(task.error ?? ""));
  if (targetDiverged)
    return {
      action: "refresh-candidate" as const,
      label: `Refresh candidate from ${candidate?.baseBranch ?? "target"}`,
      title: "Target branch advanced",
      detail:
        "Replay the retained candidate onto the latest target as a new revision. The prior revision remains inspectable and every candidate-bound gate must run again.",
    };
  const retainedTimedOutPackage = [...(task.workPackages ?? [])]
    .reverse()
    .find(
      (workPackage) =>
        workPackage.status === "failed" &&
        Boolean(workPackage.worktreePath) &&
        /run exceeded \d+ seconds|harness stopped while this task was running/i.test(
          workPackage.error ?? task.error ?? "",
        ),
    );
  if (
    retainedTimedOutPackage &&
    ["failed", "blocked"].includes(task.status) &&
    task.currentStage === "implement"
  )
    return {
      action: "continue-package" as const,
      label: `Continue retained ${retainedTimedOutPackage.id}`,
      title: "Resume the retained implementation package",
      detail:
        "Validate the exact retained branch and dirty files, continue without discarding in-scope progress, restore paths outside declared ownership, and use the bounded 30-minute continuation timeout.",
    };
  const invalidApprovedPlan =
    ["failed", "blocked"].includes(task.status) &&
    task.currentStage === "implement" &&
    /verification requires at least one repository manifest command id|approved plan does not contain executable work packages|did not qualify/i.test(
      task.error ?? "",
    );
  if (invalidApprovedPlan)
    return {
      action: "plan" as const,
      label: "Correct implementation plan",
      title: "Approved plan is not executable",
      detail:
        "Return to read-only planning and produce valid repository manifest command IDs before another implementation attempt.",
    };
  const latestTestArtifact = [...task.artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.stage === "test" &&
        artifact.candidateId === candidate?.id &&
        artifact.candidateRevision === candidate?.revisionNumber,
    );
  const blockingCandidateDefect = latestTestArtifact?.gateResult?.findings?.some(
    (finding) => finding.blocking === true && finding.kind === "candidate-defect",
  );
  const sameCandidateTestRetryUsed = task.sameCandidateTestRetries?.some(
    (retry) => retry.candidateId === candidate?.id && retry.candidateRevision === candidate?.revisionNumber,
  );
  const failedExactCandidateVerification = [...(candidate?.verificationRuns ?? [])]
    .reverse()
    .find(
      (verification) =>
        verification.candidateId === candidate?.id &&
        verification.candidateRevision === candidate?.revisionNumber &&
        verification.headRevision === candidate?.headRevision &&
        verification.status === "failed" &&
        verification.retryDisposition !== "human-rerun-requested",
    );
  if (
    ["repair-required", "failed", "blocked"].includes(task.status) &&
    task.currentStage === "test" &&
    (latestTestArtifact?.focusedTest?.status === "failed" || failedExactCandidateVerification) &&
    !blockingCandidateDefect &&
    !sameCandidateTestRetryUsed
  )
    return {
      action: "retry-test" as const,
      label: `Retry Test on ${candidate?.id} r${candidate?.revisionNumber}`,
      title: "Verification failed without a typed candidate defect",
      detail:
        "Run the full repository manifest once more against the unchanged candidate. Repair remains unauthorized unless retained evidence identifies a candidate defect.",
    };
  if (
    ["failed", "cancelled"].includes(task.status) &&
    task.currentStage === "specification" &&
    !retryAllowanceExhausted
  ) {
    if (task.designRequest?.status === "failed") {
      return {
        action: "specification" as const,
        label: "Retry failed design",
        title: "Retry the failed design provider",
        detail:
          task.designRequest.error ??
          "Only failed design directions will run again; completed provider evidence remains retained.",
      };
    }
    return {
      action: "specification" as const,
      label: "Retry specification",
      title: "Retry the failed specification synthesis",
      detail: task.error ?? "The prior specification synthesis failed; retained evidence remains available.",
    };
  }
  if (
    (task.status === "blocked" ||
      (["repair-required", "failed"].includes(task.status) && retryAllowanceExhausted)) &&
    task.candidates?.at(-1)?.status === "repair_required"
  )
    return {
      action: "grant-retry" as const,
      label: "Grant one repair attempt",
      title: "Repair allowance exhausted",
      detail:
        "A human may grant exactly one additional attempt. The retained candidate and every failed review remain unchanged.",
    };
  if (
    retryAllowanceExhausted &&
    ["ready-for-review", "review-retry-required", "ready-for-test", "ready-for-final-review"].includes(
      task.status,
    )
  )
    return {
      action: "grant-retry" as const,
      label: "Grant one stage attempt",
      title: "Stage retry allowance exhausted",
      detail: "A human may grant one additional attempt before this retained candidate enters the next gate.",
    };
  if (retryAllowanceExhausted && task.status === "awaiting-plan-approval")
    return {
      action: "grant-retry" as const,
      label: "Grant one Plan attempt",
      title: "Plan revision allowance exhausted",
      detail:
        "After inspecting the retained plans, a human may grant exactly one additional correction attempt.",
    };
  if (task.status === "awaiting-spec-approval") {
    return task.workflow === "implement"
      ? {
          action: "approve-spec" as const,
          label: "Approve spec & create plan",
          title: "Approve the specification",
          detail: "Approval records this specification and starts a read-only planning agent.",
        }
      : {
          action: "approve-spec" as const,
          label: "Approve investigation",
          title: "Approve the investigation handoff",
          detail: "Approval closes this investigate-only task with the specification retained.",
        };
  }
  if (task.status === "awaiting-plan-approval")
    return {
      action: "approve-plan" as const,
      label: "Approve plan",
      title: "Approve the dependency-ordered plan",
      detail:
        "Approve it, or record a concrete correction and revise it. No repository changes happen until approval.",
    };
  if (task.status === "ready-for-implementation")
    return {
      action: "implement" as const,
      label: "Start isolated implementation",
      title: "Create an isolated implementation candidate",
      detail:
        "The harness verifies a clean repository, creates a Git worktree, and gives Codex write access only there.",
    };
  if (task.status === "ready-for-review" || task.status === "review-retry-required")
    return {
      action: "review" as const,
      label: task.status === "review-retry-required" ? "Retry independent review" : "Run development review",
      title:
        task.status === "review-retry-required"
          ? "Reviewer tooling failed — candidate repair is not indicated"
          : "Review the exact candidate revision",
      detail:
        task.status === "review-retry-required"
          ? "Failed reviewer telemetry is retained. A fresh read-only review must inspect the complete unchanged candidate diff."
          : "The reviewer is bound to the candidate commit and cannot modify it.",
    };
  if (task.status === "ready-for-test")
    return {
      action: "test" as const,
      label: "Run full candidate verification",
      title: "Verify the reviewed candidate",
      detail:
        "The harness runs the complete argv-only repository verification manifest once for this exact candidate revision.",
    };
  if (task.status === "ready-for-final-review")
    return {
      action: "final-review" as const,
      label: "Run final review",
      title: "Run the holdout final review",
      detail: "This gate summarizes every retained artifact against the approved acceptance criteria.",
    };
  if (task.status === "awaiting-human-approval") {
    const staleGate = candidateGateStages
      .map((stage) => ({ stage, freshness: getRuntimeGateFreshness(task, stage) }))
      .find(({ freshness }) => !freshness?.fresh);
    return {
      action: "open-pr" as const,
      label: "Approve & raise PR",
      title: staleGate ? "Human approval blocked" : "Human PR approval required",
      detail: staleGate
        ? `Approval is blocked until ${workflowStages.find((stage) => stage.id === staleGate.stage)?.shortLabel ?? staleGate.stage} is fresh. ${staleGate.freshness?.reasonCopy ?? "No authoritative persisted terminal run summary is available for this candidate."}`
        : "The Harness will push only the exact reviewed candidate SHA, raise a GitHub PR to the recorded target, and complete this task after that PR is merged.",
    };
  }
  if (task.status === "merged-to-target")
    return {
      action: "complete-merged" as const,
      label: "Mark completed",
      title: "Candidate merged · promotion is a manual step",
      detail:
        "The candidate fast-forwarded its recorded target branch. The harness does not promote it further; copy the git command below to push it onward, then mark this task completed to record that decision.",
    };
  if (task.status === "completed")
    return {
      action: task.workflow === "investigate" ? ("continue-implementation" as const) : null,
      label:
        task.workflow === "investigate"
          ? task.continuedByTaskId
            ? "Open implementation task"
            : "Continue to implementation"
          : "Completed",
      title:
        task.workflow === "implement"
          ? task.pullRequestIntent?.status === "merged"
            ? "GitHub PR merged"
            : "Candidate merged"
          : task.continuedByTaskId
            ? `Implementation continued as ${task.continuedByTaskId}`
            : "Investigation approved",
      detail:
        task.workflow === "investigate"
          ? task.continuedByTaskId
            ? "The approved investigation remains read-only; the linked task owns planning and implementation authority."
            : "Create a separate implementation task with this approved evidence, then begin read-only planning."
          : "The durable task evidence remains available from every completed stage.",
    };
  if (task.status === "failed") {
    if (task.candidates?.at(-1)?.status === "repair_required") {
      return {
        action: "repair" as const,
        label: "Retry repair",
        title: "Retry the candidate repair",
        detail:
          task.error ?? "The failed repair attempt left the last committed candidate revision unchanged.",
      };
    }
    const actions: Partial<Record<StageId, "plan" | "implement" | "review" | "test" | "final-review">> = {
      plan: "plan",
      implement: "implement",
      "dev-review": "review",
      test: "test",
      "final-review": "final-review",
    };
    const action = actions[task.currentStage];
    if (action)
      return {
        action,
        label: `Retry ${workflowStages.find((stage) => stage.id === task.currentStage)?.shortLabel ?? "stage"}`,
        title: "Retry the failed stage",
        detail: task.error ?? "The prior attempt failed; retained evidence will remain available.",
      };
  }
  if (task.status === "repair-required")
    return {
      action: "repair" as const,
      label: "Repair candidate",
      title: "Candidate repair required",
      detail:
        "The repair agent works in the same isolated worktree, creates a new candidate revision, and sends it through review again.",
    };
  return null;
}

export function getAccessBoundaryCopy(task: RuntimeTask) {
  const stage = workflowStages.find((entry) => entry.id === task.currentStage);
  const stageLabel = stage?.label ?? "Current stage";
  if (task.status === "awaiting-grill") {
    return {
      kicker: "Human decision boundary",
      title: "Grill Me is waiting for your decisions",
      detail:
        "No agent is running. Answer the material questions or explicitly accept the recommended assumptions.",
      sandbox: "No agent running",
    };
  }
  if (task.currentStage === "implement" || task.status === "repair-required") {
    const repairRequired = task.status === "repair-required";
    return {
      kicker: "Worktree write scope",
      title: `${repairRequired ? "Implement repair" : stageLabel} is confined to the isolated candidate worktree`,
      detail: repairRequired
        ? `The failed ${stageLabel} gate remains the workflow position; only the Implement repair agent may write inside the isolated candidate worktree.`
        : "Codex may write only inside the isolated candidate worktree for this stage.",
      sandbox: "Isolated candidate worktree",
    };
  }
  if (task.currentStage === "test") {
    return {
      kicker: "Candidate cleanliness boundary",
      title: `${stageLabel} may create temporary files while testing`,
      detail:
        "Temporary files are allowed, but the exact candidate revision must be left clean when the gate completes.",
      sandbox: "Temporary writes allowed, candidate must remain clean",
    };
  }
  return {
    kicker: "Read-only boundary",
    title: `${stageLabel} is read-only`,
    detail: task.repositoryAuthority
      ? `Codex reads a detached evidence worktree at ${task.repositoryAuthority.selectedRevision.slice(0, 8)}. Operator checkout changes are excluded.`
      : "Codex reads the repository without writing to it in this stage.",
    sandbox: task.repositoryAuthority ? "Detached read-only evidence worktree" : "Read-only",
  };
}
