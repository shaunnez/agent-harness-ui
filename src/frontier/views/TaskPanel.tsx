import {
  Binoculars,
  ChartBar,
  Check,
  ClipboardText,
  FolderOpen,
  GearSix,
  NotePencil,
  Robot,
  ShieldCheck,
  SlidersHorizontal,
  WarningCircle,
} from "@phosphor-icons/react";
import { getAccessBoundaryCopy } from "../../components/runtime/runtimeCommandPolicy";
import { type RuntimeCandidate, type RuntimeRun, type StageId, stageIds } from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { FrontierGateway, TaskEvidence } from "../runtime/contracts";
import {
  formatCount,
  formatDuration,
  latestRun,
  modelLabel,
  packageState,
  reasoningLabel,
  stageLabels,
} from "../runtime/presentation";
import { taskWallTime } from "../runtime/usage";
import { stageRecorded, stageState } from "../runtime/workflow";
import { ScrollArea } from "../ui/ScrollArea";
import { CandidateDiff } from "./CandidateDiff";
import { CandidateEvidence, DeliveryEvidence, JourneyEvidence, TestEvidence } from "./CandidateEvidence";
import { DesignReview } from "./DesignReview";
import { StageEvidence } from "./StageEvidence";
import { PinButton } from "./WatchPins";
import { WorkflowCommand } from "./WorkflowCommand";
import { WorkPackages } from "./WorkPackages";

export function TaskPanel({
  evidence,
  initialStage,
  busy,
  error,
  connected,
  gateway,
  command,
  onAction,
  onWatch,
  onArtifact,
  onPolicies,
  onManage,
  onDiff,
  onMore,
  onContinue,
}: {
  evidence: TaskEvidence;
  initialStage?: StageId;
  run?: RuntimeRun;
  busy: boolean;
  error: string | null;
  connected: boolean;
  gateway: FrontierGateway;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
  onAction(): void;
  onWatch(runId?: string): void;
  onArtifact(id: string): void;
  onPolicies(): void;
  onManage(): void;
  onDiff(candidate: RuntimeCandidate): void;
  onMore(kind: "runs" | "activity" | "artifacts"): void;
  onContinue(id: string): void;
}) {
  const task = evidence.core;
  const [selection, selectStage] = usePanelState<StageId | null>(
    `task-stage:${task.id}:${initialStage ?? "current"}`,
    initialStage ?? null,
  );
  const viewedStage = selection && stageRecorded(evidence, selection) ? selection : task.currentStage;
  const [design, setDesign] = usePanelState(`task-design:${task.id}`, false);
  const viewedRun = latestRun(
    evidence.runs.items.filter((item) => item.stage === viewedStage),
    task.activeRunIds,
  );
  const access = getAccessBoundaryCopy(task);
  const policy = task.agentConfig?.stagePolicies?.[viewedStage];
  const highlightedPackage =
    task.workPackages.find((item) => item.status === "failed") ??
    task.workPackages.find((item) => item.status === "running") ??
    task.workPackages.at(-1);
  const packageRun = highlightedPackage
    ? latestRun(
        evidence.runs.items.filter((item) => item.workPackageId === highlightedPackage.id),
        task.activeRunIds,
      )
    : undefined;
  const activeRun = latestRun(
    evidence.runs.items.filter((item) => item.stage === task.currentStage),
    task.activeRunIds,
  );
  const watchRun = task.currentStage === "implement" ? (packageRun ?? activeRun) : activeRun;
  const candidate = task.candidates.at(-1);
  const repositoryName = task.repositoryPath.split("/").filter(Boolean).at(-1) ?? "Repository";
  return (
    <div className="overlay-body task-layout task-layout-top">
      <header className="task-workspace-header">
        <div>
          <small>
            Agent Harness / {repositoryName} / {task.id}
          </small>
          <h2>{task.title}</h2>
        </div>
        <div className="task-workspace-actions">
          {viewedStage !== task.currentStage && (
            <button type="button" onClick={() => selectStage(null)}>
              Current stage
            </button>
          )}
          <button type="button" onClick={onPolicies}>
            <SlidersHorizontal size={17} />
            Role policies
          </button>
          <button type="button" onClick={onManage}>
            <GearSix size={17} />
            Manage
          </button>
          <PinButton taskId={task.id} />
        </div>
      </header>
      <nav className="stage-navigation" aria-label="Task stages">
        {stageIds.map((stage, index) => {
          const state = stageRecorded(evidence, stage) ? stageState(task, stage) : "Not started";
          const stale = /Rerun/.test(state);
          const completed = task.completedStages.includes(stage) && !stale;
          return (
            <button
              type="button"
              key={stage}
              className={`${stage === viewedStage && !design ? "selected" : ""} ${
                completed ? "completed" : ""
              }`}
              title={`${stageLabels[stage]} · ${state}${stage === task.currentStage ? " · Active stage" : ""}`}
              data-stale={stale || undefined}
              disabled={!stageRecorded(evidence, stage)}
              aria-current={stage === viewedStage && !design ? "step" : undefined}
              onClick={() => {
                selectStage(stage);
                setDesign(false);
              }}
            >
              <span className="stage-number">
                {stale ? (
                  <WarningCircle size={16} aria-label="Rerun required" />
                ) : completed ? (
                  <Check size={14} weight="bold" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <span>
                {stageLabels[stage]}
                <small>{stageRecorded(evidence, stage) ? stageState(task, stage) : "Not started"}</small>
              </span>
            </button>
          );
        })}
        {task.designRequest?.requested && (
          <button type="button" className={design ? "selected" : ""} onClick={() => setDesign(true)}>
            Design directions<small>{task.designRequest.status}</small>
          </button>
        )}
      </nav>
      <div className="task-command-region">
        <WorkflowCommand
          key={task.id}
          task={task}
          gateway={gateway}
          busy={busy}
          connected={connected}
          command={command}
          onGrill={onAction}
          onContinue={onContinue}
          onWatch={watchRun ? () => onWatch(watchRun.id) : undefined}
          watchLabel={
            task.currentStage === "implement" && packageRun
              ? `Watch ${highlightedPackage?.id} worker`
              : "Inspect active run"
          }
        />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
      <section className="task-main">
        <ScrollArea
          key={viewedStage}
          className="task-stage-content"
          label={`${stageLabels[viewedStage]} stage content`}
        >
          {viewedStage !== task.currentStage && (
            <p className="history-notice">
              Viewing recorded {stageLabels[viewedStage]} evidence. Current work remains at{" "}
              {stageLabels[task.currentStage]}.
            </p>
          )}
          {design ? (
            <DesignReview task={task} gateway={gateway} busy={busy} connected={connected} command={command} />
          ) : (
            <>
              {task.designRequest?.requested &&
                ["generating-designs", "awaiting-design-selection"].includes(task.status) &&
                viewedStage === task.currentStage && (
                  <button type="button" className="primary" onClick={() => setDesign(true)}>
                    Open design review
                  </button>
                )}
              {viewedStage === "implement" && highlightedPackage && (
                <section
                  className="implementation-workshop"
                  aria-label="Implementation workshop illustration"
                >
                  <img
                    src="/assets/mf.task-workspace.workshop.r1.png"
                    alt="Robot working at a blue holographic console in a science-fiction workshop"
                  />
                  <span className="workshop-label">Concept illustration</span>
                  <div className="workshop-caption">
                    <img src="/assets/mf.worker.standard.portrait.r1.png" alt="Implementation worker" />
                    <span>
                      <strong>
                        {highlightedPackage.id} · {highlightedPackage.title}
                      </strong>
                      <small>
                        {packageRun
                          ? `${modelLabel(packageRun.model)} · ${reasoningLabel(packageRun.reasoning)} · implementation role`
                          : "Implementation role · no run loaded"}
                      </small>
                    </span>
                    <em>{packageState(highlightedPackage, task.workPackages)}</em>
                  </div>
                </section>
              )}
              {["plan", "implement"].includes(viewedStage) && (
                <WorkPackages
                  key={`packages:${task.id}:${viewedStage}`}
                  taskId={task.id}
                  stage={viewedStage}
                  packages={task.workPackages}
                  runs={evidence.runs.items}
                  onWatch={onWatch}
                />
              )}
              {viewedStage === "approval" && <DeliveryEvidence task={task} />}
              {["final-review", "approval"].includes(viewedStage) && (
                <JourneyEvidence evidence={evidence} onStage={selectStage} />
              )}
              {["implement", "dev-review", "test", "final-review", "approval"].includes(viewedStage) && (
                <CandidateEvidence task={task} onDiff={onDiff} compact={viewedStage !== "implement"} />
              )}
              {viewedStage === "implement" && candidate?.headRevision && (
                <section
                  className="workflow-card inline-candidate-diff"
                  aria-label="Inline exact candidate diff"
                >
                  <CandidateDiff
                    gateway={gateway}
                    taskId={task.id}
                    candidateId={candidate.id}
                    revision={candidate.revisionNumber}
                    headRevision={candidate.headRevision}
                    embedded
                  />
                </section>
              )}
              {viewedStage === "test" && <TestEvidence evidence={evidence} />}
              {viewedStage === "grill" && (
                <div className="workflow-card">
                  <h3>Decision room</h3>
                  <p>
                    {task.grillSession?.questions.filter((item) => !item.answer).length ?? 0} unanswered ·
                    Policy: {task.grillPolicy ?? "manual"}
                  </p>
                  <button type="button" onClick={onAction}>
                    Open questions & answers
                  </button>
                </div>
              )}
              <StageEvidence
                key={`${task.id}:${viewedStage}`}
                evidence={evidence}
                stage={viewedStage}
                gateway={gateway}
                onArtifact={onArtifact}
                onWatch={onWatch}
                onMore={onMore}
              />
            </>
          )}
        </ScrollArea>
      </section>
      <ScrollArea className="task-brief" label="Task inspector">
        <section className="task-brief-summary">
          <h3>
            <ClipboardText size={18} />
            Task brief
          </h3>
          <p>{task.description}</p>
        </section>
        <section>
          <h3>
            <Robot size={18} />
            Role & run
          </h3>
          <div className="inspector-worker">
            <img src="/assets/mf.worker.standard.portrait.r1.png" alt="Worker role" />
            <span>
              <strong>
                {viewedRun
                  ? `${modelLabel(viewedRun.model)} · ${reasoningLabel(viewedRun.reasoning)}`
                  : policy
                    ? `${modelLabel(policy.model)} · ${reasoningLabel(policy.reasoning)}`
                    : "Operator"}
              </strong>
              <small>
                {viewedRun?.status ?? (policy ? "Policy snapshot; no run loaded" : "Deterministic gate")}
              </small>
            </span>
          </div>
          <small>
            Viewed: {stageLabels[viewedStage]}
            <br />
            Active: {stageLabels[task.currentStage]}
          </small>
          {viewedRun && (
            <button type="button" onClick={() => onWatch(viewedRun.id)}>
              <Binoculars size={18} />
              Watch agent
            </button>
          )}
        </section>
        <section>
          <h3>
            <ChartBar size={18} />
            Usage <small>· task total</small>
          </h3>
          <p className="inspector-metric">
            {formatCount(task.usage.totalTokens)} <small>tokens</small>
          </p>
          <small>
            Input {formatCount(task.usage.inputTokens)} · Output {formatCount(task.usage.outputTokens)}
            <br />
            Cached {formatCount(task.usage.cachedInputTokens)} ·{" "}
            {task.usage.inputTokens
              ? `${Math.round((task.usage.cachedInputTokens / task.usage.inputTokens) * 100)}% cache rate`
              : "Cache rate unavailable"}
          </small>
          <dl className="inspector-key-values">
            <dt>Elapsed</dt>
            <dd>{formatDuration(taskWallTime(task, Date.now()))}</dd>
            <dt>Approx. cost</dt>
            <dd>
              {task.usage.cost != null && task.usage.pricingVersion
                ? `$${task.usage.cost.toFixed(4)}`
                : "Unavailable"}
            </dd>
          </dl>
          <small>
            {task.usage.pricingVersion
              ? `API-rate estimate · ${task.usage.pricingVersion}`
              : "API-rate estimate needs a rate card."}
          </small>
        </section>
        <section>
          <h3>
            <ShieldCheck size={18} />
            Run safeguards
          </h3>
          <p>{access.sandbox}</p>
          <small>{access.detail}</small>
          <p>
            Stage attempts: {task.attemptsByStage[viewedStage] ?? 0} /{" "}
            {task.stageRunLimits?.[viewedStage] ?? task.stageRunLimit}
          </p>
        </section>
        <section>
          <h3>
            <FolderOpen size={18} />
            Context & repository
          </h3>
          <p className="repository-path">{task.repositoryPath}</p>
          <small>
            {task.repositoryAuthority?.selectedRevision
              ? `Captured revision ${task.repositoryAuthority.selectedRevision.slice(0, 12)}`
              : "Repository revision not recorded"}
          </small>
          <p className="quiet">
            Open each artifact to inspect its supplied-context manifest. Repository permission alone does not
            prove what an agent used.
          </p>
          {task.attachments?.map((attachment) => (
            <p key={attachment.id}>
              {attachment.name} · {attachment.size} bytes
            </p>
          ))}
        </section>
        {task.decisions.length > 0 && (
          <section className="inspector-decisions">
            <h3>
              <NotePencil size={18} />
              Recorded decisions
            </h3>
            {task.decisions.map((decision) => (
              <p key={decision.id}>
                <strong>{decision.question}</strong>
                <br />
                {decision.answer}
              </p>
            ))}
          </section>
        )}
        {(task.artifactNextCursor || evidence.runs.nextCursor) && (
          <section>
            <h3>More evidence</h3>
            {task.artifactNextCursor && (
              <button type="button" onClick={() => onMore("artifacts")}>
                Load earlier artifacts
              </button>
            )}
            {evidence.runs.nextCursor && (
              <button type="button" onClick={() => onMore("runs")}>
                Load earlier runs
              </button>
            )}
          </section>
        )}
      </ScrollArea>
    </div>
  );
}
