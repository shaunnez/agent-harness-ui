import { createHash } from "node:crypto";

// References bind replies to the exact question/options or completed answer set, not just Q1.
export function linearGrillReference(task, question = null) {
  const session = task.grillSession;
  const value = question
    ? [question.id, question.question, question.options, question.allowCustom]
    : session.questions.map((item) => [item.id, item.question, item.options, item.answer]);
  return createHash("sha256")
    .update(JSON.stringify([task.id, session.createdAt, value]))
    .digest("hex")
    .slice(0, 12);
}

export function assertLinearGrillReply(task, input, question = null) {
  const source = task?.externalSource;
  if (
    !input?.eventId ||
    !input.userId ||
    !input.sessionId ||
    source?.provider !== "linear" ||
    source.organizationId !== input.organizationId ||
    source.issueId !== input.issueId ||
    task.status !== "awaiting-grill" ||
    task.grillSession?.status !== "open" ||
    (task.grillPolicy ?? "manual") !== "manual" ||
    input.reference !== linearGrillReference(task, question) ||
    (question ? Boolean(question.answer) : task.grillSession.questions.some((item) => !item.answer))
  )
    throw Object.assign(
      new Error(
        "This Grill reply is stale or does not match an open manual question. Use the latest question in Linear.",
      ),
      { code: "LINEAR_REPLY_INVALID" },
    );
}
