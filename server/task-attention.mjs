// Presentation only. Command admission remains in action-policy/retry-admission-policy.
export function projectTaskAttention(task) {
  const stage = task.currentStage;
  const make = (kind, label, reason, nextActor, since = null, questionId = null) => ({
    kind,
    stage,
    label,
    reason: reason || null,
    nextActor,
    since,
    questionId,
  });
  if (["completed", "closed", "archived", "cancelled"].includes(task.status)) {
    const label = { completed: "Completed", closed: "Closed", archived: "Archived", cancelled: "Cancelled" };
    return make("completed", label[task.status], null, null);
  }
  const repairRunning = task.activeRunKind === "repair";
  if (repairRunning) {
    return make("running", "Repair running via Implement", task.blocker?.detail || task.error, "agents");
  }
  if (task.status === "repair-required") {
    return make(
      "repair",
      "Repair required",
      task.blocker?.detail || task.error,
      "you",
      task.blocker?.detectedAt,
    );
  }
  if (task.blocker || task.status === "blocked") {
    return make("blocked", "Blocked", task.blocker?.detail || task.error, "you", task.blocker?.detectedAt);
  }
  const failed = (task.workPackages ?? []).filter((item) => item.status === "failed");
  if (failed.length && !["completed", "closed", "archived"].includes(task.status)) {
    return make("failed", `${failed[0].id} failed`, failed[0].error || task.error, "you");
  }
  if (["failed", "review-retry-required"].includes(task.status)) {
    return make("failed", "Execution stopped", task.error, "you");
  }
  if (task.status === "awaiting-grill") {
    const session = task.grillSession;
    const question = session?.questions?.find((item) => !item.answer);
    return make(
      "answer",
      question ? "Needs your answer" : "Review recorded answers",
      question?.question ||
        (session?.questions?.length
          ? "All questions have recorded answers. Continue to specification when ready."
          : null),
      "you",
      session?.createdAt ?? null,
      question?.id ?? null,
    );
  }
  const approvals = {
    "awaiting-spec-approval": "Review specification",
    "awaiting-plan-approval": "Review plan",
    "awaiting-human-approval": "Review approval",
    "awaiting-design-selection": "Review designs",
    "awaiting-already-satisfied": "Review existing solution",
  };
  if (approvals[task.status]) {
    return make("approval", "Needs your approval", approvals[task.status], "you");
  }
  if (["awaiting-pr-merge", "merging", "merged-to-target"].includes(task.status)) {
    return make("external", "Waiting for delivery", "Awaiting confirmed delivery state", "external");
  }
  if (task.activeRunKind || task.activeRunIds?.length) {
    return make("running", task.status === "cancelling" ? "Stopping" : "Working", null, "agents");
  }
  if (task.status === "ready-for-implementation") {
    return make("idle", "Ready to implement", "Start the approved dependency plan", "you");
  }
  const waiting = (task.workPackages ?? []).find(
    (item) =>
      item.status === "planned" &&
      item.dependencies.some(
        (id) =>
          !(task.workPackages ?? []).some(
            (dependency) =>
              dependency.id === id && ["integrated", "ready_for_integration"].includes(dependency.status),
          ),
      ),
  );
  if (waiting) {
    return make(
      "dependency",
      "Waiting on dependency",
      `${waiting.id} waits for ${waiting.dependencies.join(", ")}`,
      "dependency",
    );
  }
  return make("idle", task.status === "queued" ? "Ready to dispatch" : "Ready for next step", null, "you");
}
