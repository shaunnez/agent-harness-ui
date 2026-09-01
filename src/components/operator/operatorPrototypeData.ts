import type { StageId } from "../../domain";

export type OperatorPreviewState = "running" | "needs-input" | "blocked" | "repair" | "completed";
export type OperatorTone = "blue" | "green" | "amber" | "red" | "muted";

export interface OperatorBriefingItem {
  label: string;
  value: string;
  detail: string;
  tone: OperatorTone;
}

export interface OperatorStageDefinition {
  eyebrow: string;
  title: string;
  summary: string;
  nextAction: string;
  handoff: string;
  updated: string;
  briefing: OperatorBriefingItem[];
  aside: Array<{ label: string; value: string; detail: string; tone?: OperatorTone }>;
}

export const operatorPreviewStates: Array<{ id: OperatorPreviewState; label: string }> = [
  { id: "running", label: "Running" },
  { id: "needs-input", label: "Needs input" },
  { id: "blocked", label: "Blocked" },
  { id: "repair", label: "Repair" },
  { id: "completed", label: "Completed" },
];

export const operatorStageDefinitions: Record<StageId, OperatorStageDefinition> = {
  triage: {
    eyebrow: "Triage · routing gate",
    title: "High-risk implementation route selected",
    summary: "The task is correctly scoped to one repository and needs the full evidence workflow.",
    nextAction: "Start repository scouts",
    handoff: "Routing is settled. Repository investigation can begin with three targeted scouts.",
    updated: "09:12",
    briefing: [
      { label: "Current state", value: "Triage complete", detail: "Stage 1 of 10", tone: "green" },
      { label: "Health", value: "Ready", detail: "No routing conflicts", tone: "green" },
      { label: "What changed", value: "Risk raised", detail: "Medium → high", tone: "amber" },
      { label: "Workflow", value: "High-risk", detail: "All gates required", tone: "blue" },
      { label: "Next safe action", value: "Dispatch scouts", detail: "3 selected", tone: "amber" },
    ],
    aside: [
      { label: "Route", value: "Implement", detail: "Code change with candidate gates", tone: "blue" },
      { label: "Risk", value: "High", detail: "Repository and schema boundaries", tone: "amber" },
      { label: "Workflow profile", value: "High-risk", detail: "No stages skipped" },
    ],
  },
  scouts: {
    eyebrow: "Repo scouts · evidence gate",
    title: "Three scouts covered the material code paths",
    summary: "Code path, schema, and test inventory evidence is ready; three low-value scouts were skipped.",
    nextAction: "Open Grill decisions",
    handoff: "Scout synthesis is complete with one explicit evidence gap carried into Grill.",
    updated: "09:19",
    briefing: [
      { label: "Current state", value: "Evidence retained", detail: "Stage 2 of 10", tone: "green" },
      { label: "Health", value: "3 complete", detail: "0 scout failures", tone: "green" },
      { label: "What changed", value: "12 paths found", detail: "4 are material", tone: "blue" },
      { label: "Evidence gaps", value: "1 known", detail: "Migration ownership", tone: "amber" },
      { label: "Next safe action", value: "Resolve decisions", detail: "2 questions", tone: "amber" },
    ],
    aside: [
      { label: "Dispatch", value: "3 of 6 scouts", detail: "Selected by task risk", tone: "blue" },
      { label: "Evidence", value: "18 claims", detail: "16 direct · 2 inferred", tone: "green" },
      { label: "Gap", value: "Migration owner", detail: "Needs operator decision", tone: "amber" },
    ],
  },
  grill: {
    eyebrow: "Grill with docs · decision desk",
    title: "One material decision remains",
    summary: "Repository evidence supports the recommended database ownership boundary.",
    nextAction: "Accept recommendation",
    handoff: "Two of three decisions are recorded. One answer will make the specification ready.",
    updated: "09:24",
    briefing: [
      { label: "Current state", value: "Needs input", detail: "Stage 3 of 10", tone: "amber" },
      { label: "Health", value: "2 of 3 settled", detail: "1 material question", tone: "amber" },
      { label: "What changed", value: "Schema gap surfaced", detail: "Scout evidence", tone: "blue" },
      { label: "Recommendation", value: "Use existing owner", detail: "Lowest change risk", tone: "green" },
      { label: "Next safe action", value: "Record answer", detail: "Then build spec", tone: "amber" },
    ],
    aside: [
      { label: "Progress", value: "2 / 3", detail: "Material questions answered", tone: "amber" },
      { label: "Evidence", value: "4 repository claims", detail: "All directly sourced", tone: "green" },
      { label: "Policy", value: "Manual", detail: "Operator answer required" },
    ],
  },
  specification: {
    eyebrow: "Task specification · durable handoff",
    title: "Specification is ready for approval",
    summary: "Five acceptance criteria cover behaviour, safety, compatibility, verification, and rollback.",
    nextAction: "Approve specification",
    handoff: "Scope is bounded and testable. Approval will unlock dependency planning.",
    updated: "09:31",
    briefing: [
      { label: "Current state", value: "Awaiting approval", detail: "Stage 4 of 10", tone: "amber" },
      { label: "Health", value: "Complete", detail: "No unresolved decisions", tone: "green" },
      { label: "What changed", value: "5 criteria defined", detail: "2 explicit exclusions", tone: "blue" },
      { label: "Coverage", value: "5 of 5", detail: "All criteria testable", tone: "green" },
      { label: "Next safe action", value: "Approve spec", detail: "Then plan packages", tone: "amber" },
    ],
    aside: [
      { label: "Acceptance", value: "5 criteria", detail: "All independently verifiable", tone: "green" },
      { label: "Scope", value: "2 exclusions", detail: "No API or schema expansion" },
      { label: "Decisions", value: "3 recorded", detail: "All carried forward", tone: "blue" },
    ],
  },
  plan: {
    eyebrow: "Implementation plan · dependency batches",
    title: "Four packages form three dependency batches",
    summary: "S2 and S3 can run in parallel after S1; S4 assembles the final candidate.",
    nextAction: "Approve implementation plan",
    handoff: "The plan is dependency-safe and every package owns paths and verification commands.",
    updated: "09:38",
    briefing: [
      { label: "Current state", value: "Plan ready", detail: "Stage 5 of 10", tone: "green" },
      { label: "Health", value: "No conflicts", detail: "Path ownership is exclusive", tone: "green" },
      { label: "What changed", value: "4 packages", detail: "3 dependency batches", tone: "blue" },
      { label: "Critical path", value: "S1 → S2 → S4", detail: "3 sequential steps", tone: "blue" },
      { label: "Next safe action", value: "Start Implement", detail: "S1 begins first", tone: "amber" },
    ],
    aside: [
      { label: "Packages", value: "4", detail: "2 can run in parallel", tone: "blue" },
      { label: "Ownership", value: "No overlap", detail: "6 paths assigned", tone: "green" },
      { label: "Verification", value: "4 commands", detail: "Manifest-backed" },
    ],
  },
  implement: {
    eyebrow: "Implement · isolated work packages",
    title: "Two packages qualified; one is running",
    summary: "S2 is the only active dependency. S4 waits for its qualification before candidate assembly.",
    nextAction: "Monitor S2 to qualification",
    handoff: "Implement is in progress. Three of four packages are ready downstream.",
    updated: "09:46",
    briefing: [
      { label: "Current state", value: "Implement in progress", detail: "Stage 6 of 10", tone: "blue" },
      { label: "Health", value: "1 running · 2 qualified", detail: "1 waiting · 0 failures", tone: "green" },
      { label: "What changed", value: "S1 and S3 qualified", detail: "S2 started at 09:43", tone: "blue" },
      { label: "Candidate readiness", value: "3 of 4 ready", detail: "S4 waits for S2", tone: "green" },
      { label: "Next safe action", value: "Monitor S2", detail: "Then assemble S4", tone: "amber" },
    ],
    aside: [
      { label: "Active agent", value: "gpt-5.6-luna", detail: "Implementing S2", tone: "blue" },
      { label: "Package progress", value: "52%", detail: "6 of 11 checks complete", tone: "blue" },
      { label: "Candidate", value: "3 of 4 ready", detail: "Assembly not started", tone: "green" },
    ],
  },
  "dev-review": {
    eyebrow: "Dev review · fresh-context advisor",
    title: "Candidate C1 r2 passed review",
    summary: "No blocking or advisory findings were recorded against the exact candidate revision.",
    nextAction: "Proceed to Test",
    handoff: "Development review passed. Candidate C1 r2 remains fresh and ready for verification.",
    updated: "09:54",
    briefing: [
      { label: "Current state", value: "Review complete", detail: "Stage 7 of 10", tone: "green" },
      { label: "Health", value: "PASS", detail: "0 blocking findings", tone: "green" },
      { label: "What changed", value: "Review retained", detail: "Exact candidate bound", tone: "blue" },
      { label: "Candidate", value: "C1 revision 2", detail: "2afbdfb0", tone: "blue" },
      { label: "Next safe action", value: "Run Test", detail: "Full manifest", tone: "amber" },
    ],
    aside: [
      { label: "Verdict", value: "PASS", detail: "0 total findings", tone: "green" },
      { label: "Candidate", value: "C1 r2", detail: "2afbdfb0", tone: "blue" },
      { label: "Gate freshness", value: "Fresh", detail: "Exact revision matched", tone: "green" },
    ],
  },
  test: {
    eyebrow: "Test · candidate-bound gate",
    title: "Eleven checks passed against C1 r2",
    summary: "Focused and full-manifest verification completed without failures or skipped commands.",
    nextAction: "Proceed to Final Review",
    handoff: "The exact candidate passed all declared commands and is ready for holdout review.",
    updated: "10:02",
    briefing: [
      { label: "Current state", value: "Test complete", detail: "Stage 8 of 10", tone: "green" },
      { label: "Health", value: "11 passed", detail: "0 failed · 0 skipped", tone: "green" },
      { label: "What changed", value: "Full manifest ran", detail: "4 commands", tone: "blue" },
      { label: "Candidate", value: "C1 revision 2", detail: "Fresh evidence", tone: "green" },
      { label: "Next safe action", value: "Final Review", detail: "Holdout context", tone: "amber" },
    ],
    aside: [
      { label: "Result", value: "11 / 11 passed", detail: "No skipped commands", tone: "green" },
      { label: "Duration", value: "41 seconds", detail: "Full manifest" },
      { label: "Candidate", value: "C1 r2", detail: "Evidence is fresh", tone: "green" },
    ],
  },
  "final-review": {
    eyebrow: "Final review · holdout",
    title: "The task is ready for human approval",
    summary: "Every required stage has fresh evidence and no unresolved residual risk blocks delivery.",
    nextAction: "Open Human Approval",
    handoff: "Nine stages are complete. The exact candidate can now be reviewed and delivered by a person.",
    updated: "10:09",
    briefing: [
      { label: "Current state", value: "Review complete", detail: "Stage 9 of 10", tone: "green" },
      { label: "Health", value: "READY", detail: "0 blocking risks", tone: "green" },
      { label: "What changed", value: "Holdout passed", detail: "9 stages summarized", tone: "blue" },
      { label: "Gate freshness", value: "3 of 3 fresh", detail: "Candidate-bound gates", tone: "green" },
      { label: "Next safe action", value: "Human Approval", detail: "Inspect exact diff", tone: "amber" },
    ],
    aside: [
      { label: "Readiness", value: "Ready", detail: "No blocking residual risk", tone: "green" },
      { label: "Candidate", value: "C1 r2", detail: "2afbdfb0", tone: "blue" },
      { label: "Evidence", value: "9 stage handoffs", detail: "All retained", tone: "green" },
    ],
  },
  approval: {
    eyebrow: "Human approval · exact candidate",
    title: "Candidate C1 r2 is ready to raise a PR",
    summary:
      "The reviewed head, target branch, three fresh gates, and residual risks are ready for inspection.",
    nextAction: "Approve & raise PR",
    handoff: "Human approval is the only remaining gate. Delivery will bind the PR to this exact head.",
    updated: "10:12",
    briefing: [
      { label: "Current state", value: "Needs approval", detail: "Stage 10 of 10", tone: "amber" },
      { label: "Health", value: "Ready", detail: "No stale evidence", tone: "green" },
      { label: "What changed", value: "Final review passed", detail: "0 blocking risks", tone: "blue" },
      { label: "Candidate", value: "C1 revision 2", detail: "2afbdfb0", tone: "blue" },
      { label: "Next safe action", value: "Approve & raise PR", detail: "Exact head only", tone: "amber" },
    ],
    aside: [
      { label: "Required gates", value: "3 of 3 fresh", detail: "Dev Review · Test · Final", tone: "green" },
      { label: "Target", value: "main", detail: "PR branch will be task-specific" },
      { label: "Residual risk", value: "Low", detail: "Rollback is a two-file revert", tone: "green" },
    ],
  },
};
