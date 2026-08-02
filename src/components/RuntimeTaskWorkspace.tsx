import {
  ArrowLeft,
  ArrowSquareOut,
  Check,
  CheckCircle,
  CircleNotch,
  FileCode,
  Play,
  Robot,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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
import { ApprovalHistorySection, getApprovalHistory } from "./runtimeApprovalHistory.js";

export function RuntimeTaskWorkspace({
  task,
  onBack,
  onRun,
  onCancel,
  onAction,
  onDecision,
  onGrillAnswer,
  onFinishGrill,
  initialViewedStageId,
  initialSelectedWorktreeId,
}: {
  task: RuntimeTask;
  onBack: () => void;
  onRun: () => Promise<void>;
  onCancel: () => Promise<void>;
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
}) {
  const currentIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === task.currentStage),
  );
  const [viewedStageId, setViewedStageId] = useState<StageId>(initialViewedStageId ?? task.currentStage);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(initialSelectedWorktreeId ?? null);
  const [openArtifact, setOpenArtifact] = useState<RuntimeArtifact | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const viewedIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === viewedStageId),
  );
  const viewedStage = workflowStages[viewedIndex];
  if (!viewedStage) throw new Error(`Unknown workflow stage: ${viewedStageId}`);
  const stageArtifact = [...task.artifacts].reverse().find((artifact) => artifact.stage === viewedStageId);
  const focusedTestEvidence = stageArtifact?.focusedTest ?? null;
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
      </header>

      <nav className="stage-navigator" aria-label="Workflow stages">
        {workflowStages.map((stage, index) => {
          const complete = task.completedStages.includes(stage.id);
          const active = stage.id === task.currentStage;
          const selected = stage.id === viewedStageId;
          const failed = active && (task.status === "failed" || task.status === "blocked");
          return (
            <button
              type="button"
              key={stage.id}
              className={`stage-step ${complete ? "stage-step--complete" : ""} ${active ? "stage-step--active" : ""} ${selected ? "stage-step--selected" : ""} ${failed ? "stage-step--failed" : ""}`}
              onClick={() => setViewedStageId(stage.id)}
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
                  {active
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
            <RuntimeCommandBar
              task={task}
              onRun={rerun}
              onCancel={onCancel}
              onAction={onAction}
              onFinishGrill={onFinishGrill}
            />
            {runError ? (
              <div className="runtime-error" role="alert">
                {runError}
              </div>
            ) : null}
            <header className="runtime-stage-heading">
              <p className="eyebrow">{viewedStage.label} · living artifact</p>
              <h2>
                {stageArtifact
                  ? stageArtifact.name
                  : completedApprovalWithoutArtifact
                    ? "Candidate merged successfully"
                    : `${viewedStage.label} is not ready yet`}
              </h2>
              <p>
                {stageArtifact
                  ? "This is the durable handoff produced by the real stage agent. Open it wide or inspect the next artifact without losing task context."
                  : completedApprovalWithoutArtifact
                    ? `${candidate.id} revision ${candidate.revisionNumber} was approved and fast-forwarded to ${candidate.baseBranch}.`
                    : viewedStageStopped
                      ? "This stage stopped before it produced a handoff. Earlier artifacts remain available and the activity panel preserves the failure context."
                      : viewedIndex > currentIndex
                        ? "This stage is downstream of the current execution frontier."
                        : task.status === "running" && viewedStageId === task.currentStage
                          ? "The agent is working on this stage; activity will appear below when the subprocess completes."
                          : "This stage has not started. Its artifact will appear here after the gate runs."}
              </p>
            </header>

            {viewedStageId === "grill" && task.grillSession ? (
              <RuntimeGrillPanel task={task} onAnswer={onGrillAnswer} />
            ) : null}

            {viewedStageId === "implement" && task.workPackages?.length ? (
              <RuntimeWorkPackages task={task} />
            ) : null}

            {stageArtifact ? (
              <article className="runtime-artifact-card">
                <header>
                  <span>
                    <FileCode size={17} />
                    <strong>{stageArtifact.name}</strong>
                  </span>
                  <Button
                    tone="ghost"
                    compact
                    icon={ArrowSquareOut}
                    onClick={() => setOpenArtifact(stageArtifact)}
                  >
                    Open artifact
                  </Button>
                </header>
                {viewedStageId === "test" && focusedTestEvidence ? (
                  <RuntimeFocusedTestEvidencePanel evidence={focusedTestEvidence} candidate={candidate} />
                ) : null}
                <pre>{stageArtifact.content}</pre>
              </article>
            ) : completedApprovalWithoutArtifact ? (
              <div className="runtime-stage-empty">
                <CheckCircle size={22} weight="fill" />
                <strong>
                  {candidate.id} revision {candidate.revisionNumber} merged
                </strong>
                <span>
                  Reviewed commit <span className="mono">{candidate.headRevision?.slice(0, 8)}</span> is now
                  on {candidate.baseBranch}.
                </span>
              </div>
            ) : (
              <div
                className={`runtime-stage-empty ${viewedStageStopped ? "runtime-stage-empty--failed" : ""}`}
              >
                {task.status === "running" && viewedStageId === task.currentStage ? (
                  <CircleNotch className="spin" size={22} />
                ) : viewedStageStopped ? (
                  <WarningCircle size={22} />
                ) : (
                  <FileCode size={22} />
                )}
                <strong>
                  {viewedStageStopped
                    ? "The stage stopped before producing an artifact"
                    : "No artifact for this stage yet"}
                </strong>
                <span>
                  {viewedStageStopped ? task.error : "Completed stages leave inspectable Markdown here."}
                </span>
              </div>
            )}
          </main>

          <aside className="stage-inspector runtime-inspector">
            <InspectorSection title="Task brief">
              <strong>{task.title}</strong>
              <p>{task.description}</p>
            </InspectorSection>
            {worktreeInventory.length ? (
              <InspectorSection title="Worktree inventory" meta={`${worktreeInventory.length} retained`}>
                <RuntimeWorktreeInventory
                  inventory={worktreeInventory}
                  selectedId={selectedWorktreeId}
                  onSelect={setSelectedWorktreeId}
                />
              </InspectorSection>
            ) : null}
            <InspectorSection title="Stage context">
              <RuntimeRow label="Viewing" value={viewedStage.label} />
              <RuntimeRow label="Active" value={workflowStages[currentIndex]?.label ?? "Triage"} />
              <RuntimeRow label="State" value={task.status.replace("-", " ")} />
            </InspectorSection>
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
                    candidate.members?.map((item) => item.packageId).join(" -> ") ||
                    (candidate.status === "merged" ? "Legacy single-session candidate" : "Pending assembly")
                  }
                />
              </InspectorSection>
            ) : null}
            <InspectorSection title="Execution metadata">
              <RuntimeRow
                label="Agent"
                value={
                  task.currentStage === "approval"
                    ? "Human approval gate"
                    : task.currentStage === "implement" && runningPackages.length
                      ? `${runningPackages.map((item) => item.id).join(", ")} implementation agents`
                      : `${workflowStages[currentIndex]?.label ?? "Triage"} agent`
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
              <RuntimeRow label="Model" value={task.models[0]?.model ?? "GPT-5.4-mini · ChatGPT plan"} />
              <RuntimeRow label="Access" value="Local OAuth session" />
              <RuntimeRow label="Sandbox" value={accessBoundary.sandbox} />
              <RuntimeRow label="Repository" value={repoName} mono />
            </InspectorSection>
            <InspectorSection title="Decision frontier" meta={`${task.decisions?.length ?? 0} recorded`}>
              <DecisionFrontier task={task} onDecision={onDecision} />
            </InspectorSection>
            <InspectorSection
              title="Approvals"
              meta={`${getApprovalHistory(task.approvals).length} recorded`}
            >
              <ApprovalHistorySection approvals={task.approvals ?? []} />
            </InspectorSection>
            <InspectorSection title="Living artifacts" meta={`${task.artifacts.length} retained`}>
              <div className="runtime-artifact-list">
                {task.artifacts.length ? (
                  [...task.artifacts].reverse().map((artifact) => (
                    <button
                      type="button"
                      key={artifact.id}
                      onClick={() => {
                        setViewedStageId(artifact.stage);
                        setOpenArtifact(artifact);
                      }}
                    >
                      <FileCode size={15} />
                      <span>
                        <strong>{artifact.name}</strong>
                        <small>{workflowStages.find((stage) => stage.id === artifact.stage)?.label}</small>
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
          <small>Tokens</small>
          <strong className="mono">{formatTokenCount(task.usage.totalTokens)}</strong>
        </span>
        <span>
          <small>Cached input</small>
          <strong className="mono text-green">{formatTokenCount(task.usage.cachedInputTokens)}</strong>
        </span>
        <span>
          <small>Artifacts</small>
          <strong className="mono">{task.artifacts.length}</strong>
        </span>
        <span className="workspace-footer__usage">
          <small>Model usage</small>
          <i className="provider-dot provider-dot--codex" />
          {task.models[0]?.model ?? "GPT-5.4-mini via ChatGPT"}
        </span>
        <span>
          <small>Approx. cost</small>
          <strong className="mono">Plan included</strong>
        </span>
      </footer>

      {openArtifact ? (
        <RuntimeArtifactViewer artifact={openArtifact} onClose={() => setOpenArtifact(null)} />
      ) : null}
    </div>
  );
}

function RuntimeCommandBar({
  task,
  onRun,
  onCancel,
  onAction,
  onFinishGrill,
}: {
  task: RuntimeTask;
  onRun: () => Promise<void>;
  onCancel: () => Promise<void>;
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
  const running = task.status === "running";
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
  return (
    <section
      className={`stage-command-bar stage-command-bar--${running ? "active" : failed || blocked || repairRequired ? "blocked" : ready ? "ready" : "waiting"}`}
    >
      <Icon className={running ? "spin" : ""} size={18} weight="fill" />
      <span className="stage-command-bar__copy">
        <small>{accessBoundary.kicker}</small>
        <strong>
          {running
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
          {running
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
        {running ? (
          <Button tone="danger" compact icon={X} onClick={() => void onCancel()}>
            Cancel run
          </Button>
        ) : null}
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
      label: "Approve & fast-forward merge",
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
      {session.questions.length ? (
        <div className="runtime-grill__questions">
          {session.questions.map((question, index) => (
            <RuntimeGrillQuestionCard
              key={question.id}
              question={question}
              index={index}
              interactive={interactive}
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
                .map((workPackage) => (
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
                          {workPackage.id} · {workPackage.status.replaceAll("_", " ")}
                        </small>
                        <strong>{workPackage.title}</strong>
                      </span>
                    </summary>
                    <p>{workPackage.description}</p>
                    <RuntimeRow label="Depends on" value={workPackage.dependencies.join(", ") || "None"} />
                    <RuntimeRow
                      label="Owned paths"
                      value={workPackage.ownedPaths.join(", ") || "Plan-defined scope"}
                    />
                    <RuntimeRow label="Attempts" value={String(workPackage.attempts)} />
                    {workPackage.headRevision ? (
                      <RuntimeRow label="Package commit" value={workPackage.headRevision.slice(0, 8)} mono />
                    ) : null}
                    {workPackage.error ? <small className="text-red">{workPackage.error}</small> : null}
                  </details>
                ))}
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

function RuntimeFocusedTestEvidencePanel({
  evidence,
  candidate,
}: {
  evidence: RuntimeFocusedTestEvidence;
  candidate: RuntimeTask["candidates"][number] | undefined;
}) {
  return (
    <section className="runtime-focused-test" aria-label="Focused test evidence">
      <header>
        <span>
          <small>Candidate-bound structured evidence</small>
          <strong>
            {evidence.candidateId} r{evidence.candidateRevision}
          </strong>
        </span>
        <span className="mono">{evidence.command}</span>
      </header>
      <div className="runtime-focused-test__rows">
        {evidence.rows.map((row) => (
          <details key={row.id} open={row.status === "failed"}>
            <summary>
              <span>
                <strong>{row.title}</strong>
                <small>
                  {row.status} · {row.durationMs == null ? "n/a" : `${row.durationMs}ms`} · {row.candidateId} r
                  {row.candidateRevision}
                </small>
              </span>
              <span className={`badge badge--${row.status === "failed" ? "red" : "green"}`}>{row.status}</span>
            </summary>
            <div className="test-detail__facts">
              <RuntimeRow label="Command" value={row.command} mono />
              <RuntimeRow label="Candidate" value={`${row.candidateId} r${row.candidateRevision}`} mono />
              <RuntimeRow
                label="Artifact"
                value={
                  row.artifactReferences.map((artifact) => `${artifact.name} · ${artifact.kind}`).join(", ") ||
                  "Markdown test artifact"
                }
              />
              <RuntimeRow
                label="Assertions"
                value={row.assertions.map((assertion) => assertion.label).join(" · ") || "None recorded"}
              />
              {row.failureDetails ? <p className="text-red">{row.failureDetails}</p> : null}
            </div>
          </details>
        ))}
      </div>
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
  onDecision,
}: {
  task: RuntimeTask;
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
      {!task.status.startsWith("running") &&
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
  const visibleEvents = useMemo(() => [...events].reverse().slice(0, 30), [events]);
  return (
    <details className="runtime-activity" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>
          <Robot size={16} />
          <strong>Run activity</strong>
          <small>Scoped subprocess telemetry · {events.length} events</small>
        </span>
        <span>
          <span className="connection-dot" />
          {events.at(-1)?.title ?? "Waiting to start"}
        </span>
      </summary>
      <div className="runtime-activity-list">
        {visibleEvents.map((event) => (
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
        ))}
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
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close artifact viewer">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="artifact-viewer__summary">
          <span>Real agent output · read-only</span>
          <p>Produced by {artifact.model}; retained as the handoff to downstream stages.</p>
          {copyStatus === "copied" ? <small className="text-green">Copied</small> : null}
          {copyError ? <small className="text-red">{copyError}</small> : null}
        </div>
        <pre>{artifact.content}</pre>
        <footer>
          <small>{new Date(artifact.createdAt).toLocaleString()}</small>
          <span className="mono">{formatTokenCount(artifact.usage.totalTokens)} tokens</span>
        </footer>
      </section>
    </div>
  );
}

function toTaskRunState(status: RuntimeTask["status"]): TaskRunState {
  if (status === "queued") return "paused";
  if (status === "cancelled" || status === "blocked") return "blocked";
  if (status === "running" || status === "failed" || status === "completed") return status;
  return "needs-input";
}
