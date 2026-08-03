import {
  ArrowLeft,
  Archive,
  Check,
  FileCode,
  GitDiff,
  Pause,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCandidateDiff, type CandidateDiffResponse } from "../api";
import { matchesCandidateDiffResponse } from "../requestIdentity";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type StageId,
  workflowStages,
} from "../domain";
import { MarkdownContent } from "./MarkdownContent";
import { RunActivity } from "./RunActivity";
import type { TaskRouteDetail } from "../routes";
import { CandidateDiffErrorViewer, CandidateDiffViewer } from "./CandidateDiffViewer";
import { Button, PriorityBadge, StateBadge } from "./Primitives";
import { ApprovalHistorySection, getApprovalHistory } from "./runtimeApprovalHistory.js";
import { getAccessBoundaryCopy, RuntimeCommandBar } from "./runtime/RuntimeCommandBar";
import type { RuntimeTaskWorkspaceProps } from "./runtime/contracts";
import {
  DecisionFrontier,
  RuntimeContextDisclosure,
  RuntimeWorktreeInventory,
} from "./runtime/RuntimeEvidencePanels";
import { RuntimeArtifactViewer, TaskEvaluation } from "./runtime/RuntimeInspectorPanels";
import { InspectorSection, RuntimeRow } from "./runtime/RuntimeInspectorPrimitives";
import { RuntimeStagePresentation } from "./runtime/RuntimeStagePresentation";
import { RuntimeWorkspaceFooter } from "./runtime/RuntimeWorkspaceFooter";
import {
  getRuntimeStageSummary,
  isArtifactFresh,
  isStageComplete,
  isStageInvalidatedByRepair,
  runtimeStageAgents,
  runtimeStageSkills,
  toTaskRunState,
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
  onEvaluate,
  onAction,
  onDecision,
  onGrillAnswer,
  onFinishGrill,
  initialViewedStageId,
  initialSelectedWorktreeId,
  onViewedStageChange,
  routeDetail,
  onRouteDetailChange,
}: RuntimeTaskWorkspaceProps) {
  const currentIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === task.currentStage),
  );
  const [viewedStageId, setViewedStageId] = useState<StageId>(initialViewedStageId ?? task.currentStage);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(initialSelectedWorktreeId ?? null);
  const [openArtifact, setOpenArtifact] = useState<RuntimeArtifact | null>(null);
  const [candidateDiff, setCandidateDiff] = useState<CandidateDiffResponse | null>(null);
  const [candidateDiffError, setCandidateDiffError] = useState<string | null>(null);
  const [candidateDiffLoading, setCandidateDiffLoading] = useState(false);
  const [candidateDiffTarget, setCandidateDiffTarget] = useState<RuntimeTaskWorkspaceProps["task"]["candidates"][number] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const artifactReturnFocusRef = useRef<HTMLElement | null>(null);
  const candidateDiffReturnFocusRef = useRef<HTMLElement | null>(null);
  const candidateDiffRequestRef = useRef(0);
  const viewedIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === viewedStageId),
  );
  const viewedStage = workflowStages[viewedIndex];
  if (!viewedStage) throw new Error(`Unknown workflow stage: ${viewedStageId}`);
  const stageArtifact = [...task.artifacts].reverse().find((artifact) => artifact.stage === viewedStageId);
  const state = toTaskRunState(task.status);
  const viewedStageStopped =
    viewedStageId === task.currentStage && ["failed", "cancelled", "blocked"].includes(task.status);
  const repoName = task.repositoryPath.split(/[\\/]/).filter(Boolean).at(-1) ?? task.repositoryPath;
  const candidate = task.candidates?.at(-1);
  const runningPackages = task.workPackages?.filter((item) => item.status === "running") ?? [];
  const worktreeInventory = task.worktreeInventory ?? [];
  const accessBoundary = getAccessBoundaryCopy(task);
  const completedApprovalWithoutArtifact =
    viewedStageId === "approval" &&
    task.status === "completed" &&
    !stageArtifact &&
    candidate?.status === "merged";
  const stageSummary = getRuntimeStageSummary(task, viewedStageId, stageArtifact);
  const historical = viewedStageId !== task.currentStage;
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

  const openRuntimeArtifact = (artifact: RuntimeArtifact) => {
    artifactReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (onRouteDetailChange) {
      onRouteDetailChange({ kind: "artifact", artifactId: artifact.id }, artifact.stage);
      return;
    }
    setOpenArtifact(artifact);
  };

  const closeRuntimeArtifact = () => {
    setOpenArtifact(null);
    onRouteDetailChange?.(null);
    window.requestAnimationFrame(() => artifactReturnFocusRef.current?.focus());
  };

  const closeCandidateDiff = () => {
    candidateDiffRequestRef.current += 1;
    setCandidateDiff(null);
    setCandidateDiffError(null);
    setCandidateDiffTarget(null);
    onRouteDetailChange?.(null);
    window.requestAnimationFrame(() => candidateDiffReturnFocusRef.current?.focus());
  };

  const openCandidateDiff = useCallback(async (target = candidate) => {
    if (!target?.headRevision) return;
    const requestId = candidateDiffRequestRef.current + 1;
    candidateDiffRequestRef.current = requestId;
    candidateDiffReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCandidateDiffLoading(true);
    setCandidateDiffError(null);
    setCandidateDiffTarget(target);
    try {
      const diff = await getCandidateDiff(task.id, target.id, target.headRevision);
      if (!matchesCandidateDiffResponse(target, diff)) {
        throw new Error("The candidate diff response did not match the requested candidate revision.");
      }
      if (candidateDiffRequestRef.current === requestId) setCandidateDiff(diff);
    } catch (error) {
      if (candidateDiffRequestRef.current === requestId) {
        setCandidateDiff(null);
        setCandidateDiffError(error instanceof Error ? error.message : "The exact candidate diff could not be loaded.");
      }
    } finally {
      if (candidateDiffRequestRef.current === requestId) setCandidateDiffLoading(false);
    }
  }, [candidate, task.id]);

  const requestCandidateDiff = (target = candidate) => {
    if (!target) return;
    candidateDiffReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (onRouteDetailChange) {
      onRouteDetailChange(
        { kind: "candidate-diff", candidateId: target.id, revision: target.revisionNumber },
        viewedStageId,
      );
      return;
    }
    void openCandidateDiff(target);
  };

  useEffect(() => {
    if (!routeDetail) {
      setOpenArtifact(null);
      return;
    }
    if (routeDetail.kind === "artifact") {
      const artifact = task.artifacts.find((item) => item.id === routeDetail.artifactId);
      if (artifact) setOpenArtifact(artifact);
      else onRouteDetailChange?.(null);
      return;
    }
    setOpenArtifact(null);
    if (routeDetail.kind !== "candidate-diff") return;
    const target = task.candidates.find(
      (item) => item.id === routeDetail.candidateId && item.revisionNumber === routeDetail.revision,
    );
    if (!target) {
      onRouteDetailChange?.(null);
      return;
    }
    const alreadyRequested =
      candidateDiffTarget?.id === target.id &&
      candidateDiffTarget.revisionNumber === target.revisionNumber &&
      (candidateDiffLoading || candidateDiff != null || candidateDiffError != null);
    if (!alreadyRequested) void openCandidateDiff(target);
  }, [
    candidateDiff,
    candidateDiffError,
    candidateDiffLoading,
    candidateDiffTarget,
    onRouteDetailChange,
    openCandidateDiff,
    routeDetail,
    task.artifacts,
    task.candidates,
  ]);

  const rerun = async () => {
    setRunError(null);
    try {
      await onRun();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "The task could not be started.");
    }
  };

  const closeTask = async () => {
    const supersededBy = window.prompt("Optional superseding task ID. Leave blank to close this task as not needed.", "");
    if (supersededBy === null) return;
    const replacement = supersededBy.trim();
    await onCloseTask(
      replacement ? "superseded" : "not-needed",
      "Closed from the universal task inspector.",
      replacement || undefined,
    );
  };

  return (
    <div className="task-workspace runtime-workspace">
      <header className="task-header">
        <button
          type="button"
          className="icon-button task-header__back"
          onClick={onBack}
          aria-label="Back to tasks"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="task-title-block">
          <span className="mono task-id">{task.id}</span>
          <h1>{task.title}</h1>
        </div>
        <PriorityBadge priority={task.priority} />
        <div className="task-header__meta">
          <StateBadge state={state} />
          <span>
            <small>Repository</small>
            <strong>{repoName}</strong>
          </span>
          <span>
            <small>Stage</small>
            <strong>{currentIndex + 1} / 10</strong>
          </span>
          <span>
            <small>Stage attempts</small>
            <strong>
              {task.attemptsByStage?.[task.currentStage] ?? 0} / {task.stageRunLimit}
            </strong>
          </span>
        </div>
        <fieldset className="task-header__actions">
          <legend className="sr-only">Global task controls</legend>
          <Button
            tone="secondary"
            compact
            icon={Archive}
            disabled={["running", "cancelling"].includes(task.status) || task.status === "closed"}
            title={["running", "cancelling"].includes(task.status) ? "Wait for the active process tree to terminate before closing this task." : task.status === "closed" ? "This task is already closed." : "Close as not needed or record the superseding task."}
            onClick={() => void closeTask()}
          >
            Close task
          </Button>
          <Button
            tone="secondary"
            compact
            icon={Pause}
            disabled
            title="Pause is not supported by the current local runtime contract."
          >
            Pause
          </Button>
          <Button
            tone="danger"
            compact
            icon={X}
            disabled={task.status !== "running"}
            title={task.status === "cancelling" ? "Process-tree termination is already in progress" : task.status === "running" ? "Cancel the active Codex run" : "No active run to cancel"}
            onClick={() => void onCancel()}
          >
            Cancel
          </Button>
        </fieldset>
      </header>

      <nav className="stage-navigator" aria-label="Workflow stages">
        {workflowStages.map((stage, index) => {
          const invalidated = isStageInvalidatedByRepair(task, stage.id);
          const complete = isStageComplete(task, stage.id) && !invalidated;
          const active = stage.id === task.currentStage;
          const selected = stage.id === viewedStageId;
          const failed = active && (task.status === "failed" || task.status === "blocked");
          return (
            <button
              type="button"
              key={stage.id}
              className={`stage-step ${complete ? "stage-step--complete" : ""} ${active ? "stage-step--active" : ""} ${selected ? "stage-step--selected" : ""} ${failed ? "stage-step--failed" : ""} ${invalidated ? "stage-step--stale" : ""}`}
              onClick={() => selectViewedStage(stage.id)}
              aria-current={selected ? "step" : undefined}
            >
              <span className="stage-step__node">
                {complete ? (
                  <Check size={14} weight="bold" />
                ) : failed ? (
                  <X size={14} weight="bold" />
                ) : (
                  index + 1
                )}
              </span>
              <span>
                <strong>{stage.shortLabel}</strong>
                <small>
                  {invalidated
                    ? "rerun required"
                    : active
                    ? task.status === "running"
                      ? "current"
                      : task.status.replace("-", " ")
                    : complete
                      ? "done"
                      : "\u2014"}
                </small>
              </span>
            </button>
          );
        })}
      </nav>

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
                {historical ? <span className="badge badge--blue">Recorded history</span> : null}
                {stageArtifact && !isArtifactFresh(stageArtifact, candidate) ? (
                  <span className="badge badge--yellow">Stale after repair</span>
                ) : null}
              </div>
              <p>{stageSummary.detail}</p>
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
              onSelectTestResult={(resultId) => onRouteDetailChange?.(
                resultId ? { kind: "test-result", resultId } satisfies TaskRouteDetail : null,
                "test",
              )}
            />
          </main>

          <aside className="stage-inspector runtime-inspector">
            <InspectorSection title="Task brief">
              <strong>{task.title}</strong>
              <MarkdownContent content={task.description} className="runtime-task-brief-markdown" />
              {task.attachments?.length ? (
                <div className="runtime-attachments">
                  <small>{task.attachments.length} reference artifact{task.attachments.length === 1 ? "" : "s"}</small>
                  {task.attachments.map((attachment) => <span key={attachment.id}><FileCode size={14} /><strong>{attachment.name}</strong><small>{Math.ceil(attachment.size / 1024)} KB</small></span>)}
                </div>
              ) : null}
            </InspectorSection>
            {task.experiment ? (
              <InspectorSection title="Controlled experiment" meta={`${task.experiment.groupId} \u00b7 ${task.experiment.variantId}`}>
                <RuntimeRow label="Frozen base" value={task.experiment.frozenBaseSha.slice(0, 12)} mono />
                <RuntimeRow label="Brief hash" value={task.experiment.taskBriefHash.slice(0, 12)} mono />
                <RuntimeRow label="Policy snapshot" value={`${Object.keys(task.experiment.policyMatrix).length} model-driven roles`} />
                <RuntimeRow label="Acceptance" value={`${task.experiment.acceptanceCriteria.length} criteria`} />
                <RuntimeRow label="Verification" value={`${task.experiment.verificationCommands.length} commands`} />
              </InspectorSection>
            ) : null}
            <InspectorSection title="Stage context">
              <RuntimeRow label="Viewing" value={`${viewedStage.label}${historical ? " \u00b7 recorded history" : " \u00b7 current execution"}`} />
              <RuntimeRow label="Active" value={workflowStages[currentIndex]?.label ?? "Triage"} />
              <RuntimeRow label="State" value={task.status.replace("-", " ")} />
            </InspectorSection>
            <InspectorSection title="Execution metadata">
              <RuntimeRow
                label="Skill"
                value={runtimeStageSkills[task.currentStage]}
              />
              <RuntimeRow
                label="Agent"
                value={
                  task.currentStage === "approval"
                    ? "Human approval gate"
                    : task.currentStage === "implement" && runningPackages.length
                      ? `${runningPackages.map((item) => item.id).join(", ")} implementation agents`
                      : runtimeStageAgents[task.currentStage]
                }
              />
              {task.currentStage === "implement" && task.workPackages?.length ? (
                <RuntimeRow
                  label="Active slices"
                  value={
                    runningPackages.length
                      ? runningPackages.map((item) => item.id).join(", ")
                      : "Assembly or gate handoff"
                  }
                />
              ) : null}
              <RuntimeRow label="Model / reasoning" value={`${activePolicy.model} \u00b7 ${activePolicy.reasoning}`} />
              <RuntimeRow label="Stage run" value={`${task.attemptsByStage?.[task.currentStage] ?? 0} of ${task.stageRunLimit}`} />
              <RuntimeRow label="Run" value={task.activeRunKind ?? "No active agent run"} />
              <RuntimeRow label="Repository" value={repoName} mono />
            </InspectorSection>
            {stageArtifact ? (
              <InspectorSection title="Viewed agent run" meta={stageArtifact.name}>
                <RuntimeRow label="Model" value={stageArtifact.model} mono />
                <RuntimeRow label="Reasoning" value={stageArtifact.reasoning ?? "Not recorded"} />
                <RuntimeRow label="Input" value={`${formatTokenCount(stageArtifact.usage.inputTokens)} total \u00b7 ${formatTokenCount(Math.max(0, stageArtifact.usage.inputTokens - stageArtifact.usage.cachedInputTokens - (stageArtifact.usage.cacheWriteTokens ?? 0)))} uncached`} />
                <RuntimeRow label="Output" value={formatTokenCount(stageArtifact.usage.outputTokens)} />
                <RuntimeRow label="Cached input" value={`${formatCacheRate(stageArtifact.usage)} \u00b7 ${formatTokenCount(stageArtifact.usage.cachedInputTokens)}`} />
                <RuntimeRow label="Work credits" value={stageArtifact.usage.credits == null ? "Not reported for this model" : stageArtifact.usage.credits.toFixed(3)} />
                <RuntimeRow label="Approx. cost" value={`${formatApproximateCost(stageArtifact.usage.cost)} \u00b7 API-rate estimate`} />
                <RuntimeContextDisclosure artifact={stageArtifact} />
              </InspectorSection>
            ) : null}
            <details className="runtime-safeguards">
              <summary>
                <ShieldCheck size={15} />
                <strong>Run safeguards</strong>
                <small>{accessBoundary.kicker}</small>
              </summary>
              <div>
                <RuntimeRow label="Access" value="Local OAuth session" />
                <RuntimeRow label="Sandbox" value={accessBoundary.sandbox} />
                <RuntimeRow label="Write boundary" value={accessBoundary.detail} />
                <RuntimeRow label="Billing" value="ChatGPT plan \u00b7 API-rate estimate shown separately" />
              </div>
            </details>
            {candidate ? (
              <InspectorSection
                title="Integration candidate"
                meta={`${candidate.id} r${candidate.revisionNumber}`}
              >
                <RuntimeRow label="State" value={candidate.status.replaceAll("_", " ")} />
                <RuntimeRow label="Base" value={candidate.baseRevision.slice(0, 8)} mono />
                <RuntimeRow label="Head" value={candidate.headRevision?.slice(0, 8) ?? "pending"} mono />
                <RuntimeRow label="Branch" value={candidate.branch} mono />
                <RuntimeRow
                  label="Members"
                  value={
                    candidate.members?.map((item) => item.packageId).join(" \u2192 ") ||
                    (candidate.status === "merged" ? "Legacy single-session candidate" : "Pending assembly")
                  }
                />
                <Button
                  tone="ghost"
                  compact
                  icon={GitDiff}
                  disabled={!candidate.headRevision || candidateDiffLoading}
                  onClick={() => requestCandidateDiff()}
                >
                  {candidateDiffLoading ? "Loading exact diff\u2026" : "Inspect exact diff"}
                </Button>
              </InspectorSection>
            ) : null}
            <InspectorSection title="Decision frontier" meta={`${task.decisions?.length ?? 0} recorded`}>
              <DecisionFrontier task={task} canRecord={!historical} onDecision={onDecision} />
            </InspectorSection>
            <InspectorSection
              title="Approvals"
              meta={`${getApprovalHistory(task.approvals).length} recorded`}
            >
              <ApprovalHistorySection approvals={task.approvals ?? []} />
            </InspectorSection>
            <InspectorSection title="Outcome evaluation" meta={task.evaluation?.scores?.blind?.score ? `Blind ${task.evaluation.scores.blind.score} / 5` : task.evaluation?.score ? `${task.evaluation.score} / 5` : "Not rated"}>
              <TaskEvaluation evaluation={task.evaluation} disabled={task.status === "running"} onEvaluate={onEvaluate} />
            </InspectorSection>
            {worktreeInventory.length ? (
              <InspectorSection title="Isolated worktrees" meta={`${worktreeInventory.length} for this task`}>
                <p className="runtime-worktree-explainer">Temporary Git copies that keep Implement and Repair changes away from your main checkout until approval.</p>
                <RuntimeWorktreeInventory
                  inventory={worktreeInventory}
                  selectedId={selectedWorktreeId}
                  onSelect={setSelectedWorktreeId}
                />
              </InspectorSection>
            ) : null}
            <InspectorSection title="Living artifacts" meta={`${task.artifacts.length} retained`}>
              <div className="runtime-artifact-list">
                {task.artifacts.length ? (
                  [...task.artifacts].reverse().map((artifact) => (
                    <button
                      type="button"
                      key={artifact.id}
                      onClick={() => {
                        selectViewedStage(artifact.stage);
                        openRuntimeArtifact(artifact);
                      }}
                    >
                      <FileCode size={15} />
                      <span>
                        <strong>{artifact.name}</strong>
                        <small>
                          {workflowStages.find((stage) => stage.id === artifact.stage)?.label}
                          {!isArtifactFresh(artifact, candidate) ? " \u00b7 stale" : ""}
                        </small>
                      </span>
                    </button>
                  ))
                ) : (
                  <small>Artifacts appear as stage agents complete.</small>
                )}
              </div>
            </InspectorSection>
          </aside>
        </div>
        <RunActivity
          task={task}
          onOpenArtifact={(artifact) => {
            selectViewedStage(artifact.stage);
            openRuntimeArtifact(artifact);
          }}
        />
      </div>

      <RuntimeWorkspaceFooter task={task} activeModel={activePolicy.model} />

      {openArtifact ? (
        <RuntimeArtifactViewer artifact={openArtifact} onClose={closeRuntimeArtifact} />
      ) : null}
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
          onRetry={() => void openCandidateDiff(candidateDiffTarget)}
        />
      ) : null}
    </div>
  );
}
