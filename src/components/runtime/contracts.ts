import type { RuntimeTask, StageId } from "../../domain";

export type RuntimeWorkflowAction =
  | "approve-spec"
  | "approve-plan"
  | "plan"
  | "implement"
  | "repair"
  | "review"
  | "test"
  | "final-review"
  | "approve-merge"
  | "grant-retry";

export interface RuntimeTaskWorkspaceProps {
  task: RuntimeTask;
  onBack: () => void;
  onRun: () => Promise<void>;
  onCancel: () => Promise<void>;
  onCloseTask: (reason: "not-needed" | "superseded", note: string, supersededBy?: string) => Promise<void>;
  onEvaluate: (score: number, outcome: "accepted" | "rejected" | "mixed", notes: string) => Promise<void>;
  onAction: (action: RuntimeWorkflowAction, note?: string) => Promise<void>;
  onDecision: (question: string, answer: string) => Promise<void>;
  onGrillAnswer: (questionId: string, answer: string) => Promise<void>;
  onFinishGrill: (acceptRemaining: boolean) => Promise<void>;
  initialViewedStageId?: StageId;
  initialSelectedWorktreeId?: string | null;
  onViewedStageChange?: (stageId: StageId) => void;
}
