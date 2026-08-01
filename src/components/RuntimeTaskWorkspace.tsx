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
import { useMemo, useState } from "react";
import {
  formatTokenCount,
  type RuntimeArtifact,
  type RuntimeEvent,
  type RuntimeTask,
  type StageId,
  type TaskRunState,
  workflowStages,
} from "../domain";
import { Button, PriorityBadge, StateBadge } from "./Primitives";

export function RuntimeTaskWorkspace({
  task,
  onBack,
  onRun,
  onCancel,
  onAction,
  onDecision,
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
      | "approve-merge",
    note?: string,
  ) => Promise<void>;
  onDecision: (question: string, answer: string) => Promise<void>;
}) {
  const currentIndex = Math.max(
    0,
    workflowStages.findIndex((stage) => stage.id === task.currentStage),
  );
  const [viewedStageId, setViewedStageId] = useState<StageId>(task.currentStage);
  const [openArtifact, setOpenArtifact] = useState<RuntimeArtifact | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
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
            <RuntimeCommandBar task={task} onRun={rerun} onCancel={onCancel} onAction={onAction} />
            {runError ? (
              <div className="runtime-error" role="alert">
                {runError}
              </div>
            ) : null}
            <header className="runtime-stage-heading">
              <p className="eyebrow">{viewedStage.label} · living artifact</p>
              <h2>{stageArtifact ? stageArtifact.name : `${viewedStage.label} is not ready yet`}</h2>
              <p>
                {stageArtifact
                  ? "This is the durable handoff produced by the real stage agent. Open it wide or inspect the next artifact without losing task context."
                  : viewedStageStopped
                    ? "This stage stopped before it produced a handoff. Earlier artifacts remain available and the activity panel preserves the failure context."
                    : viewedIndex > currentIndex
                      ? "This stage is downstream of the current execution frontier."
                      : task.status === "running" && viewedStageId === task.currentStage
                        ? "The agent is working on this stage; activity will appear below when the subprocess completes."
                        : "This stage has not started. Its artifact will appear here after the gate runs."}
              </p>
            </header>

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
                <pre>{stageArtifact.content}</pre>
              </article>
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
              </InspectorSection>
            ) : null}
            <InspectorSection title="Execution metadata">
              <RuntimeRow label="Agent" value={`${viewedStage.label} agent`} />
              <RuntimeRow label="Model" value={task.models[0]?.model ?? "GPT-5.4-mini · ChatGPT plan"} />
              <RuntimeRow label="Access" value="Local OAuth session" />
              <RuntimeRow
                label="Sandbox"
                value={viewedStageId === "implement" ? "Isolated worktree" : "Read-only"}
              />
              <RuntimeRow label="Repository" value={repoName} mono />
            </InspectorSection>
            <InspectorSection title="Decision frontier" meta={`${task.decisions?.length ?? 0} recorded`}>
              <DecisionFrontier task={task} onDecision={onDecision} />
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
      | "approve-merge",
  ) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const running = task.status === "running";
  const currentAttempts = task.attemptsByStage?.[task.currentStage] ?? 0;
  const blocked =
    task.status === "blocked" ||
    (currentAttempts >= task.stageRunLimit && (task.status === "failed" || task.status === "cancelled"));
  const failed = !blocked && (task.status === "failed" || task.status === "cancelled");
  const ready =
    task.status.startsWith("awaiting-") ||
    task.status.startsWith("ready-for-") ||
    task.status === "completed";
  const next = nextAction(task);
  const Icon = running ? CircleNotch : failed || blocked ? WarningCircle : CheckCircle;
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
  return (
    <section
      className={`stage-command-bar stage-command-bar--${running ? "active" : failed || blocked ? "blocked" : ready ? "ready" : "waiting"}`}
    >
      <Icon className={running ? "spin" : ""} size={18} weight="fill" />
      <span className="stage-command-bar__copy">
        <small>
          {running
            ? "Agent active"
            : blocked
              ? "Blocked"
              : failed
                ? "Action required"
                : ready
                  ? "Next step"
                  : "Ready"}
        </small>
        <strong>
          {running
            ? `${workflowStages.find((stage) => stage.id === task.currentStage)?.label} is running`
            : blocked
              ? "Repair allowance exhausted"
              : failed
                ? "Retry the failed stage"
                : ready
                  ? (next?.title ?? "Workflow gate ready")
                  : "Start the read-only investigation"}
        </strong>
        <span>
          {running
            ? "Codex is inspecting the selected repository in a read-only sandbox."
            : blocked
              ? "Review the retained activity, revise the task, or grant a human override in a future slice."
              : failed
                ? task.error
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
        {(ready || failed) && next?.action ? (
          <Button tone="primary" compact icon={Play} disabled={pending} onClick={() => void invoke()}>
            {pending ? "Starting..." : next.label}
          </Button>
        ) : null}
      </div>
      {actionError ? <span className="runtime-command-error">{actionError}</span> : null}
    </section>
  );
}

function nextAction(task: RuntimeTask) {
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

function RuntimeArtifactViewer({ artifact, onClose }: { artifact: RuntimeArtifact; onClose: () => void }) {
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
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close artifact viewer">
            <X size={18} />
          </button>
        </header>
        <div className="artifact-viewer__summary">
          <span>Real agent output · read-only</span>
          <p>Produced by {artifact.model}; retained as the handoff to downstream stages.</p>
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
