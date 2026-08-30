import type { RuntimeAvailableAction, RuntimeTask, StageId, WorkflowProfileId } from "../../domain";
import type { TaskRouteDetail } from "../../routes";

export type RuntimeWorkflowAction = RuntimeAvailableAction;

export interface RuntimeTaskWorkspaceProps {
  task: RuntimeTask;
  onBack: () => void;
  onRun: () => Promise<void>;
  onCancel: () => Promise<void>;
  onCloseTask: (reason: "not-needed" | "superseded", note: string, supersededBy?: string) => Promise<void>;
  onArchiveTask: () => Promise<void>;
  onEvaluate: (score: number, outcome: "accepted" | "rejected" | "mixed", notes: string) => Promise<void>;
  onAction: (action: RuntimeWorkflowAction, note?: string) => Promise<void>;
  onDecision: (question: string, answer: string) => Promise<void>;
  onGrillAnswer: (questionId: string, answer: string) => Promise<void>;
  onFinishGrill: (acceptRemaining: boolean) => Promise<void>;
  onSelectDesign: (variantId: string) => Promise<void>;
  onRetryDesigns: () => Promise<void>;
  onRemoveWorktree: (rowId: string) => Promise<void>;
  onProfileChange: (profile: WorkflowProfileId, reason: string) => Promise<void>;
  onLoadMoreArtifacts?: () => Promise<void>;
  onLoadArtifact?: (artifactId: string) => Promise<RuntimeTask["artifacts"][number]>;
  initialViewedStageId?: StageId;
  initialSelectedWorktreeId?: string | null;
  onViewedStageChange?: (stageId: StageId) => void;
  routeDetail?: TaskRouteDetail;
  onRouteDetailChange?: (detail: TaskRouteDetail | null, stageId?: StageId) => void;
}
