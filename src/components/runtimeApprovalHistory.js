const STAGE_LABELS = {
  triage: "Triage",
  scouts: "Repository scouts",
  grill: "Grill with docs",
  specification: "Task specification",
  plan: "Implementation plan",
  implement: "Implement",
  "dev-review": "Dev review",
  test: "Test",
  "final-review": "Final review",
  approval: "Human approval",
};

export function getApprovalHistory(approvals) {
  return approvals ?? [];
}

export function formatApprovalStage(stage) {
  return STAGE_LABELS[stage] ?? stage;
}

export function formatApprovalTimestamp(createdAt) {
  return new Date(createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}
