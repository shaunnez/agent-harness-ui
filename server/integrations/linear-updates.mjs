import { createHash } from "node:crypto";
import { linearGrillReference } from "../linear-grill-contract.mjs";

export const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const labels = {
  specification: "Specification",
  plan: "Plan",
  "dev-review": "Development review",
  test: "Tests",
  "final-review": "Final review",
};
export function taskLink(task, config) {
  return `${config.harnessUrl.replace(/\/$/, "")}#task/${encodeURIComponent(task.id)}`;
}

export function grillUpdate(task, config) {
  if (
    task.status !== "awaiting-grill" ||
    task.grillSession?.status !== "open" ||
    (task.grillPolicy ?? "manual") !== "manual"
  )
    return null;
  const question = task.grillSession.questions.find((item) => !item.answer);
  const reference = linearGrillReference(task, question);
  const footer = `\n\n[Open ${task.id} in Harness](${taskLink(task, config)})`;
  if (!question)
    return {
      key: `grill-ready:${reference}`,
      reference,
      content: {
        type: "elicitation",
        body: `All Grill questions are answered for ${task.id}. Review the recorded answers in Harness, then reply **@Harness continue ${reference}** to finish Grill and start ${task.designRequest?.requested ? "the requested design step" : "the specification"}. This does not approve the specification, plan or delivery.${footer}`,
      },
    };
  const options = question.options
    .map(
      (option, index) =>
        `${index + 1}. **${option.label}**${option.recommended ? " (recommended)" : ""} — ${option.description}`,
    )
    .join("\n");
  return {
    key: `grill-question:${reference}`,
    reference,
    content: {
      type: "elicitation",
      body: `### ${task.id} · Grill ${question.id}\n\n${question.question}\n\n${question.whyItMatters}\n\n${options}\n\nReply **@Harness answer ${reference}: 1** (use the option number)${question.allowCustom !== false ? " or replace the number with your own answer" : ""}. Select Harness from Linear's mention chooser. Each answer is recorded before the next question is posted.${footer}`,
    },
  };
}

export function taskUpdates(task, config) {
  const updates = [];
  const footer = `\n\n[Open ${task.id} in Harness](${taskLink(task, config)})`;
  for (const artifact of task.artifacts ?? []) {
    if (!labels[artifact.stage] || artifact.workPackageId) continue;
    const run = task.runs?.find((item) => item.id === artifact.runId);
    const candidate = task.candidates?.at(-1);
    const stale = Boolean(
      artifact.candidateId &&
        (candidate?.id !== artifact.candidateId ||
          candidate?.revisionNumber !== artifact.candidateRevision ||
          run?.freshness?.fresh === false),
    );
    const excerpt = String(artifact.content ?? "")
      .replace(/```[\s\S]*?```/g, "")
      .trim()
      .slice(0, 1200);
    const verdict = artifact.gateResult?.verdict;
    const findings = artifact.gateResult?.findings
      ?.slice(0, 5)
      .map((item) => `- ${item.severity}: ${item.title}`)
      .join("\n");
    updates.push({
      key: `artifact:${artifact.id}:${stale ? "stale" : "recorded"}`,
      content: {
        type: "response",
        body: `### ${task.id} · ${labels[artifact.stage]} result${stale ? " — stale; rerun required" : ""}\n\n${artifact.candidateId ? `Candidate ${artifact.candidateId}, revision ${artifact.candidateRevision}.\n\n` : ""}${verdict ? `Recorded verdict: **${verdict}**${stale ? " (historical only)" : ""}.\n\n` : ""}${findings || excerpt || "The retained result is available in Harness."}${!findings && excerpt ? "\n\n_Excerpt; see Harness for the complete result._" : ""}${footer}`,
      },
    });
  }
  const status = task.status;
  if (
    [
      "blocked",
      "failed",
      "repair-required",
      "awaiting-spec-approval",
      "awaiting-plan-approval",
      "awaiting-human-approval",
      "awaiting-design-selection",
      "ready-for-implementation",
      "completed",
      "closed",
      "cancelled",
    ].includes(status)
  ) {
    const detail =
      {
        "awaiting-spec-approval": "The specification needs approval in Harness.",
        "awaiting-plan-approval": "The plan needs approval in Harness.",
        "awaiting-human-approval": "Review the exact candidate in Harness before approving PR delivery.",
        "awaiting-design-selection": "Review and select the design in Harness.",
        "ready-for-implementation":
          "The approved plan is ready for implementation. Use Harness for the next action.",
        completed: "The task is recorded as completed in Harness.",
        closed: "The task was closed; this does not mean implementation passed.",
        cancelled: "Execution was cancelled; retained evidence is available in Harness.",
      }[status] ??
      "The task needs attention. Open Harness for the recorded blocker, evidence and next eligible action.";
    updates.push({
      key: `state:${fingerprint([status, task.currentStage, task.error, task.blocker, task.attemptsByStage, task.completedAt, task.closure])}`,
      content: {
        type: ["failed", "blocked", "repair-required"].includes(status) ? "error" : "response",
        body: `### ${task.id} · ${status.replaceAll("-", " ")}\n\n${detail}${footer}`,
      },
    });
  }
  const pr = task.pullRequestIntent;
  if (pr?.url && ["open", "merged", "closed"].includes(pr.status))
    updates.push({
      key: `pr:${fingerprint([pr.url, pr.status, pr.headRevision])}`,
      content: {
        type: "response",
        body: `### ${task.id} · Pull request ${pr.status}\n\n[Open pull request](${pr.url})\n\nCandidate ${pr.candidateId}, revision ${pr.candidateRevision}; commit ${pr.headRevision}.${pr.status === "merged" ? " Merge confirmed by the Harness GitHub reconciliation." : pr.status === "closed" ? " Closed without merging; inspect Harness before proceeding." : " Awaiting merge; the task is not complete."}${footer}`,
      },
    });
  const grill = grillUpdate(task, config);
  if (grill) updates.push(grill); // Elicitation is last so the session stays awaiting input.
  return updates;
}
