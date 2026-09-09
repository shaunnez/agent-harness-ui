import type { CandidateDiffResponse } from "../../api.ts";
import type { OnboardingProposal, OnboardingReview } from "../../domain/onboarding.ts";
import type {
  NewTaskDraft,
  RolePolicyId,
  RuntimeAgentPolicy,
  RuntimeArtifact,
  RuntimeArtifactMetadata,
  RuntimeAvailableAction,
  RuntimeEvent,
  RuntimePage,
  RuntimeProject,
  RuntimeRepositoryContract,
  RuntimeRun,
  RuntimeStatus,
  RuntimeSettings,
  RuntimeWorktreeInventoryRow,
  RuntimeTaskCore,
  RuntimeTaskPollState,
  RuntimeTaskSummary,
  StageId,
} from "../../domain.ts";
import type { SettingsInput } from "./settings.ts";

export type AttentionKind =
  | "running"
  | "answer"
  | "approval"
  | "dependency"
  | "failed"
  | "repair"
  | "blocked"
  | "external"
  | "unavailable"
  | "idle"
  | "completed";
export interface Attention {
  kind: AttentionKind;
  stage: StageId;
  label: string;
  reason: string | null;
  nextActor: "you" | "agents" | "dependency" | "external" | null;
  since: string | null;
  questionId: string | null;
}
export type TaskSummary = RuntimeTaskSummary & { attention?: Attention };
export type TaskCore = RuntimeTaskCore & { attention?: Attention };
export interface TaskEvidence {
  core: TaskCore;
  runs: RuntimePage<RuntimeRun>;
  activity: RuntimePage<RuntimeEvent>;
}

export interface FrontierGateway {
  readonly mode: "live" | "fixture";
  status(): Promise<RuntimeStatus>;
  saveSettings(input: SettingsInput): Promise<RuntimeSettings>;
  worktrees(taskId: string): Promise<RuntimeWorktreeInventoryRow[]>;
  removeWorktree(taskId: string, rowId: string): Promise<RuntimeWorktreeInventoryRow[]>;
  projects(): Promise<RuntimeProject[]>;
  createProject(input: { name: string; repositoryPath: string }): Promise<RuntimeProject>;
  changeProject(
    id: string,
    change: { kind: "rename" | "archive" | "restore"; name?: string },
  ): Promise<RuntimeProject>;
  repository(repositoryPath: string): Promise<RuntimeRepositoryContract>;
  proposeSetup(repositoryPath: string): Promise<OnboardingReview>;
  approveSetup(repositoryPath: string, proposal: OnboardingProposal): Promise<unknown>;
  updateRole(id: string, role: RolePolicyId, policy: RuntimeAgentPolicy): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
  closeTask(
    id: string,
    input: { reason: "not-needed" | "superseded" | "duplicate"; note: string; supersededBy?: string },
  ): Promise<unknown>;
  archiveTask(id: string, note: string): Promise<unknown>;
  summaries(): Promise<TaskSummary[]>;
  markers(): Promise<RuntimeTaskPollState[]>;
  core(id: string): Promise<TaskCore>;
  runs(id: string, cursor?: string | null): Promise<RuntimePage<RuntimeRun>>;
  activity(id: string, cursor?: string | null): Promise<RuntimePage<RuntimeEvent>>;
  artifact(id: string, artifactId: string): Promise<RuntimeArtifact>;
  artifacts(id: string, cursor?: string | null): Promise<RuntimePage<RuntimeArtifactMetadata>>;
  diff(id: string, candidateId: string, headRevision: string): Promise<CandidateDiffResponse>;
  action(
    id: string,
    action: Exclude<RuntimeAvailableAction, "continue-implementation">,
    note?: string,
    scope?: CandidateScope,
  ): Promise<unknown>;
  decision(id: string, question: string, answer: string): Promise<unknown>;
  continueImplementation(id: string): Promise<{ task: TaskCore; created: boolean }>;
  selectDesign(id: string, variantId: string): Promise<unknown>;
  retryDesign(id: string): Promise<unknown>;
  create(draft: NewTaskDraft): Promise<TaskCore>;
  start(id: string): Promise<unknown>;
  answer(id: string, questionId: string, answer: string): Promise<unknown>;
  finishGrill(id: string, acceptRemaining?: boolean): Promise<unknown>;
  approveSpecification(id: string): Promise<unknown>;
}
export interface CandidateScope {
  candidateId: string;
  candidateRevision: number;
  candidateHeadRevision: string;
}

export type ConnectionState = "connecting" | "connected" | "offline";
export interface FrontierSnapshot {
  connection: ConnectionState;
  error: string | null;
  status: RuntimeStatus | null;
  projects: RuntimeProject[];
  tasks: TaskSummary[];
  selectedId: string | null;
  selected: TaskEvidence | null;
  selectedLoading: boolean;
  selectedError: string | null;
  updatedAt: number | null;
}
