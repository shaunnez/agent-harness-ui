import { FileCode, GitDiff } from "@phosphor-icons/react";
import { isModelRunArtifact, resolveScoutUsage } from "../../artifactPresentation";
import {
  formatApproximateCost,
  formatCacheRate,
  formatTokenCount,
  type RuntimeArtifact,
  type StageId,
  type WorkflowProfileId,
  workflowStages,
} from "../../domain";
import { MarkdownContent } from "../MarkdownContent";
import { Button } from "../Primitives";
import { ApprovalHistorySection, getApprovalHistory } from "../runtimeApprovalHistory.js";
import {
  getEffectiveRunStage,
  getEffectiveStageRunAttempts,
  getEffectiveStageRunLimit,
} from "../../runtime-stage-limits";
import { getAccessBoundaryCopy } from "./RuntimeCommandBar";
import type { RuntimeTaskWorkspaceProps } from "./contracts";
import { DecisionFrontier, RuntimeContextDisclosure } from "./RuntimeEvidencePanels";
import { TaskEvaluation } from "./RuntimeInspectorPanels";
import { InspectorSection, RuntimeRow } from "./RuntimeInspectorPrimitives";
import { RuntimeRetainedEvidenceSections } from "./RuntimeRetainedEvidenceSections";
import {
  getRuntimeGateFreshness,
  getStageTemporalState,
  isCandidateGateStage,
  runtimeStageAgents,
  runtimeStageSkills,
} from "./workflow";

type Props = {
  task: RuntimeTaskWorkspaceProps["task"];
  readOnlyPreview?: boolean;
  viewedStageId: StageId;
  initialSelectedWorktreeId?: string | null;
  candidateDiffLoading: boolean;
  onProfileChange: RuntimeTaskWorkspaceProps["onProfileChange"];
  onDecision: RuntimeTaskWorkspaceProps["onDecision"];
  onEvaluate: RuntimeTaskWorkspaceProps["onEvaluate"];
  onRemoveWorktree: RuntimeTaskWorkspaceProps["onRemoveWorktree"];
  onLoadMoreArtifacts: RuntimeTaskWorkspaceProps["onLoadMoreArtifacts"];
  onSelectStage: (stageId: StageId) => void;
  onOpenArtifact: (artifact: RuntimeArtifact) => void;
  onOpenCandidateDiff: () => void;
};

export function RuntimeTaskInspector({
  task,
  readOnlyPreview = false,
  viewedStageId,
  initialSelectedWorktreeId,
  candidateDiffLoading,
  onProfileChange,
  onDecision,
  onEvaluate,
  onRemoveWorktree,
  onLoadMoreArtifacts,
  onSelectStage,
  onOpenArtifact,
  onOpenCandidateDiff,
}: Props) {
  const currentIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === task.currentStage),
  );
  const viewedStage = workflowStages.find((stage) => stage.id === viewedStageId);
  if (!viewedStage) throw new Error(`Unknown workflow stage: ${viewedStageId}`);
  const candidate = task.candidates?.at(-1);
  const gateFreshness = isCandidateGateStage(viewedStageId)
    ? getRuntimeGateFreshness(task, viewedStageId)
    : null;
  const stageArtifact = isCandidateGateStage(viewedStageId)
    ? task.artifacts.find(
        (artifact) => artifact.stage === viewedStageId && artifact.id === gateFreshness?.sourceArtifactId,
      )
    : [...task.artifacts].reverse().find((artifact) => artifact.stage === viewedStageId);
  const viewedTemporalState = getStageTemporalState(task, viewedStageId);
  const historical = viewedTemporalState === "past";
  const futureStage = viewedTemporalState === "future";
  const runningPackages = task.workPackages?.filter((item) => item.status === "running") ?? [];
  const accessBoundary = getAccessBoundaryCopy(task);
  const activeAgentRole = task.activeRunKind === "repair" ? "repair" : task.currentStage;
  const activePolicy = task.agentConfig?.stagePolicies?.[activeAgentRole] ?? {
    model: task.agentConfig?.model ?? task.models[0]?.model ?? "gpt-5.6-luna",
    reasoning: task.agentConfig?.reasoning ?? "xhigh",
  };
  const viewedRuns = (task.runs ?? []).filter((run) => run.stage === viewedStageId);
  const viewedScoutUsage = viewedStageId === "scouts" ? resolveScoutUsage(task) : null;
  const viewedUsage = viewedScoutUsage
    ? {
        input: viewedScoutUsage.aggregate.inputTokens,
        cached: viewedScoutUsage.aggregate.cachedInputTokens,
        output: viewedScoutUsage.aggregate.outputTokens,
        credits: viewedScoutUsage.aggregate.credits ?? 0,
        estimate: viewedScoutUsage.aggregate.cost ?? 0,
      }
    : viewedRuns.reduce(
        (usage, run) => ({
          input: usage.input + (run.usage?.inputTokens ?? 0),
          cached: usage.cached + (run.usage?.cachedInputTokens ?? 0),
          output: usage.output + (run.usage?.outputTokens ?? 0),
          credits: usage.credits + (run.credits ?? run.usage?.credits ?? 0),
          estimate: usage.estimate + (run.apiEstimate ?? run.usage?.cost ?? 0),
        }),
        { input: 0, cached: 0, output: 0, credits: 0, estimate: 0 },
      );
  const recordedVerification = uniqueVerificationExecutions(
    task.artifacts.map((artifact) => artifact.focusedTest).filter((item) => item != null),
  );
  const focusedExecutions = recordedVerification.filter((item) => item.executionKind === "focused-package");
  const fullManifestExecutions = recordedVerification.filter(
    (item) => item.executionKind === "full-manifest",
  );
  const stageChecks =
    viewedStageId === "implement"
      ? focusedExecutions
      : viewedStageId === "test"
        ? fullManifestExecutions
        : [];
  const stageCheckDuration = stageChecks.reduce((total, item) => total + (item.durationMs ?? 0), 0);
  const stageWallDuration = viewedScoutUsage
    ? elapsedWindow(viewedScoutUsage.matchedArtifacts)
    : elapsedWindow([...viewedRuns, ...stageChecks]);
  const taskWallDuration = task.startedAt
    ? elapsedWindow([{ startedAt: task.startedAt, completedAt: task.completedAt ?? task.updatedAt }])
    : elapsedWindow([...(task.runs ?? []), ...recordedVerification]);
  const focusedDuration = focusedExecutions.reduce((total, item) => total + (item.durationMs ?? 0), 0);
  const fullManifestDuration = fullManifestExecutions.reduce(
    (total, item) => total + (item.durationMs ?? 0),
    0,
  );
  const canOverrideProfile =
    !readOnlyPreview &&
    !candidate &&
    task.status !== "running" &&
    task.status !== "cancelling" &&
    ["triage", "scouts", "grill", "specification", "plan"].includes(task.currentStage);
  const currentStageRunLimit = getEffectiveStageRunLimit(task);
  const currentStageRunAttempts = getEffectiveStageRunAttempts(task);
  const effectiveRunStage = getEffectiveRunStage(task);
  const stageRunLabel = effectiveRunStage === task.currentStage ? "Stage" : "Implement repair";
  const repoName = task.repositoryPath.split(/[\\/]/).filter(Boolean).at(-1) ?? task.repositoryPath;

  return (
    <aside className="stage-inspector runtime-inspector">
      <InspectorSection title="Task brief">
        <strong>{task.title}</strong>
        <MarkdownContent content={task.description} className="runtime-task-brief-markdown" />
        {task.attachments?.length ? (
          <div className="runtime-attachments">
            <small>
              {task.attachments.length} reference artifact{task.attachments.length === 1 ? "" : "s"}
            </small>
            {task.attachments.map((attachment) => (
              <span key={attachment.id}>
                <FileCode size={14} />
                <strong>{attachment.name}</strong>
                <small>{Math.ceil(attachment.size / 1024)} KB</small>
              </span>
            ))}
          </div>
        ) : null}
      </InspectorSection>
      {task.continuedFromTaskId ? (
        <InspectorSection title="Investigation handoff" meta={task.continuedFromTaskId}>
          <RuntimeRow label="Authority" value="This task owns planning and implementation" />
          <RuntimeRow label="Source" value={`${task.continuedFromTaskId} remains read-only`} mono />
          <RuntimeRow
            label="Imported evidence"
            value={`${task.artifacts.filter((artifact) => artifact.sourceTaskId === task.continuedFromTaskId).length} artifacts · ${task.decisions.filter((decision) => decision.sourceTaskId === task.continuedFromTaskId).length} decisions`}
          />
        </InspectorSection>
      ) : null}
      {task.experiment ? (
        <InspectorSection
          title="Controlled experiment"
          meta={`${task.experiment.groupId} \u00b7 ${task.experiment.variantId}`}
        >
          <RuntimeRow label="Frozen base" value={task.experiment.frozenBaseSha.slice(0, 12)} mono />
          <RuntimeRow label="Brief hash" value={task.experiment.taskBriefHash.slice(0, 12)} mono />
          <RuntimeRow
            label="Policy snapshot"
            value={`${Object.keys(task.experiment.policyMatrix).length} model-driven roles`}
          />
          <RuntimeRow label="Acceptance" value={`${task.experiment.acceptanceCriteria.length} criteria`} />
          <RuntimeRow
            label="Verification"
            value={`${task.experiment.verificationCommands.length} commands`}
          />
        </InspectorSection>
      ) : null}
      <InspectorSection title="Workflow profile" meta={task.workflowProfile?.source ?? "migration"}>
        <label className="field">
          <span>Selected profile</span>
          <select
            value={task.workflowProfile?.selected ?? "standard"}
            disabled={!canOverrideProfile}
            onChange={(event) => {
              const profile = event.target.value as WorkflowProfileId;
              const reason = window.prompt(
                `Why is ${profile} the correct workflow profile?`,
                `Operator selected ${profile} before implementation.`,
              );
              if (reason !== null) void onProfileChange(profile, reason.trim());
            }}
          >
            <option value="fast">Fast</option>
            <option value="standard">Standard</option>
            <option value="high-risk">High-risk</option>
          </select>
        </label>
        <p>{task.workflowProfile?.reason ?? "Migrated safely to the standard profile."}</p>
        <RuntimeRow
          label="Escalations / overrides"
          value={`${Math.max(0, (task.workflowProfile?.history.length ?? 1) - 1)} recorded`}
        />
        <RuntimeRow
          label="Override boundary"
          value={canOverrideProfile ? "Available before implementation" : "Locked after implementation began"}
        />
        <RuntimeRow
          label="Grill interaction"
          value={
            (task.grillPolicy ?? "manual") === "manual"
              ? "Pause for operator answers"
              : "Automatically accept recommendations"
          }
        />
      </InspectorSection>
      <InspectorSection title="Stage context">
        <RuntimeRow
          label="Viewing"
          value={`${viewedStage.label} \u00b7 ${historical ? "recorded history" : futureStage ? "not yet started" : "current execution"}`}
        />
        <RuntimeRow label="Active" value={workflowStages[currentIndex]?.label ?? "Triage"} />
        <RuntimeRow label="State" value={task.status.replace("-", " ")} />
      </InspectorSection>
      <InspectorSection title="Stage telemetry" meta={viewedStage.label}>
        <RuntimeRow label="Wall time" value={formatDuration(stageWallDuration)} />
        <RuntimeRow
          label="Tokens"
          value={`${formatTokenCount(viewedUsage.input)} input · ${formatTokenCount(viewedUsage.cached)} cached · ${formatTokenCount(viewedUsage.output)} output`}
        />
        <RuntimeRow
          label="Cache rate"
          value={
            viewedUsage.input > 0 ? `${Math.round((viewedUsage.cached / viewedUsage.input) * 100)}%` : "—"
          }
        />
        <RuntimeRow
          label="Work credits"
          value={viewedUsage.credits > 0 ? viewedUsage.credits.toFixed(3) : "Not reported"}
        />
        <RuntimeRow label="API-rate estimate" value={formatApproximateCost(viewedUsage.estimate || null)} />
        <RuntimeRow label="ChatGPT-plan billing" value="Attributable billing unavailable" />
        <RuntimeRow
          label="Focused checks"
          value={`${viewedStageId === "implement" ? focusedExecutions.length : 0} · ${formatDuration(viewedStageId === "implement" ? stageCheckDuration : 0)}`}
        />
        <RuntimeRow
          label="Full manifests"
          value={`${viewedStageId === "test" ? fullManifestExecutions.length : 0} · ${formatDuration(viewedStageId === "test" ? stageCheckDuration : 0)}`}
        />
        <RuntimeRow label="Review retries" value={`${task.reviewRetries?.length ?? 0}`} />
        <RuntimeRow
          label="Candidate repairs"
          value={`${candidate?.revisions.filter((revision) => /repair/i.test(revision.reason)).length ?? 0}`}
        />
      </InspectorSection>
      <InspectorSection title="Task telemetry" meta="All retained runs">
        <RuntimeRow label="Wall time" value={formatDuration(taskWallDuration)} />
        <RuntimeRow
          label="Tokens"
          value={`${formatTokenCount(task.usage.inputTokens)} input · ${formatTokenCount(task.usage.cachedInputTokens)} cached · ${formatTokenCount(task.usage.outputTokens)} output`}
        />
        <RuntimeRow label="Cache rate" value={formatCacheRate(task.usage)} />
        <RuntimeRow
          label="Work credits"
          value={task.usage.credits == null ? "Not reported" : task.usage.credits.toFixed(3)}
        />
        <RuntimeRow label="API-rate estimate" value={formatApproximateCost(task.usage.cost)} />
        <RuntimeRow
          label="Focused checks"
          value={`${focusedExecutions.length} · ${formatDuration(focusedDuration)}`}
        />
        <RuntimeRow
          label="Full manifests"
          value={`${fullManifestExecutions.length} · ${formatDuration(fullManifestDuration)}`}
        />
        <RuntimeRow label="Review retries" value={`${task.reviewRetries?.length ?? 0}`} />
        <RuntimeRow
          label="Candidate repairs"
          value={`${candidate?.revisions.filter((revision) => /repair/i.test(revision.reason)).length ?? 0}`}
        />
        <RuntimeRow label="ChatGPT-plan billing" value="Attributable billing unavailable" />
      </InspectorSection>
      <InspectorSection title="Execution metadata">
        <RuntimeRow label="Skill" value={runtimeStageSkills[task.currentStage]} />
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
        <RuntimeRow
          label="Model / reasoning"
          value={`${activePolicy.model} \u00b7 ${activePolicy.reasoning}`}
        />
        <RuntimeRow
          label={`${stageRunLabel} run`}
          value={`${currentStageRunAttempts} of ${currentStageRunLimit}`}
        />
        <RuntimeRow label="Run" value={task.activeRunKind ?? "No active agent run"} />
        <RuntimeRow label="Repository" value={repoName} mono />
        <RuntimeRow
          label="Authority"
          value={
            task.repositoryAuthority
              ? `${task.repositoryAuthority.source.replaceAll("-", " ")} · ${task.repositoryAuthority.selectedRevision.slice(0, 8)}`
              : "Legacy artifact — revision not recorded"
          }
          mono
        />
        {task.repositoryAuthority ? (
          <RuntimeRow
            label="Target / checked"
            value={`${task.repositoryAuthority.targetRef} · ${new Date(task.repositoryAuthority.capturedAt).toLocaleString()}`}
            mono
          />
        ) : null}
        {task.repositoryAuthority?.checkoutDirty ? (
          <RuntimeRow label="Operator checkout" value="Dirty · excluded from evidence workspace" />
        ) : null}
      </InspectorSection>
      {stageArtifact ? (
        <InspectorSection
          title={
            isModelRunArtifact(stageArtifact)
              ? "Viewed agent run"
              : stageArtifact.stage === "scouts"
                ? "Viewed downstream handoff"
                : "Viewed artifact"
          }
          meta={stageArtifact.name}
        >
          {isModelRunArtifact(stageArtifact) ? (
            <>
              <RuntimeRow label="Model" value={stageArtifact.model ?? "Unknown model"} mono />
              <RuntimeRow label="Reasoning" value={stageArtifact.reasoning ?? "Not recorded"} />
              <RuntimeRow
                label="Input"
                value={`${formatTokenCount(stageArtifact.usage.inputTokens)} total \u00b7 ${formatTokenCount(Math.max(0, stageArtifact.usage.inputTokens - stageArtifact.usage.cachedInputTokens - (stageArtifact.usage.cacheWriteTokens ?? 0)))} uncached`}
              />
              <RuntimeRow label="Output" value={formatTokenCount(stageArtifact.usage.outputTokens)} />
              <RuntimeRow
                label="Cached input"
                value={`${formatCacheRate(stageArtifact.usage)} \u00b7 ${formatTokenCount(stageArtifact.usage.cachedInputTokens)}`}
              />
              <RuntimeRow
                label="Work credits"
                value={
                  stageArtifact.usage.credits == null
                    ? "Not reported for this model"
                    : stageArtifact.usage.credits.toFixed(3)
                }
              />
              <RuntimeRow
                label="Approx. cost"
                value={`${formatApproximateCost(stageArtifact.usage.cost)} \u00b7 API-rate estimate`}
              />
              <RuntimeContextDisclosure artifact={stageArtifact} />
            </>
          ) : stageArtifact.stage === "scouts" ? (
            <ScoutAggregationUsage task={task} artifact={stageArtifact} />
          ) : (
            <RuntimeRow
              label="Origin"
              value="Harness-generated \u2014 no model call, so there is no token usage to report"
            />
          )}
        </InspectorSection>
      ) : null}
      {/* Rendered open and static, not a details/summary accordion \u2014 nothing in
                the right sidebar collapses (see AGENTS.md). */}
      <InspectorSection title="Run safeguards" meta={accessBoundary.kicker}>
        <RuntimeRow label="Access" value="Local OAuth session" />
        <RuntimeRow label="Sandbox" value={accessBoundary.sandbox} />
        <RuntimeRow label="Write boundary" value={accessBoundary.detail} />
        {task.planResult ? (
          <RuntimeRow
            label="Plan revision"
            value={`${task.planResult.repositoryRevision?.slice(0, 8) ?? "unbound"} · ${task.planResult.disposition.replaceAll("-", " ")}`}
            mono
          />
        ) : null}
      </InspectorSection>
      {candidate ? (
        <InspectorSection title="Integration candidate" meta={`${candidate.id} r${candidate.revisionNumber}`}>
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
            onClick={() => onOpenCandidateDiff()}
          >
            {candidateDiffLoading ? "Loading exact diff\u2026" : "Inspect exact diff"}
          </Button>
        </InspectorSection>
      ) : null}
      <InspectorSection title="Decision frontier" meta={`${task.decisions?.length ?? 0} recorded`}>
        <DecisionFrontier
          task={task}
          canRecord={!readOnlyPreview && viewedTemporalState === "current"}
          onDecision={onDecision}
        />
      </InspectorSection>
      <InspectorSection title="Approvals" meta={`${getApprovalHistory(task.approvals).length} recorded`}>
        <ApprovalHistorySection approvals={task.approvals ?? []} />
      </InspectorSection>
      <InspectorSection
        title="Outcome evaluation"
        meta={
          task.evaluation?.scores?.blind?.score
            ? `Blind ${task.evaluation.scores.blind.score} / 5`
            : task.evaluation?.score
              ? `${task.evaluation.score} / 5`
              : "Not rated"
        }
      >
        <TaskEvaluation
          evaluation={task.evaluation}
          disabled={readOnlyPreview || task.status === "running"}
          status={task.status}
          onEvaluate={onEvaluate}
        />
      </InspectorSection>
      <RuntimeRetainedEvidenceSections
        task={task}
        readOnlyPreview={readOnlyPreview}
        initialSelectedWorktreeId={initialSelectedWorktreeId}
        onRemoveWorktree={onRemoveWorktree}
        onLoadMoreArtifacts={onLoadMoreArtifacts}
        onSelectStage={onSelectStage}
        onOpenArtifact={onOpenArtifact}
      />
    </aside>
  );
}

function ScoutAggregationUsage({
  task,
  artifact,
}: {
  task: RuntimeTaskWorkspaceProps["task"];
  artifact: RuntimeArtifact;
}) {
  const usage = resolveScoutUsage(task).aggregate;

  return (
    <>
      <RuntimeRow label="Origin" value="Harness-generated deterministic aggregation; no extra model call" />
      <RuntimeRow label="Inputs" value="Child scout reports" />
      <RuntimeRow label="Child scout runs" value={`${usage.runs} recorded`} />
      <RuntimeRow
        label="Input"
        value={`${formatTokenCount(usage.inputTokens)} total \u00b7 ${formatTokenCount(usage.uncachedInputTokens)} uncached`}
      />
      <RuntimeRow label="Output" value={formatTokenCount(usage.outputTokens)} />
      <RuntimeRow
        label="Cached input"
        value={`${formatTokenCount(usage.cachedInputTokens)} \u00b7 ${usage.cacheRate.toFixed(1)}%`}
      />
      <RuntimeRow
        label="Work credits"
        value={usage.credits == null ? "Unavailable for the recorded providers" : usage.credits.toFixed(3)}
      />
      <RuntimeRow
        label="Approx. cost"
        value={`${formatApproximateCost(usage.cost)} \u00b7 child-run API-rate estimate`}
      />
      <RuntimeContextDisclosure artifact={artifact} />
    </>
  );
}

function formatDuration(durationMs: number) {
  if (!durationMs) return "—";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1_000)}s`;
}

function elapsedWindow(
  records: Array<{ startedAt?: string | null; completedAt?: string | null; durationMs?: number | null }>,
) {
  const starts = records.map((record) => Date.parse(record.startedAt ?? "")).filter(Number.isFinite);
  const ends = records.map((record) => Date.parse(record.completedAt ?? "")).filter(Number.isFinite);
  if (starts.length && ends.length) return Math.max(0, Math.max(...ends) - Math.min(...starts));
  return records.reduce((total, record) => total + (record.durationMs ?? 0), 0);
}

function uniqueVerificationExecutions<
  T extends {
    executionKind?: string;
    candidateId: string;
    candidateRevision: number;
    headRevision?: string;
    startedAt?: string | null;
  },
>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.executionKind,
      item.candidateId,
      item.candidateRevision,
      item.headRevision,
      item.startedAt,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
