import type { StageId } from "./domain";
import type { RuntimeFocusedTestEvidence, RuntimeFocusedTestRow, RuntimeUsage } from "./domain/runtime";

export type RuntimeRunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted" | "timed-out" | "timed_out" | "timeout";

export type RuntimeGateStage = "dev-review" | "test" | "final-review";
export type RuntimeFreshnessReasonCode =
  | "fresh"
  | "missing_binding"
  | "malformed_binding"
  | "mixed_evidence"
  | "candidate_mismatch"
  | "revision_change"
  | "missing_authoritative_summary"
  | "contradictory_evidence"
  | "repair_required"
  | "failed_execution"
  | "timeout"
  | "run_in_progress"
  | "superseded_attempt";

export interface RuntimeFreshnessReason {
  code: RuntimeFreshnessReasonCode;
  copy: string;
}

export interface RuntimeRunFreshness {
  stage: RuntimeGateStage;
  candidateId: string | null;
  candidateRevision: number | null;
  target: { candidateId: string; candidateRevision: number } | null;
  state: "fresh" | "stale";
  fresh: boolean;
  sourceRunId: string | null;
  sourceArtifactId: string | null;
  reasonCode: RuntimeFreshnessReasonCode;
  reasonCopy: string;
  reason: RuntimeFreshnessReason;
  staleReasonCode: Exclude<RuntimeFreshnessReasonCode, "fresh"> | null;
  staleReasonCopy: string | null;
  staleReason: RuntimeFreshnessReason | null;
  focusedTest: RuntimeFocusedTestEvidence | null;
  focusedTestRows: RuntimeFocusedTestRow[];
}

export type RuntimeGateFreshness = RuntimeRunFreshness;

export interface RuntimeToolCall {
  id: string | null;
  name: string;
  category: string;
  server?: string | null;
  phase: "started" | "completed";
  result: string | null;
}

export interface RuntimeRunTestSummary {
  candidateId: string | null;
  candidateRevision: number | null;
  status: "passed" | "failed" | null;
  command: string;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs: number | null;
  rowCount: number;
  failedRowIds: string[];
  rows: RuntimeFocusedTestRow[];
}

export interface RuntimeRun {
  id: string;
  kind: string;
  status: RuntimeRunStatus;
  stage: StageId;
  role: string | null;
  model: string | null;
  reasoning: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  artifactId: string | null;
  usage: RuntimeUsage | null;
  credits: number | null;
  apiEstimate: number | null;
  candidateId: string | null;
  candidateRevision: number | null;
  workPackageId: string | null;
  attempt: number | null;
  retryOfRunId: string | null;
  repairOfRunId: string | null;
  toolCalls: RuntimeToolCall[];
  test: RuntimeRunTestSummary | null;
  evidenceError: RuntimeFreshnessReason | null;
  freshness: RuntimeRunFreshness | null;
  gateResult: {
    verdict: "PASS" | "REPAIR";
    reportedVerdict?: "PASS" | "REPAIR" | null;
    candidateId: string;
    candidateRevision: number;
    evaluatedAt: string;
    blockingReasons: string[];
  } | null;
  error: string | null;
  source: "codex-jsonl" | "artifact-migration";
}

export interface RuntimeEvent {
  id: string;
  at: string;
  category: "activity" | "agent" | "artifact" | "decision" | "tool";
  tone: "success" | "info" | "warning" | "danger";
  stage: StageId;
  title: string;
  detail: string;
  runId?: string | null;
  runKind?: string | null;
  role?: string | null;
  model?: string | null;
  reasoning?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  artifactId?: string | null;
  usage?: RuntimeUsage | null;
  credits?: number | null;
  apiEstimate?: number | null;
  freshness?: RuntimeRunFreshness | null;
  decisionId?: string | null;
  decisionIds?: string[];
  approvalId?: string | null;
  grantedStage?: StageId;
  previousLimit?: number;
  newLimit?: number;
  sourceRunId?: string | null;
  sourceRunIds?: string[];
  candidateId?: string | null;
  candidateRevision?: number | null;
  candidateHeadRevision?: string | null;
  authorizingGateArtifactId?: string | null;
  authorizingGateCandidateId?: string | null;
  authorizingGateCandidateRevision?: number | null;
  authorizingGateCandidateHeadRevision?: string | null;
  authorizingGateKind?: string | null;
  authorizingGateReservedAt?: string | null;
  authorizingGateReservationId?: string | null;
  authorizingGateRunId?: string | null;
  authorizingGateStage?: StageId | null;
  authorizingGateWorkflowAttempt?: number | null;
  candidateProducerArtifactIds?: string[];
  candidateProducerRunIds?: string[];
  workflowAttempt?: number | null;
  workflowCandidateId?: string | null;
  workflowCandidateRevision?: number | null;
  workflowCandidateHeadRevision?: string | null;
  workflowReservationId?: string | null;
  retryOfRunId?: string | null;
  repairOfRunId?: string | null;
  toolCall?: RuntimeToolCall | null;
}
