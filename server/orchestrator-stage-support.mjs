import { recordNodeExecuted } from "./topology-trace.mjs";

export const RUN_KINDS = new Set([
  "investigation",
  "specification",
  "planning",
  "implementation",
  "repair",
  "review",
  "test",
  "final-review",
]);

export function now() {
  return new Date().toISOString();
}

export class FastProfileReplanError extends Error {
  constructor(message, workPackageId = null) {
    super(message);
    this.name = "FastProfileReplanError";
    this.code = "FAST_PROFILE_REPLAN_REQUIRED";
    this.workPackageId = workPackageId;
  }
}

export function zeroUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    credits: 0,
  };
}

export async function allSettledWithConcurrency(items, limit, worker) {
  const outcomes = new Array(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        outcomes[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        outcomes[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return outcomes;
}

export function deterministicGateResult(stage, candidate, passed, blockingReasons) {
  return {
    verdict: passed ? "PASS" : "REPAIR",
    candidateId: candidate.id,
    candidateRevision: candidate.revisionNumber,
    schemaVersion: 1,
    stage,
    reportedVerdict: passed ? "PASS" : "REPAIR",
    evaluatedAt: now(),
    findings: [],
    blockingReasons,
  };
}

export function deterministicTestMarkdown(candidate, verification) {
  const rows = verification.rows
    .map(
      (row) =>
        `- **${row.id}: ${String(row.status).toUpperCase()}** — \`${row.command}\` (${row.durationMs}ms, exit ${row.exitCode ?? "unavailable"})`,
    )
    .join("\n");
  return `# Focused Test\n\n- Candidate: ${candidate.id} revision ${candidate.revisionNumber}\n- Head: ${candidate.headRevision}\n- Full manifest result: ${String(verification.status).toUpperCase()}\n- Duration: ${verification.durationMs}ms\n\n${rows}\n\nThis artifact was generated from harness-observed command evidence; no model interpreted or reran the manifest.`;
}

export function deterministicFinalReviewMarkdown(task, candidate, verification) {
  const review = [...(task.runs ?? [])]
    .reverse()
    .find(
      (run) =>
        run.stage === "dev-review" &&
        run.candidateId === candidate.id &&
        run.candidateRevision === candidate.revisionNumber &&
        run.gateResult?.verdict === "PASS",
    );
  const followUps = (review?.gateResult?.findings ?? []).filter((finding) => !finding.blocking);
  return `# Deterministic Final Review\n\n## Verdict\n\nPASS for ${candidate.id} revision ${candidate.revisionNumber} at ${candidate.headRevision}.\n\n## Workflow summary\n\n- Profile: fast\n- Work packages: exactly one\n- Development Review: independent PASS${followUps.length ? ` with ${followUps.length} non-blocking follow-up item${followUps.length === 1 ? "" : "s"}` : " with no findings"}\n- Full repository manifest: ${String(verification.status).toUpperCase()} once for this revision in ${verification.durationMs}ms\n- Candidate repairs: ${(candidate.revisions ?? []).filter((revision) => revision.reason === "repair").length}\n\n## Acceptance criteria\n\nThe bounded fast change contract remains in the retained Triage artifact. No unresolved blocking risk is recorded.\n\n## Evidence\n\nThe exact candidate-bound Dev Review and Focused Test artifacts are the authoritative evidence. Skipped stages retain explicit not-required reasons; they are not represented as completed runs.\n\n## Residual risks\n\n${followUps.length ? followUps.map((finding) => `- ${finding.severity}: ${finding.title}`).join("\n") : "- None recorded."}\n\n## Human approval brief\n\nHuman Approval must still revalidate the exact candidate revision, target, clean worktrees, and all three fresh candidate-bound gates before fast-forward merge.`;
}

export function workPackageVerificationMarkdown(verification) {
  const rows = (verification.rows ?? []).map((row) => {
    const detail = row.failureDetails ? `\n\n${row.failureDetails}` : "";
    return `### ${row.id}: ${String(row.status).toUpperCase()}\n\n- Command: \`${row.command}\`\n- Duration: ${row.durationMs}ms${detail}`;
  });
  const skipped = (verification.declaredCommandIds ?? []).filter(
    (id) => !(verification.executedCommandIds ?? []).includes(id),
  );
  return `## Harness slice qualification\n\n- Result: ${String(verification.status).toUpperCase()}\n- Revision: ${verification.headRevision}\n- Source: ${verification.command}\n${skipped.length ? `- Skipped after failure: ${skipped.join(", ")}\n` : ""}\n${rows.join("\n\n")}`;
}

export function activity(stage, title, detail, tone = "info", category = "activity", metadata = {}) {
  return { id: crypto.randomUUID(), at: now(), category, tone, stage, title, detail, ...metadata };
}

export function completeGrillSession(draft, { source, acceptRemaining }) {
  if (draft.grillSession?.status !== "open") {
    throw new Error("This task does not have an open Grill Me session.");
  }
  const unresolved = draft.grillSession.questions.filter((question) => !question.answer);
  if (unresolved.length && !acceptRemaining) {
    throw new Error("Answer every Grill question or explicitly accept the recommended assumptions.");
  }

  const acceptedDecisionIds = [];
  for (const question of unresolved) {
    const recommendation = question.options.find((option) => option.recommended);
    if (!recommendation) throw new Error(`Grill question ${question.id} has no recommended answer.`);
    question.answer = recommendation.label;
    question.answerSource =
      source === "automation-policy" ? "automation-policy" : "operator-accepted-recommendation";
    question.resolvedAt = now();
    const decision = {
      id: crypto.randomUUID(),
      grillQuestionId: question.id,
      question: question.question,
      answer: recommendation.label,
      createdAt: now(),
    };
    draft.decisions.push(decision);
    acceptedDecisionIds.push(decision.id);
  }

  const acceptedCount = unresolved.length;
  draft.grillSession.status = "completed";
  draft.grillSession.completedAt = now();
  draft.grillSession.completionSource = source;
  draft.grillSession.policySnapshot = draft.grillPolicy ?? "manual";
  draft.grillSession.acceptedRecommendationCount = acceptedCount;
  draft.grillSession.completionReason =
    source === "automation-policy"
      ? `Automatically accepted ${acceptedCount} recommended assumption${acceptedCount === 1 ? "" : "s"} under the task's Grill policy.`
      : acceptedCount
        ? `Finished by the operator with ${acceptedCount} recommended assumption${acceptedCount === 1 ? "" : "s"} accepted.`
        : "All material questions were answered by the operator.";
  if (!draft.completedStages.includes("grill")) {
    draft.completedStages.push("grill");
    recordNodeExecuted(draft, "grill");
  }
  draft.events.push(
    activity(
      "grill",
      source === "automation-policy" ? "Grill recommendations accepted automatically" : "Grill Me completed",
      draft.grillSession.completionReason,
      "success",
      "decision",
      {
        decisionIds: acceptedDecisionIds,
        grillCompletionSource: source,
        grillPolicy: draft.grillSession.policySnapshot,
        acceptedRecommendationCount: acceptedCount,
      },
    ),
  );
}
