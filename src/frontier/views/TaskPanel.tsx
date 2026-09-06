import { Binoculars, CheckCircle, Robot } from "@phosphor-icons/react";
import { getAccessBoundaryCopy } from "../../components/runtime/runtimeCommandPolicy";
import { type RuntimeCandidate, type RuntimeRun, type StageId, stageIds } from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { FrontierGateway, TaskEvidence } from "../runtime/contracts";
import { formatCount, modelLabel, reasoningLabel, stageLabels } from "../runtime/presentation";
import { stageRecorded, stageState } from "../runtime/workflow";
import { CandidateEvidence, DeliveryEvidence, JourneyEvidence, TestEvidence } from "./CandidateEvidence";
import { DesignReview } from "./DesignReview";
import { StageEvidence } from "./StageEvidence";
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
  const viewedRun = evidence.runs.items.find((item) => item.stage === viewedStage);
  const access = getAccessBoundaryCopy(task);
  const policy = task.agentConfig?.stagePolicies?.[viewedStage];
  return (
    <div className="overlay-body task-layout">
      <nav className="stage-navigation" aria-label="Task stages">
        {stageIds.map((stage, index) => (
          <button
            type="button"
            key={stage}
            className={stage === viewedStage && !design ? "selected" : ""}
            disabled={!stageRecorded(evidence, stage)}
            onClick={() => {
              selectStage(stage);
              setDesign(false);
            }}
          >
            <span className="stage-number">{index + 1}</span>
            <span>
              {stageLabels[stage]}
              <small>{stageRecorded(evidence, stage) ? stageState(task, stage) : "Not started"}</small>
            </span>
            {task.completedStages.includes(stage) && !/Rerun/.test(stageState(task, stage)) && (
              <CheckCircle size={17} />
            )}
          </button>
        ))}
        {task.designRequest?.requested && (
          <button type="button" className={design ? "selected" : ""} onClick={() => setDesign(true)}>
            Design directions<small>{task.designRequest.status}</small>
          </button>
        )}
      </nav>
      <section className="task-main">
        <div className="task-fixed-actions">
          <div className="task-utility-bar">
            <button type="button" onClick={onPolicies}>
              Role policies
            </button>
            <button type="button" onClick={onManage}>
              Manage task
            </button>
          </div>
          <WorkflowCommand
            key={task.id}
            task={task}
            gateway={gateway}
            busy={busy}
            connected={connected}
            command={command}
            onGrill={onAction}
            onContinue={onContinue}
          />
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
        <div className="task-stage-content">
          <div className="task-command-bar">
            <h2>{design ? "Design review" : stageLabels[viewedStage]}</h2>
            {viewedStage !== task.currentStage && (
              <button type="button" onClick={() => selectStage(null)}>
                Return to current stage
              </button>
            )}
          </div>
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
              {["plan", "implement"].includes(viewedStage) && (
                <WorkPackages packages={task.workPackages} runs={evidence.runs.items} onWatch={onWatch} />
              )}
              {viewedStage === "approval" && <DeliveryEvidence task={task} />}
              {["final-review", "approval"].includes(viewedStage) && (
                <JourneyEvidence evidence={evidence} onStage={selectStage} />
              )}
              {["implement", "dev-review", "test", "final-review", "approval"].includes(viewedStage) && (
                <CandidateEvidence task={task} onDiff={onDiff} compact={viewedStage !== "implement"} />
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
        </div>
      </section>
      <aside className="task-brief">
        <small>Task brief</small>
        <h2>{task.id}</h2>
        <h3>{task.title}</h3>
        <p>{task.description}</p>
        <small>
          Viewed: {stageLabels[viewedStage]} · Active: {stageLabels[task.currentStage]}
        </small>
        <section>
          <h3>
            <Robot size={18} />
            Role & worker
          </h3>
          <p>
            {viewedRun
              ? `${modelLabel(viewedRun.model)} · ${reasoningLabel(viewedRun.reasoning)} · ${viewedRun.status}`
              : policy
                ? `${modelLabel(policy.model)} · ${reasoningLabel(policy.reasoning)} · policy snapshot; no run loaded`
                : "Operator / deterministic gate"}
          </p>
          {viewedRun && (
            <button type="button" onClick={() => onWatch(viewedRun.id)}>
              <Binoculars size={18} />
              Watch agent
            </button>
          )}
        </section>
        <section>
          <h3>Usage</h3>
          <p>{formatCount(task.usage.totalTokens)} tokens</p>
          <small>
            Input {formatCount(task.usage.inputTokens)} · Output {formatCount(task.usage.outputTokens)}
            <br />
            Cached {formatCount(task.usage.cachedInputTokens)} ·{" "}
            {task.usage.inputTokens
              ? `${Math.round((task.usage.cachedInputTokens / task.usage.inputTokens) * 100)}% cache rate`
              : "Cache rate unavailable"}
          </small>
          <p className="quiet">
            Approx. cost{" "}
            {task.usage.cost != null && task.usage.pricingVersion
              ? `$${task.usage.cost.toFixed(4)} · API-rate estimate · ${task.usage.pricingVersion}`
              : "— unavailable"}
          </p>
        </section>
        <section>
          <h3>Run safeguards</h3>
          <p>{access.sandbox}</p>
          <small>{access.detail}</small>
          <p>
            Stage attempts: {task.attemptsByStage[viewedStage] ?? 0} /{" "}
            {task.stageRunLimits?.[viewedStage] ?? task.stageRunLimit}
          </p>
        </section>
        <section>
          <h3>Context & repository</h3>
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
      </aside>
    </div>
  );
}
