import {
  ArrowLeft,
  ArrowSquareOut,
  Archive,
  Check,
  CheckCircle,
  CaretDown,
  CircleNotch,
  FileCode,
  GitDiff,
  Pause,
  Play,
  Robot,
  ShieldCheck,
  WarningCircle,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCandidateDiff, type CandidateDiffResponse } from "../api";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeFocusedTestEvidence,
  type RuntimeEvent,
  type RuntimeGrillQuestion,
  type RuntimeTask,
  type RuntimeWorktreeInventoryRow,
  type StageId,
  type TaskRunState,
  workflowStages,
} from "../domain";
import { Button, PriorityBadge, StateBadge } from "./Primitives";
import { MarkdownContent } from "./MarkdownContent";
import { CandidateDiffErrorViewer, CandidateDiffViewer } from "./StageViews";
import { ApprovalHistorySection, getApprovalHistory } from "./runtimeApprovalHistory.js";
import type { TaskRouteDetail } from "../routes";

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
}: {
  task: RuntimeTask;
  onBack: () => void;
  onRun: () => Promise<void>;
  onCancel: () => Promise<void>;
  onCloseTask: (reason: "not-needed" | "superseded", note: string, supersededBy?: string) => Promise<void>;
  onEvaluate: (score: number, outcome: "accepted" | "rejected" | "mixed", notes: string) => Promise<void>;
  onAction: (
    action:
      | "approve-spec"
      | "approve-plan"
      | "plan"
      | "implement"
      | "repair"
      | "review"
      | "test"
      | "final-review"
      | "approve-merge"
      | "grant-retry",
    note?: string,
  ) => Promise<void>;
  onDecision: (question: string, answer: string) => Promise<void>;
  onGrillAnswer: (questionId: string, answer: string) => Promise<void>;
  onFinishGrill: (acceptRemaining: boolean) => Promise<void>;
  initialViewedStageId?: StageId;
  initialSelectedWorktreeId?: string | null;
  onViewedStageChange?: (stageId: StageId) => void;
  routeDetail?: TaskRouteDetail;
  onRouteDetailChange?: (detail: TaskRouteDetail | null, stageId?: StageId) => void;
}) {
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
  const [candidateDiffTarget, setCandidateDiffTarget] = useState<RuntimeTask["candidates"][number] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const artifactReturnFocusRef = useRef<HTMLElement | null>(null);
  const candidateDiffReturnFocusRef = useRef<HTMLElement | null>(null);
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
    setCandidateDiff(null);
    setCandidateDiffError(null);
    setCandidateDiffTarget(null);
    onRouteDetailChange?.(null);
    window.requestAnimationFrame(() => candidateDiffReturnFocusRef.current?.focus());
  };

  const openCandidateDiff = useCallback(async (target = candidate) => {
    if (!target?.headRevision) return;
    candidateDiffReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCandidateDiffLoading(true);
    setCandidateDiffError(null);
    setCandidateDiffTarget(target);
    try {
      setCandidateDiff(await getCandidateDiff(task.id, target.id, target.headRevision));
    } catch (error) {
      setCandidateDiff(null);
      setCandidateDiffError(error instanceof Error ? error.message : "The exact candidate diff could not be loaded.");
    } finally {
      setCandidateDiffLoading(false);
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
            disabled={task.status === "running" || task.status === "closed"}
            title={task.status === "running" ? "Cancel the active run before closing this task." : task.status === "closed" ? "This task is already closed." : "Close as not needed or record the superseding task."}
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
            title={task.status === "running" ? "Cancel the active Codex run" : "No active run to cancel"}
            onClick={() => void onCancel()}
          >
            Cancel
          </Button>
        </fieldset>
      </header>

      <nav className="stage-navigator" aria-label="Workflow stages">
        {workflowStages.map((stage, index) => {
          const invalidated = isStageInvalidatedByRepair(task, stage.id);
          const complete = task.completedStages.includes(stage.id) && !invalidated;
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
                      : "—"}
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
                resultId ? { kind: "test-result", resultId } : null,
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
              <InspectorSection title="Controlled experiment" meta={`${task.experiment.groupId} · ${task.experiment.variantId}`}>
                <RuntimeRow label="Frozen base" value={task.experiment.frozenBaseSha.slice(0, 12)} mono />
                <RuntimeRow label="Brief hash" value={task.experiment.taskBriefHash.slice(0, 12)} mono />
                <RuntimeRow label="Policy snapshot" value={`${Object.keys(task.experiment.policyMatrix).length} model-driven roles`} />
                <RuntimeRow label="Acceptance" value={`${task.experiment.acceptanceCriteria.length} criteria`} />
                <RuntimeRow label="Verification" value={`${task.experiment.verificationCommands.length} commands`} />
              </InspectorSection>
            ) : null}
            <InspectorSection title="Stage context">
              <RuntimeRow label="Viewing" value={`${viewedStage.label}${historical ? " · recorded history" : " · current execution"}`} />
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
              <RuntimeRow label="Model / reasoning" value={`${activePolicy.model} · ${activePolicy.reasoning}`} />
              <RuntimeRow label="Stage run" value={`${task.attemptsByStage?.[task.currentStage] ?? 0} of ${task.stageRunLimit}`} />
              <RuntimeRow label="Run" value={task.activeRunKind ?? "No active agent run"} />
              <RuntimeRow label="Repository" value={repoName} mono />
            </InspectorSection>
            {stageArtifact ? (
              <InspectorSection title="Viewed agent run" meta={stageArtifact.name}>
                <RuntimeRow label="Model" value={stageArtifact.model} mono />
                <RuntimeRow label="Reasoning" value={stageArtifact.reasoning ?? "Not recorded"} />
                <RuntimeRow label="Input" value={`${formatTokenCount(stageArtifact.usage.inputTokens)} total · ${formatTokenCount(Math.max(0, stageArtifact.usage.inputTokens - stageArtifact.usage.cachedInputTokens - (stageArtifact.usage.cacheWriteTokens ?? 0)))} uncached`} />
                <RuntimeRow label="Output" value={formatTokenCount(stageArtifact.usage.outputTokens)} />
                <RuntimeRow label="Cached input" value={`${formatCacheRate(stageArtifact.usage)} · ${formatTokenCount(stageArtifact.usage.cachedInputTokens)}`} />
                <RuntimeRow label="Work credits" value={stageArtifact.usage.credits == null ? "Not reported for this model" : stageArtifact.usage.credits.toFixed(3)} />
                <RuntimeRow label="Approx. cost" value={`${formatApproximateCost(stageArtifact.usage.cost)} · API-rate estimate`} />
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
                <RuntimeRow label="Billing" value="ChatGPT plan · API-rate estimate shown separately" />
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
                    candidate.members?.map((item) => item.packageId).join(" → ") ||
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
                  {candidateDiffLoading ? "Loading exact diff…" : "Inspect exact diff"}
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
                          {!isArtifactFresh(artifact, candidate) ? " · stale" : ""}
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
        <RuntimeActivity events={task.events} />
      </div>

      <footer className="workspace-footer">
        <span>
          <small>Updated</small>
          <strong className="mono">
            {new Date(task.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </strong>
        </span>
        <span>
          <small>Input</small>
          <strong className="mono">{formatTokenCount(task.usage.inputTokens)}</strong>
        </span>
        <span>
          <small>Output</small>
          <strong className="mono">{formatTokenCount(task.usage.outputTokens)}</strong>
        </span>
        <span>
          <small>Cache rate</small>
          <strong className="mono text-green">{formatCacheRate(task.usage)}</strong>
        </span>
        <span>
          <small>Artifacts</small>
          <strong className="mono">{task.artifacts.length}</strong>
        </span>
        <span className="workspace-footer__usage">
          <small>Configured models</small>
          <i className="provider-dot provider-dot--codex" />
          {[...new Set(task.models.map((item) => item.model))].join(" + ") || activePolicy.model}
        </span>
        <span>
          <small>Work credits</small>
          <strong className="mono">{task.usage.credits == null ? "—" : task.usage.credits.toFixed(3)}</strong>
        </span>
        <span>
          <small>Approx. cost</small>
          <strong className="mono" title="API-rate estimate; ChatGPT-plan charge is not provider-reported">{formatApproximateCost(task.usage.cost)}</strong>
        </span>
      </footer>

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

const runtimeStageSkills: Record<StageId, string> = {
  triage: "classify-task",
  scouts: "scout-repository",
  grill: "grill-with-docs",
  specification: "build-specification",
  plan: "plan-work-packages",
  implement: "implement-isolated-slices",
  "dev-review": "fresh-context-review",
  test: "verify-candidate",
  "final-review": "holdout-review",
  approval: "approve-fast-forward",
};

function isStageInvalidatedByRepair(task: RuntimeTask, stageId: StageId) {
  if (!["dev-review", "test", "final-review", "approval"].includes(stageId)) return false;
  const repairPending =
    task.status === "repair-required" ||
    task.activeRunKind === "repair" ||
    task.candidates?.at(-1)?.status === "repair_required";
  const hasPriorEvidence =
    task.completedStages.includes(stageId) || task.artifacts.some((artifact) => artifact.stage === stageId);
  return Boolean(repairPending && hasPriorEvidence);
}

const runtimeStageAgents: Record<StageId, string> = {
  triage: "Triage agent",
  scouts: "Repository scout agent",
  grill: "Clarification agent",
  specification: "Task specification agent",
  plan: "Planning agent",
  implement: "Implement agent",
  "dev-review": "Fresh-context review agent",
  test: "Verification agent",
  "final-review": "Holdout review agent",
  approval: "Human approval gate",
};

function isArtifactFresh(
  artifact: RuntimeArtifact,
  candidate: RuntimeTask["candidates"][number] | undefined,
) {
  if (!artifact.candidateId || artifact.candidateRevision == null || !candidate) return true;
  return artifact.candidateId === candidate.id && artifact.candidateRevision === candidate.revisionNumber;
}

function getRuntimeStageSummary(task: RuntimeTask, stageId: StageId, artifact?: RuntimeArtifact) {
  const candidate = task.candidates?.at(-1);
  const packages = task.workPackages ?? [];
  const focused = [...task.artifacts].reverse().find((item) => item.stage === "test" && item.focusedTest)?.focusedTest;
  const completedPackages = packages.filter((item) => ["integrated", "ready_for_integration"].includes(item.status)).length;
  const stageLabel = workflowStages.find((stage) => stage.id === stageId)?.label ?? stageId;
  const waiting = !artifact && !task.completedStages.includes(stageId);
  const fallback = {
    kicker: `${stageLabel} · ${stageId === task.currentStage ? "current execution" : "living artifact"}`,
    title: waiting ? `${stageLabel} is not ready yet` : (artifact?.name ?? stageLabel),
    detail: waiting
      ? "This stage has not produced an authoritative handoff yet. Earlier evidence remains inspectable."
      : "The persisted handoff remains read-only and available to downstream gates.",
  };
  switch (stageId) {
    case "triage":
      return {
        kicker: "Triage · routing gate",
        title: artifact ? `${task.priority.charAt(0).toUpperCase()}${task.priority.slice(1)} priority · ${task.workflow} workflow` : fallback.title,
        detail: artifact
          ? "Task scope, repository, priority, and workflow are fixed before repository investigation begins."
          : fallback.detail,
      };
    case "scouts":
      return {
        kicker: "Repo scouts · evidence gate",
        title: artifact ? "Repository evidence retained" : fallback.title,
        detail: artifact
          ? "The real scout handoff is preserved with its model provenance and token usage; file-level claims remain inside the artifact."
          : fallback.detail,
      };
    case "grill": {
      const unresolved = task.grillSession?.questions.filter((question) => !question.answer) ?? [];
      return {
        kicker: "Grill with docs · one question at a time",
        title: unresolved[0]?.question ?? (artifact ? "Decision frontier settled" : fallback.title),
        detail: unresolved[0]
          ? "Repository evidence comes first, followed by one recommended answer and explicit alternatives."
          : task.grillSession?.completionReason ?? fallback.detail,
      };
    }
    case "specification":
      return {
        kicker: "Task specification · durable handoff",
        title: artifact ? "Specification ready for downstream use" : fallback.title,
        detail: artifact
          ? "The approved specification is shown as real agent output; acceptance criteria are not re-created outside that artifact."
          : fallback.detail,
      };
    case "plan":
      return {
        kicker: "Implementation plan · dependency batches",
        title: packages.length ? `${packages.length} work packages · ${new Set(packages.map((item) => item.batch)).size} batches` : fallback.title,
        detail: packages.length
          ? "Each package exposes real dependencies, ownership, verification commands, attempts, and integration readiness."
          : fallback.detail,
      };
    case "implement":
      return {
        kicker: "Implement · isolated work packages",
        title: packages.length ? `${completedPackages} of ${packages.length} packages qualified` : fallback.title,
        detail: candidate
          ? `${candidate.id} revision ${candidate.revisionNumber} is the explicit integration candidate for every downstream gate.`
          : fallback.detail,
      };
    case "dev-review":
      return {
        kicker: "Dev review · fresh-context advisor",
        title: artifact ? `Review retained for ${candidate?.id ?? "candidate"} r${artifact.candidateRevision ?? candidate?.revisionNumber ?? "—"}` : fallback.title,
        detail: artifact
          ? "The authoritative review remains in the candidate-bound artifact; prose findings are not converted into synthetic P0–P3 records."
          : fallback.detail,
      };
    case "test": {
      const passed = focused?.rows.filter((row) => row.status === "passed").length ?? 0;
      const failed = focused?.rows.filter((row) => row.status === "failed").length ?? 0;
      return {
        kicker: "Test · candidate-bound gate",
        title: focused ? `${passed} checks passed · ${failed} failed` : fallback.title,
        detail: focused
          ? "Open any persisted result for its command, assertions, evidence, and failure detail. Gate actions remain in the command bar."
          : fallback.detail,
      };
    }
    case "final-review":
      return {
        kicker: "Final review · holdout",
        title: artifact ? `Independent workflow review retained for ${candidate?.id ?? "candidate"} r${candidate?.revisionNumber ?? "—"}` : fallback.title,
        detail: artifact
          ? "Every prior stage is summarized from persisted state, real token usage, and its durable artifact reference."
          : fallback.detail,
      };
    case "approval":
      return {
        kicker: "Human approval · exact candidate",
        title:
          candidate?.status === "merged"
            ? `Candidate merged successfully · ${candidate.id} r${candidate.revisionNumber}`
            : candidate
              ? `${candidate.id} r${candidate.revisionNumber} awaits approval`
              : fallback.title,
        detail: candidate
          ? `Target ${candidate.baseBranch} · fast-forward only · reviewed head ${candidate.headRevision?.slice(0, 8) ?? "pending"}.`
          : fallback.detail,
      };
  }
}

function RuntimeStagePresentation({
  task,
  viewedStageId,
  artifact,
  candidate,
  completedApprovalWithoutArtifact,
  viewedStageStopped,
  onAnswer,
  onOpenArtifact,
  onOpenCandidateDiff,
  candidateDiffLoading,
  selectedTestResultId,
  onSelectTestResult,
}: {
  task: RuntimeTask;
  viewedStageId: StageId;
  artifact?: RuntimeArtifact;
  candidate: RuntimeTask["candidates"][number] | undefined;
  completedApprovalWithoutArtifact: boolean;
  viewedStageStopped: boolean;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
  onOpenCandidateDiff: () => void;
  candidateDiffLoading: boolean;
  selectedTestResultId: string | null;
  onSelectTestResult: (resultId: string | null) => void;
}) {
  const stageArtifacts = task.artifacts.filter((item) => item.stage === viewedStageId);
  const focusedArtifact = [...stageArtifacts].reverse().find((item) => item.focusedTest);
  const artifactCard = artifact ? (
    <RuntimeArtifactCard
      artifact={artifact}
      candidate={candidate}
      hideStructuredTestPayload={viewedStageId === "test"}
      onOpen={() => onOpenArtifact(artifact)}
    />
  ) : null;
  const empty = !artifact && !completedApprovalWithoutArtifact ? (
    <RuntimeStageEmpty task={task} viewedStageStopped={viewedStageStopped} />
  ) : null;

  switch (viewedStageId) {
    case "triage":
      return (
        <div className="runtime-stage-stack">
          <RuntimeFactGrid
            facts={[
              ["Classification", `${task.workflow} task`],
              ["Priority", task.priority],
              ["Risk", artifact ? "Retained in triage artifact" : "Not recorded"],
              ["Repository", task.repositoryPath],
            ]}
          />
          {artifactCard ?? empty}
        </div>
      );
    case "scouts":
      return (
        <div className="runtime-stage-stack">
          {task.scoutDispatch ? (
            <section className="scout-dispatch-panel">
              <header><span><Robot size={18} /><strong>Selective scout dispatch</strong></span><small>{task.scoutDispatch.selected.length} dispatched · {task.scoutDispatch.skipped.length} skipped</small></header>
              <div>
                {task.scoutDispatch.selected.map((scout) => (
                  <article key={scout.name}>
                    <span className={`scout-dispatch-state scout-dispatch-state--${scout.status}`} />
                    <span><strong>{scout.name}</strong><small>{scout.focus}</small><p>{scout.reason}</p>{scout.error ? <p className="text-red">{scout.error}</p> : null}</span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          <section className="runtime-evidence-source">
            <CheckCircle size={18} weight="fill" />
            <span>
              <small>Repository evidence · real agent handoff</small>
              <strong>{artifact?.name ?? "No scout artifact yet"}</strong>
              <p>{artifact ? `${artifact.model} · ${formatTokenCount(artifact.usage.totalTokens)} tokens · ${new Date(artifact.createdAt).toLocaleString()}` : "The scout stage has not produced an artifact."}</p>
            </span>
          </section>
          {artifactCard ?? empty}
        </div>
      );
    case "grill":
      return (
        <div className="runtime-stage-stack">
          <section className="runtime-evidence-source">
            <FileCode size={18} />
            <span>
              <small>Repository evidence</small>
              <strong>{task.artifacts.find((item) => item.stage === "scouts")?.name ?? "Scout handoff unavailable"}</strong>
              <p>Open the retained scout artifact from Living artifacts for the exact repository claims behind this decision.</p>
            </span>
          </section>
          {task.grillSession ? <RuntimeGrillPanel task={task} onAnswer={onAnswer} /> : empty}
          {artifactCard}
        </div>
      );
    case "specification":
      return (
        <div className="runtime-stage-stack">
          <RuntimeFactGrid
            facts={[
              ["Artifact", artifact?.name ?? "Pending"],
              ["Approval", task.approvals.some((item) => item.stage === "specification") ? "Approved" : "Awaiting approval"],
              ["Decisions", `${task.decisions.length} retained`],
              ["Provenance", artifact?.model ?? "Not recorded"],
            ]}
          />
          {artifactCard ?? empty}
        </div>
      );
    case "plan":
      return (
        <div className="runtime-stage-stack">
          {task.workPackages.length ? <RuntimeWorkPackages task={task} /> : null}
          {artifactCard ?? empty}
        </div>
      );
    case "implement":
      return (
        <div className="runtime-stage-stack">
          {candidate ? (
            <RuntimeCandidateDesk
              task={task}
              candidate={candidate}
              onOpenDiff={onOpenCandidateDiff}
              diffLoading={candidateDiffLoading}
            />
          ) : null}
          {task.workPackages.length ? <RuntimeWorkPackages task={task} /> : null}
          {artifactCard ?? empty}
        </div>
      );
    case "dev-review":
      return (
        <div className="runtime-stage-stack">
          {candidate ? (
            <RuntimeCandidateDesk
              task={task}
              candidate={candidate}
              onOpenDiff={onOpenCandidateDiff}
              diffLoading={candidateDiffLoading}
              compact
            />
          ) : null}
          <section className="runtime-contract-note">
            <ShieldCheck size={18} />
            <span>
              <strong>Fresh-context review boundary</strong>
              <p>Review findings remain authoritative inside the retained artifact because the runtime does not persist typed P0–P3 finding records.</p>
            </span>
          </section>
          {artifactCard ?? empty}
        </div>
      );
    case "test":
      return (
        <div className="runtime-stage-stack">
          {focusedArtifact?.focusedTest ? (
            <RuntimeFocusedTestEvidencePanel
              evidence={focusedArtifact.focusedTest}
              candidate={candidate}
              selectedResultId={selectedTestResultId}
              onSelectResult={onSelectTestResult}
            />
          ) : null}
          {artifactCard ?? empty}
        </div>
      );
    case "final-review":
      return (
        <div className="runtime-stage-stack">
          {candidate ? (
            <RuntimeCandidateDesk
              task={task}
              candidate={candidate}
              onOpenDiff={onOpenCandidateDiff}
              diffLoading={candidateDiffLoading}
              compact
            />
          ) : null}
          <RuntimeFinalReviewSummary task={task} candidate={candidate} />
          {artifactCard ?? empty}
        </div>
      );
    case "approval":
      return (
        <div className="runtime-stage-stack">
          {candidate ? (
            <RuntimeCandidateDesk
              task={task}
              candidate={candidate}
              onOpenDiff={onOpenCandidateDiff}
              diffLoading={candidateDiffLoading}
              approval
            />
          ) : null}
          {artifactCard}
          {completedApprovalWithoutArtifact ? (
            <div className="runtime-stage-empty runtime-stage-empty--success">
              <CheckCircle size={22} weight="fill" />
              <strong>{candidate?.id} revision {candidate?.revisionNumber} merged</strong>
              <span>Reviewed commit <span className="mono">{candidate?.headRevision?.slice(0, 8)}</span> is now on {candidate?.baseBranch}.</span>
            </div>
          ) : null}
          {!artifact && !completedApprovalWithoutArtifact ? empty : null}
        </div>
      );
  }
}

function RuntimeFactGrid({ facts }: { facts: Array<[string, string]> }) {
  return (
    <section className="runtime-fact-grid" aria-label="Stage facts">
      {facts.map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <strong className={label === "Repository" ? "mono" : ""}>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function RuntimeArtifactCard({
  artifact,
  candidate,
  hideStructuredTestPayload = false,
  onOpen,
}: {
  artifact: RuntimeArtifact;
  candidate: RuntimeTask["candidates"][number] | undefined;
  hideStructuredTestPayload?: boolean;
  onOpen: () => void;
}) {
  const fresh = isArtifactFresh(artifact, candidate);
  const focusedContent = hideStructuredTestPayload ? stripFocusedTestPayload(artifact.content) : artifact.content;
  const content = stripEmbeddedCandidatePatch(focusedContent);
  return (
    <article className={`runtime-artifact-card ${fresh ? "" : "runtime-artifact-card--stale"}`}>
      <header>
        <span>
          <FileCode size={17} />
          <strong>{artifact.name}</strong>
          <small>{fresh ? "Current evidence" : "Superseded evidence"}</small>
        </span>
        <Button tone="ghost" compact icon={ArrowSquareOut} onClick={onOpen}>
          Open artifact
        </Button>
      </header>
      {!fresh ? (
        <div className="runtime-stale-banner">A repair created a newer candidate revision. This handoff remains for audit only.</div>
      ) : null}
      <MarkdownContent content={content.trim() || "The structured result list above is the authoritative test evidence."} />
      <footer>
        <span>{new Date(artifact.createdAt).toLocaleString()}</span>
        <span>{artifact.model} · {formatTokenCount(artifact.usage.inputTokens)} in / {formatTokenCount(artifact.usage.outputTokens)} out · {formatCacheRate(artifact.usage)} cached · {formatApproximateCost(artifact.usage.cost)}</span>
      </footer>
    </article>
  );
}

function stripFocusedTestPayload(content: string) {
  const start = content.indexOf("<focused-test-evidence>");
  const endTag = "</focused-test-evidence>";
  const end = content.indexOf(endTag);
  if (start < 0 || end < start) return content;
  return `${content.slice(0, start)}${content.slice(end + endTag.length)}`;
}

function stripEmbeddedCandidatePatch(content: string) {
  const withoutPatch = content.replace(
    /\n?<details><summary>(?:Patch|Candidate patch[^<]*)<\/summary>[\s\S]*?<\/details>/gi,
    "\n\n> The full candidate diff is loaded on demand from Inspect diff.\n",
  );
  return withoutPatch.replace(/```([\w-]*)\n([\s\S]*?)```/g, (block, language, body) => {
    if (body.length <= 8_000) return block;
    return `\`\`\`${language}\nLarge generated/stat output omitted from this view. Open Inspect diff for the exact candidate changes.\n\`\`\``;
  });
}

function RuntimeStageEmpty({ task, viewedStageStopped }: { task: RuntimeTask; viewedStageStopped: boolean }) {
  return (
    <div className={`runtime-stage-empty ${viewedStageStopped ? "runtime-stage-empty--failed" : ""}`}>
      {task.status === "running" ? (
        <CircleNotch className="spin" size={22} />
      ) : viewedStageStopped ? (
        <WarningCircle size={22} />
      ) : (
        <FileCode size={22} />
      )}
      <strong>{viewedStageStopped ? "The stage stopped before producing an artifact" : "No artifact for this stage yet"}</strong>
      <span>{viewedStageStopped ? task.error : "The durable handoff will appear here when the stage completes."}</span>
    </div>
  );
}

function RuntimeCandidateDesk({
  task,
  candidate,
  onOpenDiff,
  diffLoading,
  compact = false,
  approval = false,
}: {
  task: RuntimeTask;
  candidate: RuntimeTask["candidates"][number];
  onOpenDiff: () => void;
  diffLoading: boolean;
  compact?: boolean;
  approval?: boolean;
}) {
  const gateStages: StageId[] = ["dev-review", "test", "final-review"];
  const freshGates = gateStages.filter((stage) =>
    task.artifacts.some(
      (artifact) =>
        artifact.stage === stage &&
        artifact.candidateId === candidate.id &&
        artifact.candidateRevision === candidate.revisionNumber,
    ),
  );
  const facts: Array<[string, string]> = approval
    ? [
        ["Repository", task.repositoryPath],
        ["Target branch", candidate.baseBranch],
        ["Merge method", "Fast-forward only"],
        ["Required gates", "Dev Review · Test · Final Review"],
        ["Gate freshness", `${freshGates.length} of ${gateStages.length} candidate-bound gates fresh`],
        ["Residual risks", task.artifacts.some((artifact) => artifact.stage === "final-review") ? "See retained Final Review" : "Not yet recorded"],
      ]
    : [
        ["Target branch", candidate.baseBranch],
        ["Merge method", "Fast-forward only"],
        ["Qualified slices", candidate.members?.map((item) => item.packageId).join(" → ") || "Pending assembly"],
        ["Gate freshness", `${freshGates.length} of ${gateStages.length} candidate-bound gates fresh`],
        ["Conflict status", "Not recorded by the runtime"],
      ];
  return (
    <section className={`runtime-candidate-desk ${compact ? "runtime-candidate-desk--compact" : ""}`}>
      <header>
        <span className="candidate-badge">
          <GitDiff size={16} />
          <span>
            <small>Integration candidate</small>
            <strong>{candidate.id} r{candidate.revisionNumber}</strong>
          </span>
          <code>{candidate.headRevision?.slice(0, 8) ?? "pending"}</code>
        </span>
        <span className={`badge badge--${candidate.status === "merged" ? "green" : candidate.status === "repair_required" ? "red" : "blue"}`}>
          {candidate.status.replaceAll("_", " ")}
        </span>
      </header>
      <RuntimeFactGrid facts={facts} />
      {candidate.revisions.length ? (
        <details className="runtime-repair-lineage" open={candidate.revisions.length > 1}>
          <summary>
            <Wrench size={15} /> Repair lineage · {candidate.revisions.length} revision{candidate.revisions.length === 1 ? "" : "s"}
            <CaretDown className="disclosure-caret" size={15} />
          </summary>
          {candidate.revisions.map((revision) => (
            <div key={revision.number}>
              <strong>r{revision.number} · {revision.headRevision.slice(0, 8)}</strong>
              <span>{revision.reason}</span>
              <small>{new Date(revision.createdAt).toLocaleString()}</small>
            </div>
          ))}
        </details>
      ) : null}
      <div className="runtime-candidate-desk__actions">
        <Button tone={approval ? "secondary" : "primary"} compact icon={GitDiff} disabled={!candidate.headRevision || diffLoading} onClick={onOpenDiff}>
          {diffLoading ? "Loading exact diff…" : "Inspect exact candidate diff"}
        </Button>
        {approval ? <small>Primary merge action remains in the command bar above.</small> : null}
      </div>
    </section>
  );
}

function RuntimeFinalReviewSummary({
  task,
  candidate,
}: {
  task: RuntimeTask;
  candidate: RuntimeTask["candidates"][number] | undefined;
}) {
  const stages = workflowStages.slice(0, 8);
  return (
    <section className="runtime-final-review">
      <header>
        <span>
          <small>Workflow record</small>
          <strong>What was done</strong>
        </span>
        <small>{candidate ? `${candidate.id} r${candidate.revisionNumber}` : "No candidate assembled"}</small>
      </header>
      <div className="runtime-final-review__table">
        <div className="runtime-final-review__row runtime-final-review__row--head">
          <span>Stage</span><span>State</span><span>Tokens</span><span>Cost</span><span>Durable outcome</span>
        </div>
        {stages.map((stage) => {
          const artifacts = task.artifacts.filter((artifact) => artifact.stage === stage.id);
          const latest = artifacts.at(-1);
          const tokens = artifacts.reduce((total, item) => total + item.usage.totalTokens, 0);
          const cost = artifacts.reduce((total, item) => total + (item.usage.cost ?? 0), 0);
          const hasCost = artifacts.some((item) => item.usage.cost != null);
          const stale = latest ? !isArtifactFresh(latest, candidate) : false;
          return (
            <div className="runtime-final-review__row" key={stage.id}>
              <strong>{stage.shortLabel}</strong>
              <span className={stale ? "text-amber" : task.completedStages.includes(stage.id) ? "text-green" : ""}>
                {stale ? "Stale" : task.completedStages.includes(stage.id) ? "Passed" : "Pending"}
              </span>
              <span className="mono">{formatTokenCount(tokens)}</span>
              <span>{hasCost ? formatApproximateCost(cost) : "Unavailable"}</span>
              <span>{latest?.name ?? "No artifact retained"}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RuntimeCommandBar({
  task,
  viewedStageId,
  onRun,
  onAction,
  onFinishGrill,
}: {
  task: RuntimeTask;
  viewedStageId: StageId;
  onRun: () => Promise<void>;
  onAction: (
    action:
      | "approve-spec"
      | "approve-plan"
      | "plan"
      | "implement"
      | "repair"
      | "review"
      | "test"
      | "final-review"
      | "approve-merge"
      | "grant-retry",
  ) => Promise<void>;
  onFinishGrill: (acceptRemaining: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const historical = viewedStageId !== task.currentStage;
  const running = task.status === "running";
  const repairRunning = running && task.activeRunKind === "repair";
  const currentAttempts = task.attemptsByStage?.[task.currentStage] ?? 0;
  const repairRequired = task.status === "repair-required";
  const exhaustedReadyGate =
    currentAttempts >= task.stageRunLimit &&
    ["ready-for-review", "ready-for-test", "ready-for-final-review"].includes(task.status);
  const blocked =
    task.status === "blocked" ||
    exhaustedReadyGate ||
    (currentAttempts >= task.stageRunLimit &&
      (task.status === "failed" || task.status === "cancelled" || repairRequired));
  const failed = !blocked && (task.status === "failed" || task.status === "cancelled");
  const ready =
    task.status.startsWith("awaiting-") ||
    task.status.startsWith("ready-for-") ||
    task.status === "completed";
  const accessBoundary = getAccessBoundaryCopy(task);
  const next = nextAction(task);
  const openGrill = task.status === "awaiting-grill" && task.grillSession?.status === "open";
  const unresolvedGrill = task.grillSession?.questions.filter((question) => !question.answer).length ?? 0;
  const actionable = ready || failed || repairRequired || blocked;
  const Icon = running ? CircleNotch : failed || blocked || repairRequired ? WarningCircle : CheckCircle;
  const invoke = async () => {
    if (!next?.action) return;
    setPending(true);
    setActionError(null);
    try {
      await onAction(next.action);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setPending(false);
    }
  };
  const finishGrillSession = async () => {
    setPending(true);
    setActionError(null);
    try {
      await onFinishGrill(unresolvedGrill > 0);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Grill Me could not be completed.");
    } finally {
      setPending(false);
    }
  };
  if (historical) {
    const activeStage = workflowStages.find((stage) => stage.id === task.currentStage)?.label ?? task.currentStage;
    return (
      <section className="stage-command-bar stage-command-bar--history">
        <FileCode size={18} />
        <span className="stage-command-bar__copy">
          <small>Historical stage · read-only</small>
          <strong>Viewing retained evidence</strong>
          <span>Workflow actions are hidden here. Return to {activeStage} to operate on the current state.</span>
        </span>
        <span className="badge badge--neutral">Recorded history</span>
      </section>
    );
  }
  return (
    <section
      className={`stage-command-bar stage-command-bar--${running ? "active" : failed || blocked || repairRequired ? "blocked" : ready ? "ready" : "waiting"}`}
    >
      <Icon className={running ? "spin" : ""} size={18} weight="fill" />
      <span className="stage-command-bar__copy">
        <small>{repairRunning ? "Candidate repair in progress" : accessBoundary.kicker}</small>
        <strong>
          {repairRunning
            ? "Repairing the retained integration candidate"
            : running
            ? accessBoundary.title
            : blocked
              ? (next?.title ?? "Repair allowance exhausted")
              : repairRequired
                ? `${accessBoundary.title} - repair the retained candidate`
                : failed
                  ? "Retry the failed stage"
                  : openGrill
                    ? "Resolve the decision frontier"
                    : ready
                      ? (next?.title ?? "Workflow gate ready")
                      : "Start the read-only investigation"}
        </strong>
        <span>
          {repairRunning
            ? "The Implement agent is writing inside the isolated candidate worktree. Dev Review, Test, Final Review, and Approval require fresh evidence after the new revision is assembled."
            : running
            ? accessBoundary.detail
            : blocked
              ? (next?.detail ?? "Review the retained activity before granting another attempt.")
              : repairRequired
                ? `${accessBoundary.detail} ${next?.detail ?? "The retained gate evidence identifies the required repair."}`
                : failed
                  ? task.error
                  : openGrill
                    ? unresolvedGrill
                      ? `${unresolvedGrill} material question${unresolvedGrill === 1 ? "" : "s"} remain. You can answer them below or explicitly accept the recommended assumptions.`
                      : "Every material question is settled. Finish Grill Me to build the task specification."
                    : ready
                      ? (next?.detail ?? "The retained workflow evidence is ready for review.")
                      : "Four focused agents will produce durable Markdown handoffs."}
        </span>
      </span>
      <div className="stage-command-bar__actions">
        {(task.status === "queued" ||
          (failed &&
            task.currentStage !== "plan" &&
            !["implement", "dev-review", "test", "final-review"].includes(task.currentStage))) && (
          <Button tone="primary" compact icon={Play} onClick={() => void onRun()}>
            {failed ? "Retry stage" : "Run investigation"}
          </Button>
        )}
        {actionable && next?.action ? (
          <Button tone="primary" compact icon={Play} disabled={pending} onClick={() => void invoke()}>
            {pending ? "Starting..." : next.label}
          </Button>
        ) : null}
        {openGrill ? (
          <Button
            tone="primary"
            compact
            icon={Play}
            disabled={pending}
            onClick={() => void finishGrillSession()}
          >
            {pending
              ? "Starting specification..."
              : unresolvedGrill
                ? `Finish with ${unresolvedGrill} recommendation${unresolvedGrill === 1 ? "" : "s"}`
                : "Finish Grill & build specification"}
          </Button>
        ) : null}
      </div>
      {actionError ? <span className="runtime-command-error">{actionError}</span> : null}
    </section>
  );
}

function nextAction(task: RuntimeTask) {
  const currentAttempts = task.attemptsByStage?.[task.currentStage] ?? 0;
  const retryAllowanceExhausted = currentAttempts >= task.stageRunLimit;
  if (
    (task.status === "blocked" ||
      (["repair-required", "failed"].includes(task.status) && retryAllowanceExhausted)) &&
    task.candidates?.at(-1)?.status === "repair_required"
  )
    return {
      action: "grant-retry" as const,
      label: "Grant one repair attempt",
      title: "Repair allowance exhausted",
      detail:
        "A human may grant exactly one additional attempt. The retained candidate and every failed review remain unchanged.",
    };
  if (
    retryAllowanceExhausted &&
    ["ready-for-review", "ready-for-test", "ready-for-final-review"].includes(task.status)
  )
    return {
      action: "grant-retry" as const,
      label: "Grant one stage attempt",
      title: "Stage retry allowance exhausted",
      detail: "A human may grant one additional attempt before this retained candidate enters the next gate.",
    };
  if (task.status === "blocked")
    return {
      action: "grant-retry" as const,
      label: "Grant one stage attempt",
      title: "Stage retry allowance exhausted",
      detail:
        "A human may grant one additional attempt. Qualified package commits and all failure evidence remain retained.",
    };
  if (task.status === "awaiting-spec-approval") {
    return task.workflow === "implement"
      ? {
          action: "approve-spec" as const,
          label: "Approve spec & create plan",
          title: "Approve the specification",
          detail: "Approval records this specification and starts a read-only planning agent.",
        }
      : {
          action: "approve-spec" as const,
          label: "Approve investigation",
          title: "Approve the investigation handoff",
          detail: "Approval closes this investigate-only task with the specification retained.",
        };
  }
  if (task.status === "awaiting-plan-approval")
    return {
      action: "approve-plan" as const,
      label: "Approve plan",
      title: "Approve the dependency-ordered plan",
      detail: "No repository changes happen until the approved plan is explicitly started.",
    };
  if (task.status === "ready-for-implementation")
    return {
      action: "implement" as const,
      label: "Start isolated implementation",
      title: "Create an isolated implementation candidate",
      detail:
        "The harness verifies a clean repository, creates a Git worktree, and gives Codex write access only there.",
    };
  if (task.status === "ready-for-review")
    return {
      action: "review" as const,
      label: "Run development review",
      title: "Review the exact candidate revision",
      detail: "The reviewer is bound to the candidate commit and cannot modify it.",
    };
  if (task.status === "ready-for-test")
    return {
      action: "test" as const,
      label: "Run focused tests",
      title: "Test the reviewed candidate",
      detail:
        "The test agent runs focused repository-defined checks without installing dependencies or running end-to-end suites.",
    };
  if (task.status === "ready-for-final-review")
    return {
      action: "final-review" as const,
      label: "Run final review",
      title: "Run the holdout final review",
      detail: "This gate summarizes every retained artifact against the approved acceptance criteria.",
    };
  if (task.status === "awaiting-human-approval")
    return {
      action: "approve-merge" as const,
      label: `Approve & merge ${task.candidates?.at(-1)?.id ?? "candidate"}`,
      title: "Human merge approval required",
      detail:
        "The harness will merge only if the source branch is clean, unchanged, and can fast-forward to the reviewed commit.",
    };
  if (task.status === "completed")
    return {
      action: null,
      label: "Completed",
      title: task.workflow === "implement" ? "Candidate merged" : "Investigation approved",
      detail: "The durable task evidence remains available from every completed stage.",
    };
  if (task.status === "failed") {
    if (task.candidates?.at(-1)?.status === "repair_required") {
      return {
        action: "repair" as const,
        label: "Retry repair",
        title: "Retry the candidate repair",
        detail:
          task.error ?? "The failed repair attempt left the last committed candidate revision unchanged.",
      };
    }
    const actions: Partial<Record<StageId, "plan" | "implement" | "review" | "test" | "final-review">> = {
      plan: "plan",
      implement: "implement",
      "dev-review": "review",
      test: "test",
      "final-review": "final-review",
    };
    const action = actions[task.currentStage];
    if (action)
      return {
        action,
        label: `Retry ${workflowStages.find((stage) => stage.id === task.currentStage)?.shortLabel ?? "stage"}`,
        title: "Retry the failed stage",
        detail: task.error ?? "The prior attempt failed; retained evidence will remain available.",
      };
  }
  if (task.status === "repair-required")
    return {
      action: "repair" as const,
      label: "Repair candidate",
      title: "Candidate repair required",
      detail:
        "The repair agent works in the same isolated worktree, creates a new candidate revision, and sends it through review again.",
    };
  return null;
}

export function getAccessBoundaryCopy(task: RuntimeTask) {
  const stage = workflowStages.find((entry) => entry.id === task.currentStage);
  const stageLabel = stage?.label ?? "Current stage";
  if (task.status === "awaiting-grill") {
    return {
      kicker: "Human decision boundary",
      title: "Grill Me is waiting for your decisions",
      detail:
        "No agent is running. Answer the material questions or explicitly accept the recommended assumptions.",
      sandbox: "No agent running",
    };
  }
  if (task.currentStage === "implement" || task.status === "repair-required") {
    return {
      kicker: "Worktree write scope",
      title: `${stageLabel} is confined to the isolated candidate worktree`,
      detail: "Codex may write only inside the isolated candidate worktree for this stage.",
      sandbox: "Isolated candidate worktree",
    };
  }
  if (task.currentStage === "test") {
    return {
      kicker: "Candidate cleanliness boundary",
      title: `${stageLabel} may create temporary files while testing`,
      detail:
        "Temporary files are allowed, but the exact candidate revision must be left clean when the gate completes.",
      sandbox: "Temporary writes allowed, candidate must remain clean",
    };
  }
  return {
    kicker: "Read-only boundary",
    title: `${stageLabel} is read-only`,
    detail: "Codex reads the repository without writing to it in this stage.",
    sandbox: "Read-only",
  };
}

function RuntimeGrillPanel({
  task,
  onAnswer,
}: {
  task: RuntimeTask;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
}) {
  const session = task.grillSession;
  if (!session) return null;
  const settled = session.questions.filter((question) => question.answer).length;
  const interactive = session.status === "open" && task.status === "awaiting-grill";
  const activeQuestion = session.questions.find((question) => !question.answer);
  return (
    <section className="runtime-grill" aria-label="Grill Me decision session">
      <header>
        <span>
          <small>Decision frontier</small>
          <strong>
            {settled} of {session.questions.length} material questions settled
          </strong>
        </span>
        <StateBadge state={session.status === "completed" ? "completed" : "needs-input"} />
      </header>
      {session.completionReason ? <p className="runtime-grill__reason">{session.completionReason}</p> : null}
      {activeQuestion ? (
        <div className="runtime-grill__questions">
          <RuntimeGrillQuestionCard
            key={activeQuestion.id}
            question={activeQuestion}
            index={session.questions.indexOf(activeQuestion)}
            interactive={interactive}
            onAnswer={onAnswer}
          />
          {settled ? (
            <details className="runtime-grill-history">
              <summary><span>{settled} accumulated decision{settled === 1 ? "" : "s"}</span><CaretDown className="disclosure-caret" size={15} /></summary>
              {session.questions.filter((question) => question.answer).map((question) => (
                <RuntimeGrillQuestionCard
                  key={question.id}
                  question={question}
                  index={session.questions.indexOf(question)}
                  interactive={false}
                  onAnswer={onAnswer}
                />
              ))}
            </details>
          ) : null}
        </div>
      ) : session.questions.length ? (
        <div className="runtime-grill__questions">
          {session.questions.map((question) => (
            <RuntimeGrillQuestionCard
              key={question.id}
              question={question}
              index={session.questions.indexOf(question)}
              interactive={false}
              onAnswer={onAnswer}
            />
          ))}
        </div>
      ) : (
        <div className="runtime-stage-empty">
          <CheckCircle size={22} weight="fill" />
          <strong>No material questions remain</strong>
          <span>
            Repository evidence and safe reversible defaults are sufficient to build the specification.
          </span>
        </div>
      )}
      {task.decisions.length ? (
        <details className="runtime-grill-history runtime-grill-history--all" open>
          <summary>
            <span>{task.decisions.length} accumulated task decision{task.decisions.length === 1 ? "" : "s"}</span>
            <CaretDown size={16} />
          </summary>
          <div className="runtime-task-decisions">
            {task.decisions.map((decision) => (
              <article key={decision.id}>
                <small>{new Date(decision.createdAt).toLocaleString()}</small>
                <strong>{decision.question}</strong>
                <p>{decision.answer}</p>
              </article>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function RuntimeGrillQuestionCard({
  question,
  index,
  interactive,
  onAnswer,
}: {
  question: RuntimeGrillQuestion;
  index: number;
  interactive: boolean;
  onAnswer: (questionId: string, answer: string) => Promise<void>;
}) {
  const recommended = question.options.find((option) => option.recommended);
  const [choice, setChoice] = useState(recommended?.id ?? question.options[0]?.id ?? "custom");
  const [custom, setCustom] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (question.answer) {
    return (
      <details className="runtime-grill-question runtime-grill-question--settled">
        <summary>
          <CheckCircle size={18} weight="fill" />
          <span>
            <small>Question {index + 1} · settled</small>
            <strong>{question.question}</strong>
          </span>
          <CaretDown className="disclosure-caret" size={15} />
        </summary>
        <p>{question.whyItMatters}</p>
        <div className="runtime-grill-answer">
          <small>
            {question.answerSource === "accepted-assumption" ? "Accepted recommendation" : "Your answer"}
          </small>
          <strong>{question.answer}</strong>
        </div>
      </details>
    );
  }
  return (
    <article className="runtime-grill-question">
      <header>
        <span>
          <small>Question {index + 1}</small>
          <strong>{question.question}</strong>
        </span>
        <StateBadge state="needs-input" />
      </header>
      <p>{question.whyItMatters}</p>
      {recommended ? (
        <div className="runtime-grill-recommendation">
          <small>Recommended answer</small>
          <strong>{recommended.label}</strong>
          <span>{recommended.description}</span>
        </div>
      ) : null}
      {interactive ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const selected = question.options.find((option) => option.id === choice);
            const answer = choice === "custom" ? custom.trim() : selected?.label;
            if (!answer) return;
            setPending(true);
            setError(null);
            try {
              await onAnswer(question.id, answer);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Answer could not be saved.");
            } finally {
              setPending(false);
            }
          }}
        >
          <fieldset>
            <legend className="sr-only">Answer {question.question}</legend>
            {question.options.map((option) => (
              <label key={option.id} className={choice === option.id ? "selected" : ""}>
                <input
                  type="radio"
                  name={`answer-${question.id}`}
                  value={option.id}
                  checked={choice === option.id}
                  onChange={() => setChoice(option.id)}
                />
                <span>
                  <strong>
                    {option.label} {option.recommended ? <em>Recommended</em> : null}
                  </strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
            {question.allowCustom ? (
              <label className={choice === "custom" ? "selected" : ""}>
                <input
                  type="radio"
                  name={`answer-${question.id}`}
                  value="custom"
                  checked={choice === "custom"}
                  onChange={() => setChoice("custom")}
                />
                <span>
                  <strong>Custom answer</strong>
                  <small>Provide a different authoritative decision.</small>
                </span>
              </label>
            ) : null}
          </fieldset>
          {choice === "custom" ? (
            <textarea
              aria-label={`Custom answer for ${question.question}`}
              rows={3}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="Describe the decision and any constraints"
            />
          ) : null}
          <Button
            tone="primary"
            compact
            type="submit"
            disabled={pending || (choice === "custom" && !custom.trim())}
          >
            {pending ? "Saving..." : "Confirm answer"}
          </Button>
          {error ? <small className="text-red">{error}</small> : null}
        </form>
      ) : (
        <small>This question was not settled before the session closed.</small>
      )}
    </article>
  );
}

function RuntimeWorkPackages({ task }: { task: RuntimeTask }) {
  const batches = [...new Set(task.workPackages.map((item) => item.batch))].sort((a, b) => a - b);
  return (
    <section className="runtime-packages" aria-label="Implementation work packages">
      <header>
        <span>
          <small>Dependency-aware implementation</small>
          <strong>
            {task.workPackages.length} package{task.workPackages.length === 1 ? "" : "s"} · {batches.length}{" "}
            batch
            {batches.length === 1 ? "" : "es"}
          </strong>
        </span>
      </header>
      <div className="runtime-package-batches">
        {batches.map((batch, index) => (
          <div className="runtime-package-batch" key={batch}>
            <small>Batch {batch}</small>
            <div>
              {task.workPackages
                .filter((item) => item.batch === batch)
                .map((workPackage) => {
                  const packageArtifact = [...task.artifacts].reverse().find((artifact) => artifact.workPackageId === workPackage.id);
                  return (
                  <details
                    key={workPackage.id}
                    className={`runtime-package runtime-package--${workPackage.status}`}
                  >
                    <summary>
                      {workPackage.status === "running" ? (
                        <CircleNotch className="spin" size={17} />
                      ) : workPackage.status === "failed" ? (
                        <WarningCircle size={17} />
                      ) : workPackage.status === "planned" ? (
                        <FileCode size={17} />
                      ) : (
                        <CheckCircle size={17} weight="fill" />
                      )}
                      <span>
                        <small>
                          {workPackage.id} · {workPackage.status === "ready_for_integration" ? "ready for integration" : workPackage.status.replaceAll("_", " ")}
                        </small>
                        <strong>{workPackage.title}</strong>
                      </span>
                      <CaretDown className="disclosure-caret" size={15} />
                    </summary>
                    <p>{workPackage.description}</p>
                    <RuntimeRow label="Depends on" value={workPackage.dependencies.join(", ") || "None"} />
                    <RuntimeRow
                      label="Owned paths"
                      value={workPackage.ownedPaths.join(", ") || "Plan-defined scope"}
                    />
                    <RuntimeRow
                      label="Verification"
                      value={workPackage.verification.join(" · ") || "No command recorded"}
                      mono
                    />
                    <RuntimeRow label="Interfaces" value="Not recorded by the runtime" />
                    <RuntimeRow label="Agent / model" value={packageArtifact ? `${packageArtifact.model} · ${packageArtifact.reasoning ?? "reasoning not recorded"}` : "Not run yet"} />
                    <RuntimeRow label="Usage" value={packageArtifact ? `${formatTokenCount(packageArtifact.usage.inputTokens)} in · ${formatTokenCount(packageArtifact.usage.outputTokens)} out · ${formatCacheRate(packageArtifact.usage)} cached · ${formatApproximateCost(packageArtifact.usage.cost)}` : "Not run yet"} />
                    <RuntimeRow label="Attempts" value={String(workPackage.attempts)} />
                    <RuntimeRow label="Branch" value={workPackage.branch ?? "Not created"} mono />
                    <RuntimeRow label="Worktree" value={workPackage.worktreePath ?? "Not created"} mono />
                    <RuntimeRow label="Changed files" value={workPackage.files.join(", ") || "None recorded"} />
                    {workPackage.headRevision ? (
                      <RuntimeRow label="Package commit" value={workPackage.headRevision.slice(0, 8)} mono />
                    ) : null}
                    {workPackage.error ? <small className="text-red">{workPackage.error}</small> : null}
                  </details>
                  );
                })}
            </div>
            {index < batches.length - 1 ? (
              <span className="runtime-package-arrow">↓ dependencies unlock</span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function RuntimeWorktreeInventory({
  inventory,
  selectedId,
  onSelect,
}: {
  inventory: RuntimeWorktreeInventoryRow[];
  selectedId: string | null;
  onSelect: (rowId: string | null) => void;
}) {
  const selectedRow = inventory.find((row) => row.id === selectedId) ?? null;
  if (selectedRow) {
    return (
      <div className="runtime-worktree-inventory runtime-worktree-inventory--detail">
        <button type="button" className="icon-button" onClick={() => onSelect(null)} aria-label="Return to inventory list">
          <ArrowLeft size={16} />
        </button>
        <details className="runtime-worktree-inventory__detail" open>
          <summary>
            <span>
              <small>
                {selectedRow.kind} · {selectedRow.lifecycleState}
              </small>
              <strong>{selectedRow.label}</strong>
            </span>
          </summary>
          <div className="runtime-worktree-inventory__detail-grid">
            <RuntimeRow label="Kind" value={selectedRow.kind} />
            <RuntimeRow label="Lifecycle" value={selectedRow.lifecycleState} />
            <RuntimeRow label="Worktree" value={selectedRow.worktreePath} mono />
            <RuntimeRow label="Branch" value={selectedRow.branch} mono />
            <RuntimeRow label="Base" value={selectedRow.baseRevision ?? "n/a"} mono />
            <RuntimeRow label="Head" value={selectedRow.headRevision ?? "n/a"} mono />
            <RuntimeRow label="Task" value={selectedRow.taskId} mono />
            <RuntimeRow label="Work package" value={selectedRow.workPackageId ?? "n/a"} mono />
            <RuntimeRow label="Git exists" value={selectedRow.gitExists ? "present" : "missing"} />
            <RuntimeRow label="Git head" value={selectedRow.gitHeadRevision ?? "n/a"} mono />
            <RuntimeRow label="Cleanliness" value={selectedRow.gitClean == null ? "unknown" : selectedRow.gitClean ? "clean" : "dirty"} />
            <RuntimeRow label="Cleanup" value={selectedRow.cleanupReady ? "ready" : "not ready"} />
          </div>
        </details>
        <p className="runtime-worktree-inventory__return">Return to the inventory list to inspect another retained worktree.</p>
      </div>
    );
  }

  return (
    <div className="runtime-worktree-inventory">
      {inventory.map((row) => (
        <button
          key={row.id}
          type="button"
          className={`runtime-worktree-row runtime-worktree-row--${row.lifecycleState}`}
          onClick={() => onSelect(row.id)}
        >
          <span className="runtime-worktree-row__identity">
            <small>
              {row.kind} · {row.lifecycleState}
            </small>
            <strong>{row.label}</strong>
          </span>
          <span className="runtime-worktree-row__badges">
            <span className={`badge badge--${row.kind === "candidate" ? "red" : "green"}`}>{row.kind}</span>
            <span className={`badge badge--${row.lifecycleState === "active" ? "green" : row.lifecycleState === "retained" ? "yellow" : "red"}`}>{row.lifecycleState}</span>
            <span className={`badge badge--${row.cleanupReady ? "green" : "yellow"}`}>{row.cleanupReady ? "cleanup ready" : "keep retained"}</span>
          </span>
          <span className="runtime-worktree-row__path mono">{row.worktreePath}</span>
        </button>
      ))}
    </div>
  );
}

function RuntimeContextDisclosure({ artifact }: { artifact: RuntimeArtifact }) {
  const manifest = artifact.contextManifest;
  return (
    <details className="runtime-context-disclosure">
      <summary>
        <span><strong>Context supplied</strong><small>{manifest ? `${manifest.sources.length} sources · ~${formatTokenCount(manifest.estimatedPromptTokens)} rendered prompt tokens` : "Not recorded for this historical run"}</small></span>
        <CaretDown className="disclosure-caret" size={15} />
      </summary>
      {manifest ? (
        <div>
          <p>{manifest.policy}</p>
          <ul>
            {manifest.sources.map((source) => (
              <li key={`${source.kind}-${source.id}`}>
                <span><strong>{source.label}</strong><small>{source.kind}{source.stage ? ` · ${source.stage}` : ""}{source.truncated ? " · truncated" : ""}</small></span>
                <code>{source.includedCharacters == null ? manifest.repositoryAccess : `${source.includedCharacters.toLocaleString()} chars`}</code>
              </li>
            ))}
          </ul>
          <small>Supplied context records what was included or accessible. It cannot prove which text the model relied on.</small>
        </div>
      ) : <p>Context manifests are recorded for new agent runs. Older artifacts retain usage but cannot reconstruct the exact prompt boundary.</p>}
    </details>
  );
}

function RuntimeFocusedTestEvidencePanel({
  evidence,
  candidate,
  selectedResultId,
  onSelectResult,
}: {
  evidence: RuntimeFocusedTestEvidence;
  candidate: RuntimeTask["candidates"][number] | undefined;
  selectedResultId: string | null;
  onSelectResult: (resultId: string | null) => void;
}) {
  const selectedRow = evidence.rows.find((row) => row.id === selectedResultId) ?? null;
  const passed = evidence.rows.filter((row) => row.status === "passed").length;
  const failed = evidence.rows.length - passed;
  useEffect(() => {
    if (selectedResultId && !selectedRow) onSelectResult(null);
  }, [onSelectResult, selectedResultId, selectedRow]);
  useEffect(() => {
    if (!selectedRow) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSelectResult(null);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onSelectResult, selectedRow]);
  return (
    <section className="runtime-focused-test" aria-label="Focused test evidence">
      <header>
        <span>
          <small>Candidate-bound structured evidence</small>
          <strong>
            {passed} passed · {failed} failed · {evidence.candidateId} r{evidence.candidateRevision}
          </strong>
        </span>
        <span className="mono">{evidence.command}</span>
      </header>
      {selectedRow ? (
        <div className="runtime-focused-test__detail">
          <button type="button" className="detail-back" onClick={() => onSelectResult(null)}>
            <ArrowLeft size={15} /> Back to test list
          </button>
          <div className="runtime-focused-test__detail-title">
            {selectedRow.status === "passed" ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}
            <span>
              <small>{selectedRow.status} result details</small>
              <strong>{selectedRow.title}</strong>
            </span>
          </div>
          <RuntimeRow label="Command" value={selectedRow.command} mono />
          <RuntimeRow label="Candidate" value={`${selectedRow.candidateId} r${selectedRow.candidateRevision}`} mono />
          <RuntimeRow label="Duration" value={selectedRow.durationMs == null ? "Not recorded" : `${selectedRow.durationMs}ms`} />
          <RuntimeRow
            label="Artifacts"
            value={selectedRow.artifactReferences.map((item) => `${item.name} · ${item.kind}`).join(", ") || "Markdown test artifact"}
          />
          <div className="runtime-test-assertions">
            <small>Assertions</small>
            {selectedRow.assertions.map((assertion) => (
              <div key={assertion.label}>
                <strong>{assertion.label}</strong>
                <span>Expected: {assertion.expected ?? "Not recorded"}</span>
                <span>Actual: {assertion.actual}</span>
              </div>
            ))}
          </div>
          {selectedRow.failureDetails ? <p className="runtime-test-failure">{selectedRow.failureDetails}</p> : null}
          <Button tone="ghost" compact icon={ArrowLeft} onClick={() => onSelectResult(null)}>
            Back to all tests
          </Button>
        </div>
      ) : (
        <div className="runtime-focused-test__rows">
          {evidence.rows.map((row) => (
            <button type="button" key={row.id} onClick={() => onSelectResult(row.id)}>
              {row.status === "passed" ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}
              <span>
                <strong>{row.title}</strong>
                <small>{row.command} · {row.assertions.map((assertion) => assertion.label).join(" · ") || "No assertions recorded"}</small>
              </span>
              <span>
                <strong className={row.status === "failed" ? "text-red" : "text-green"}>{row.status}</strong>
                <small>{row.durationMs == null ? "Duration not recorded" : `${row.durationMs}ms`}</small>
              </span>
              <ArrowSquareOut size={15} />
            </button>
          ))}
        </div>
      )}
      <footer>
        <small>
          {candidate ? `Current candidate ${candidate.id} r${candidate.revisionNumber}` : "No active candidate"}
        </small>
        <small>{evidence.status === "passed" ? "Pass" : "Failure"} evidence retained with Markdown output</small>
      </footer>
    </section>
  );
}

function DecisionFrontier({
  task,
  canRecord,
  onDecision,
}: {
  task: RuntimeTask;
  canRecord: boolean;
  onDecision: (question: string, answer: string) => Promise<void>;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="runtime-decisions">
      {task.decisions?.length ? (
        task.decisions.map((decision) => (
          <details key={decision.id}>
            <summary>{decision.question}</summary>
            <p>{decision.answer}</p>
          </details>
        ))
      ) : (
        <small>
          No human decisions recorded. Recommended assumptions remain visible in the decision brief.
        </small>
      )}
      {canRecord && !task.status.startsWith("running") &&
      !["completed", "awaiting-human-approval"].includes(task.status) ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            try {
              await onDecision(question, answer);
              setQuestion("");
              setAnswer("");
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Decision could not be saved.");
            } finally {
              setPending(false);
            }
          }}
        >
          <input
            aria-label="Decision question"
            placeholder="Decision or constraint"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <textarea
            aria-label="Decision answer"
            placeholder="Authoritative answer"
            rows={2}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <Button tone="ghost" compact type="submit" disabled={pending || !question.trim() || !answer.trim()}>
            {pending ? "Saving..." : "Record decision"}
          </Button>
          {error ? <small className="text-red">{error}</small> : null}
        </form>
      ) : null}
    </div>
  );
}

function TaskEvaluation({
  evaluation,
  disabled,
  onEvaluate,
}: {
  evaluation: RuntimeTask["evaluation"];
  disabled: boolean;
  onEvaluate: (score: number, outcome: "accepted" | "rejected" | "mixed", notes: string) => Promise<void>;
}) {
  const [score, setScore] = useState(evaluation?.score ?? 0);
  const [outcome, setOutcome] = useState<"accepted" | "rejected" | "mixed">(evaluation?.outcome ?? "mixed");
  const [notes, setNotes] = useState(evaluation?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="task-evaluation">
      <fieldset className="task-evaluation__scores">
        <legend className="sr-only">Outcome quality score</legend>
        {[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={score === value ? "is-selected" : ""} onClick={() => setScore(value)} aria-label={`${value} out of 5`}>{value}</button>)}
      </fieldset>
      <label>Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}><option value="accepted">Accepted</option><option value="mixed">Mixed</option><option value="rejected">Rejected</option></select></label>
      <label>Evaluator notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What made the output good or poor?" /></label>
      <Button tone="secondary" compact disabled={disabled || !score || saving} onClick={async () => { setSaving(true); setError(null); try { await onEvaluate(score, outcome, notes); } catch (reason) { setError(reason instanceof Error ? reason.message : "The evaluation could not be saved."); } finally { setSaving(false); } }}>{saving ? "Saving…" : evaluation ? "Update evaluation" : "Add to scorecard"}</Button>
      {error ? <small className="text-red">{error}</small> : null}
    </div>
  );
}

function InspectorSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="runtime-inspector-section">
      <header>
        <strong>{title}</strong>
        {meta ? <small>{meta}</small> : null}
      </header>
      {children}
    </section>
  );
}

function RuntimeRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="runtime-meta-row">
      <small>{label}</small>
      <strong className={mono ? "mono" : ""}>{value}</strong>
    </span>
  );
}

function RuntimeActivity({ events }: { events: RuntimeEvent[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"activity" | "agent" | "test" | "decision">("activity");
  const visibleEvents = useMemo(
    () =>
      [...events]
        .reverse()
        .filter((event) =>
          filter === "activity"
            ? true
            : filter === "agent"
              ? event.category === "agent"
              : filter === "test"
                ? event.stage === "test"
                : event.category === "decision",
        )
        .slice(0, 40),
    [events, filter],
  );
  return (
    <details className="runtime-activity" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>
          <Robot size={16} />
          <strong>Run activity</strong>
          <small>Agent sessions, repository commands, artifacts, and decisions · {events.length} events</small>
        </span>
        <span>
          <span className="connection-dot" />
          {events.at(-1)?.title ?? "Waiting to start"}
        </span>
      </summary>
      <div className="runtime-activity-filters" role="tablist" aria-label="Run activity filters">
        {([
          ["activity", "Activity"],
          ["agent", "Agent runs"],
          ["test", "Test runs"],
          ["decision", "Decisions"],
        ] as const).map(([id, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? "selected" : ""}
            key={id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <small>These are persisted runtime events. Model, token, duration, and artifact linkage appear only when the Codex event stream records them.</small>
      </div>
      <div className="runtime-activity-list">
        {visibleEvents.length ? visibleEvents.map((event) => (
            <div className={`runtime-activity-row runtime-activity-row--${event.tone}`} key={event.id}>
              <time className="mono">
                {new Date(event.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
              <span>
                <strong>{event.title}</strong>
                <small>{event.detail}</small>
              </span>
              <em>{workflowStages.find((stage) => stage.id === event.stage)?.shortLabel ?? event.stage}</em>
            </div>
          )) : (
            <div className="runtime-activity-empty">No recorded events match this filter.</div>
          )}
      </div>
    </details>
  );
}

export async function copyArtifactContent(
  content: string,
  clipboard: Pick<Clipboard, "writeText"> | null | undefined = globalThis.navigator?.clipboard,
) {
  if (!clipboard?.writeText) {
    return { ok: false as const, message: "Clipboard access failed. Your browser did not expose clipboard write support." };
  }
  try {
    await clipboard.writeText(content);
    return { ok: true as const };
  } catch {
    return { ok: false as const, message: "Clipboard access failed. The browser blocked copying this artifact." };
  }
}

export function shouldApplyArtifactCopyFeedback(requestedArtifactId: string, activeArtifactId: string) {
  return requestedArtifactId === activeArtifactId;
}

export function RuntimeArtifactViewer({ artifact, onClose }: { artifact: RuntimeArtifact; onClose: () => void }) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "error" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const activeArtifactIdRef = useRef(artifact.id);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeArtifactIdRef.current = artifact.id;
    setCopyStatus(null);
    setCopyError(null);
  }, [artifact.id]);
  useEffect(() => {
    if (copyStatus !== "copied") return;
    const timer = window.setTimeout(() => setCopyStatus(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);
  const handleCopy = async () => {
    const requestedArtifactId = artifact.id;
    const result = await copyArtifactContent(artifact.content);
    if (!shouldApplyArtifactCopyFeedback(requestedArtifactId, activeArtifactIdRef.current)) {
      return;
    }
    if (result.ok) {
      setCopyError(null);
      setCopyStatus("copied");
      return;
    }
    setCopyStatus("error");
    setCopyError(result.message);
  };
  return (
    <div
      className="artifact-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${artifact.name} artifact`}
    >
      <button
        type="button"
        className="artifact-overlay__backdrop"
        onClick={onClose}
        aria-label="Close artifact"
      />
      <section className="artifact-viewer">
        <header>
          <span>
            <FileCode size={18} />
            <span>
              <small>
                {artifact.stage} · {artifact.kind}
              </small>
              <strong>{artifact.name}</strong>
            </span>
          </span>
          <div className="artifact-viewer__actions">
            <Button tone="ghost" compact onClick={handleCopy}>
              Copy artifact
            </Button>
            <button
              ref={closeButtonRef}
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Close artifact viewer"
            >
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="artifact-viewer__summary">
          <span>Real agent output · read-only</span>
          <p>Produced by {artifact.model}{artifact.reasoning ? ` at ${artifact.reasoning} reasoning` : ""}; retained as the handoff to downstream stages.</p>
          {copyStatus === "copied" ? <small className="text-green">Copied</small> : null}
          {copyError ? <small className="text-red">{copyError}</small> : null}
        </div>
        <div className="artifact-viewer__usage">
          <span><small>Input</small><strong>{formatTokenCount(artifact.usage.inputTokens)}</strong></span>
          <span><small>Output</small><strong>{formatTokenCount(artifact.usage.outputTokens)}</strong></span>
          <span><small>Cached input</small><strong className="text-green">{formatCacheRate(artifact.usage)} · {formatTokenCount(artifact.usage.cachedInputTokens)}</strong></span>
          <span><small>Approx. cost</small><strong>{formatApproximateCost(artifact.usage.cost)}</strong></span>
        </div>
        <MarkdownContent content={stripEmbeddedCandidatePatch(artifact.content)} className="artifact-viewer__markdown" />
        <RuntimeContextDisclosure artifact={artifact} />
        <details className="artifact-viewer__raw">
          <summary>View raw Markdown source</summary>
          <pre>{artifact.content}</pre>
        </details>
        <footer>
          <small>{new Date(artifact.createdAt).toLocaleString()}</small>
          <span className="mono">API-rate estimate · ChatGPT plan session</span>
        </footer>
      </section>
    </div>
  );
}

function toTaskRunState(status: RuntimeTask["status"]): TaskRunState {
  if (status === "closed") return "closed";
  if (status === "queued") return "paused";
  if (status === "cancelled" || status === "blocked") return "blocked";
  if (status === "running" || status === "failed" || status === "completed") return status;
  return "needs-input";
}
