import type { RuntimeRun, RuntimeUsage, StageId } from "../domain.ts";

export interface WorkspaceHead {
  available: boolean;
  sourceId: string | null;
  upper: number;
  floor: number;
  coverageStartAt: string | null;
  capturedAt: string;
  reason: string | null;
}
export interface WatchRun {
  id: string;
  stage: StageId;
  status: RuntimeRun["status"];
  role?: string | null;
  model?: string | null;
  reasoning?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  usage?: RuntimeUsage | null;
}
export interface WatchedRun {
  taskId: string;
  run: WatchRun | null;
  active: boolean;
}
export interface WorkspaceChange {
  sequence: number;
  observedAt: string;
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  projectName: string | null;
  stage: StageId;
  kind: "task-state" | "candidate-gates" | "artifact-arrived" | "run-completed";
  label: string;
  reason: string | null;
  status?: string;
  nextActor?: string | null;
  run?: WatchRun;
  artifactId?: string;
  candidateId?: string;
  candidateRevision?: number;
  candidateHeadRevision?: string | null;
}
export interface WorkspaceHistoryRequest {
  sourceId: string;
  after: number;
  through: number;
  cursor?: string | null;
  limit?: number;
}
export interface WorkspaceHistoryPage {
  sourceId: string;
  after: number;
  through: number;
  items: WorkspaceChange[];
  nextCursor: string | null;
  coverage: { complete: boolean; floor: number; reason: string | null };
}
