import type { RuntimeFreshness, RuntimeUsage, StageId } from "./domain";

export type RuntimeRunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface RuntimeToolCall {
  id: string | null;
  name: string;
  category: string;
  server?: string | null;
  phase: "started" | "completed";
  result: string | null;
}

export interface RuntimeRunTestSummary {
  candidateId: string;
  candidateRevision: number;
  status: "passed" | "failed";
  command: string;
  durationMs: number | null;
  rowCount: number;
  failedRowIds: string[];
  freshness?: RuntimeFreshness;
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
  gateResult: {
    verdict: "PASS" | "REPAIR";
    candidateId: string;
    candidateRevision: number;
    evaluatedAt: string;
    blockingReasons: string[];
    freshness?: RuntimeFreshness;
  } | null;
  error: string | null;
  source: "codex-jsonl" | "artifact-migration";
  freshness?: RuntimeFreshness;
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
  decisionId?: string | null;
  decisionIds?: string[];
  approvalId?: string | null;
  retryOfRunId?: string | null;
  repairOfRunId?: string | null;
  toolCall?: RuntimeToolCall | null;
}
