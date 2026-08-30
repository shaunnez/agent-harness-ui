import { CircleNotch } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { type StageId, workflowStages } from "../domain";
import { RunActivity } from "./RunActivity";
import type { TaskRouteDetail } from "../routes";
import { CandidateDiffErrorViewer, CandidateDiffViewer } from "./CandidateDiffViewer";
import { RuntimeCommandBar } from "./runtime/RuntimeCommandBar";
import type { RuntimeTaskWorkspaceProps } from "./runtime/contracts";
import { RuntimeArtifactViewer } from "./runtime/RuntimeInspectorPanels";
import { RuntimeStagePresentation } from "./runtime/RuntimeStagePresentation";
import { RuntimeStageNavigator } from "./runtime/RuntimeStageNavigator";
import { RuntimeTaskInspector } from "./runtime/RuntimeTaskInspector";
import { RuntimeTaskHeader } from "./runtime/RuntimeTaskHeader";
import { StageEvidenceStrip } from "./runtime/StageEvidenceStrip";
import { RuntimeWorkspaceFooter } from "./runtime/RuntimeWorkspaceFooter";
import { useRuntimeWorkspaceOverlays } from "./runtime/useRuntimeWorkspaceOverlays";
import {
  getRuntimeArtifactFreshness,
  getRuntimeGateFreshness,
  getRuntimeStageSummary,
  getStageTemporalState,
  isArtifactFresh,
  isCandidateGateStage,
  isStageRunning,
} from "./runtime/workflow";

export { getAccessBoundaryCopy } from "./runtime/RuntimeCommandBar";
export {
  copyArtifactContent,
  RuntimeArtifactViewer,
  shouldApplyArtifactCopyFeedback,
} from "./runtime/RuntimeInspectorPanels";

export function RuntimeTaskWorkspace({
  task,
  onBack,
  onRun,
  onCancel,
  onCloseTask,
  onArchiveTask,
  onEvaluate,
  onAction,
  onDecision,
  onGrillAnswer,
  onFinishGrill,
  onSelectDesign,
  onRetryDesigns,
  onRemoveWorktree,
  onProfileChange,
  onLoadMoreArtifacts,
  onLoadArtifact,
  initialViewedStageId,
  initialSelectedWorktreeId,
  onViewedStageChange,
  routeDetail,
  onRouteDetailChange,
}: RuntimeTaskWorkspaceProps) {
  const [viewedStageId, setViewedStageId] = useState<StageId>(initialViewedStageId ?? task.currentStage);
  const [runError, setRunError] = useState<string | null>(null);
  const viewedIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === viewedStageId),
  );
  const viewedStage = workflowStages[viewedIndex];
  if (!viewedStage) throw new Error(`Unknown workflow stage: ${viewedStageId}`);
  const candidate = task.candidates?.at(-1);
  const {
    openArtifact,
    candidateDiff,
    candidateDiffError,
    candidateDiffLoading,
    candidateDiffTarget,
    openRuntimeArtifact,
    closeRuntimeArtifact,
    requestCandidateDiff,
    closeCandidateDiff,
    retryCandidateDiff,
  } = useRuntimeWorkspaceOverlays({
    task,
    candidate,
    viewedStageId,
    routeDetail,
    onRouteDetailChange,
    onLoadArtifact,
  });
  const gateFreshness = isCandidateGateStage(viewedStageId)
    ? getRuntimeGateFreshness(task, viewedStageId)
    : null;
  const stageArtifact = isCandidateGateStage(viewedStageId)
    ? task.artifacts.find(
        (artifact) => artifact.stage === viewedStageId && artifact.id === gateFreshness?.sourceArtifactId,
      )
    : [...task.artifacts].reverse().find((artifact) => artifact.stage === viewedStageId);
  const stageArtifactFreshness = stageArtifact ? getRuntimeArtifactFreshness(task, stageArtifact) : null;
  const stageArtifactStaleReason =
    stageArtifact &&
    stageArtifactFreshness &&
    !isArtifactFresh(stageArtifact, candidate, stageArtifactFreshness)
      ? stageArtifactFreshness.reasonCopy
      : null;
  const viewedStageStopped =
    viewedStageId === task.currentStage && ["failed", "cancelled", "blocked"].includes(task.status);
  const completedApprovalWithoutArtifact =
    viewedStageId === "approval" &&
    (task.status === "completed" || task.status === "merged-to-target") &&
    !stageArtifact &&
    candidate?.status === "merged";
  const viewedStageIsRunning = isStageRunning(task, viewedStageId);
  const stageSummary = getRuntimeStageSummary(task, viewedStageId, stageArtifact, viewedStageIsRunning);
  // Distinct from "not the current stage": a future stage (never started) must not present
  // as recorded history either, so this is a genuine three-way split, not a boolean negation
  // of `current`.
  const viewedTemporalState = getStageTemporalState(task, viewedStageId);
  const historical = viewedTemporalState === "past";
  const activeAgentRole = task.activeRunKind === "repair" ? "repair" : task.currentStage;
  const activePolicy = task.agentConfig?.stagePolicies?.[activeAgentRole] ?? {
    model: task.agentConfig?.model ?? task.models[0]?.model ?? "gpt-5.6-luna",
    reasoning: task.agentConfig?.reasoning ?? "xhigh",
  };

  useEffect(() => {
    setViewedStageId(initialViewedStageId ?? task.currentStage);
  }, [initialViewedStageId, task.currentStage]);

  const selectViewedStage = (stageId: StageId) => {
    setViewedStageId(stageId);
    onViewedStageChange?.(stageId);
  };

  const rerun = async () => {
    setRunError(null);
    try {
      await onRun();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The task could not be started.");
    }
  };

  return (
    <div className="task-workspace runtime-workspace">
      <RuntimeTaskHeader
        task={task}
        onBack={onBack}
        onCancel={onCancel}
        onCloseTask={onCloseTask}
        onArchiveTask={onArchiveTask}
      />

      <RuntimeStageNavigator task={task} viewedStageId={viewedStageId} onSelect={selectViewedStage} />

      <div className="workspace-scroll">
        <div className="workspace-grid">
          <main className="stage-main runtime-stage-main">
            {runError ? (
              <div className="runtime-error" role="alert">
                {runError}
              </div>
            ) : null}
            <header className="runtime-stage-heading">
              <p className="eyebrow">{stageSummary.kicker}</p>
              <div className="runtime-stage-heading__title">
                <h2>{stageSummary.title}</h2>
                {viewedStageIsRunning ? (
                  <span className="badge badge--blue runtime-stage-heading__running">
                    <CircleNotch size={13} className="is-running spin" /> Running
                  </span>
                ) : null}
                {historical ? <span className="badge badge--blue">Recorded history</span> : null}
                {/* A rerun already in flight supersedes the stale-artifact badge below: the
                    gate is neither fresh nor waiting for someone to request a rerun. */}
                {!viewedStageIsRunning && stageArtifactStaleReason ? (
                  <>
                    <span className="badge badge--yellow">Rerun required</span>
                    <span>{stageArtifactStaleReason}</span>
                  </>
                ) : null}
              </div>
              <p className="runtime-stage-heading__detail">{stageSummary.detail}</p>
              <StageEvidenceStrip
                stageId={viewedStageId}
                artifact={stageArtifact}
                candidate={candidate}
                workPackages={task.workPackages ?? []}
              />
            </header>

            <RuntimeCommandBar
              task={task}
              viewedStageId={viewedStageId}
              onRun={rerun}
              onAction={onAction}
              onFinishGrill={onFinishGrill}
            />

            <RuntimeStagePresentation
              task={task}
              viewedStageId={viewedStageId}
              artifact={stageArtifact}
              candidate={candidate}
              completedApprovalWithoutArtifact={completedApprovalWithoutArtifact}
              viewedStageStopped={viewedStageStopped}
              onAnswer={onGrillAnswer}
              onOpenArtifact={openRuntimeArtifact}
              onOpenCandidateDiff={requestCandidateDiff}
              candidateDiffLoading={candidateDiffLoading}
              selectedTestResultId={routeDetail?.kind === "test-result" ? routeDetail.resultId : null}
              onSelectTestResult={(resultId) =>
                onRouteDetailChange?.(
                  resultId ? ({ kind: "test-result", resultId } satisfies TaskRouteDetail) : null,
                  "test",
                )
              }
              onSelectDesign={onSelectDesign}
              onRetryDesigns={onRetryDesigns}
            />
          </main>

          <RuntimeTaskInspector
            task={task}
            viewedStageId={viewedStageId}
            initialSelectedWorktreeId={initialSelectedWorktreeId}
            candidateDiffLoading={candidateDiffLoading}
            onProfileChange={onProfileChange}
            onDecision={onDecision}
            onEvaluate={onEvaluate}
            onRemoveWorktree={onRemoveWorktree}
            onLoadMoreArtifacts={onLoadMoreArtifacts}
            onSelectStage={selectViewedStage}
            onOpenArtifact={openRuntimeArtifact}
            onOpenCandidateDiff={() => requestCandidateDiff()}
          />
        </div>
        <RunActivity
          task={task}
          onOpenArtifact={(artifact) => {
            selectViewedStage(artifact.stage);
            openRuntimeArtifact(artifact);
          }}
          onLoadArtifact={onLoadArtifact}
        />
      </div>

      <RuntimeWorkspaceFooter task={task} activeModel={activePolicy.model} />

      {openArtifact ? <RuntimeArtifactViewer artifact={openArtifact} onClose={closeRuntimeArtifact} /> : null}
      {candidateDiff && candidateDiffTarget ? (
        <CandidateDiffViewer
          taskId={task.id}
          candidateIdentity={`${candidateDiffTarget.id} r${candidateDiffTarget.revisionNumber}`}
          diff={candidateDiff}
          onClose={closeCandidateDiff}
        />
      ) : null}
      {candidateDiffError && candidateDiffTarget ? (
        <CandidateDiffErrorViewer
          taskId={task.id}
          candidateIdentity={`${candidateDiffTarget.id} r${candidateDiffTarget.revisionNumber}`}
          error={candidateDiffError}
          onClose={closeCandidateDiff}
          onRetry={retryCandidateDiff}
        />
      ) : null}
    </div>
  );
}
