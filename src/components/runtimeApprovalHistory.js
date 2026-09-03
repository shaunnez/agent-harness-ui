import React from "react";

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
  promotion: "Promotion to completed",
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

// Absent on approvals persisted before per-gate policy existed; those read as human,
// exactly like every approval always used to be. See docs/auto-approve-gates-proposal.md.
export function isPolicyApproval(approval) {
  return approval?.actor?.kind === "policy";
}

export function ApprovalHistorySection({ approvals = [] }) {
  return React.createElement(
    "div",
    { className: "runtime-approval-history" },
    approvals.length
      ? approvals.map((approval) =>
          React.createElement(
            "div",
            { className: "runtime-approval-row", key: approval.id },
            React.createElement(
              "span",
              { className: "runtime-meta-row" },
              React.createElement("small", null, "Stage"),
              React.createElement(
                "strong",
                null,
                formatApprovalStage(approval.stage),
                isPolicyApproval(approval)
                  ? React.createElement(
                      "span",
                      { className: "badge badge--blue runtime-approval-row__policy-badge" },
                      "Approved by policy",
                    )
                  : null,
              ),
            ),
            React.createElement(
              "span",
              { className: "runtime-meta-row" },
              React.createElement("small", null, "Note"),
              React.createElement("strong", null, approval.note?.trim() || "Approved without a note."),
            ),
            React.createElement(
              "span",
              { className: "runtime-meta-row" },
              React.createElement("small", null, "Timestamp"),
              React.createElement(
                "strong",
                { className: "mono" },
                formatApprovalTimestamp(approval.createdAt),
              ),
            ),
          ),
        )
      : React.createElement("small", null, "No approvals recorded yet."),
  );
}
