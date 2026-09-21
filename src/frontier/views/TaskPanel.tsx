import {
  Binoculars,
  Check,
  ClipboardText,
  FileText,
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
import { latestRun, modelLabel, packageState, reasoningLabel, stageLabels } from "../runtime/presentation";
import { stageHasError, stageRecorded, stageState } from "../runtime/workflow";
import { ScrollArea } from "../ui/ScrollArea";
import { CandidateDiff } from "./CandidateDiff";
import { CandidateEvidence } from "./CandidateEvidence";
import { CandidateHistory, CandidateIdentity, CandidateReadiness } from "./CandidateReadiness";
import { DeliveryEvidence } from "./DeliveryEvidence";
import { DesignReview } from "./DesignReview";
import { Grill, GrillActions, GrillDecisions, type GrillProps } from "./Grill";
import { JourneyEvidence } from "./JourneyEvidence";
import { StageEvidence } from "./StageEvidence";
import { StageSummary } from "./StageSummary";
import { TaskUsage } from "./TaskUsage";
import { TestEvidence } from "./TestEvidence";
import { PinButton } from "./WatchPins";
import { WorkflowCommand } from "./WorkflowCommand";
import { WorkPackages } from "./WorkPackages";

export function TaskPanel({
  evidence,
  grill,
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
  grill: Pick<GrillProps, "answers" | "onDraft" | "onAnswer" | "onFinish">;
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
  const retainedArtifact = task.artifacts.filter((item) => item.stage === viewedStage).at(-1);
  const artifactAction = retainedArtifact ? (
    <button type="button" onClick={() => onArtifact(retainedArtifact.id)}>
      <FileText size={17} /> Open retained artifact
    </button>
  ) : null;
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
            <button
              type="button"
              onClick={() => {
                selectStage(null);
                setDesign(false);
              }}
            >
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
          {task.designRequest?.requested && (
            <button type="button" aria-pressed={design} onClick={() => setDesign(!design)}>
              Design directions
            </button>
          )}
          <PinButton taskId={task.id} />
        </div>
      </header>
      <nav className="stage-navigation" aria-label="Task stages">
        {stageIds.map((stage, index) => {
          const state = stageRecorded(evidence, stage) ? stageState(task, stage) : "Not started";
          const stale = /Rerun/.test(state);
          const failed = stageHasError(evidence, stage);
          const completed = task.completedStages.includes(stage) && !stale && !failed;
          return (
            <button
              type="button"
              key={stage}
              className={`${stage === viewedStage && !design ? "selected" : ""} ${
                completed ? "completed" : ""
              }`}
              title={`${stageLabels[stage]} · ${state}${stage === task.currentStage ? " · Active stage" : ""}`}
              data-stale={stale || undefined}
              data-error={failed || undefined}
              disabled={!stageRecorded(evidence, stage)}
              aria-current={stage === viewedStage && !design ? "step" : undefined}
              onClick={() => {
                selectStage(stage);
                setDesign(false);
              }}
            >
              <span className="stage-number">
                {stale || failed ? (
                  <WarningCircle size={16} aria-label={stale ? "Rerun required" : "Stage error"} />
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
      </nav>
      <div className="task-command-region">
        {design || viewedStage !== task.currentStage ? (
          <section className="workflow-command" aria-label="Viewed stage actions">
            <div className="workflow-command-row">
              <span className="workflow-command-copy">
                <span className="workflow-command-title">
                  <strong>{design ? "Design review" : stageLabels[viewedStage]}</strong>
                  <em>{design ? "Directions" : stageState(task, viewedStage)}</em>
                </span>
                <small>
                  {design
                    ? "Compare the retained design directions."
                    : `Retained ${stageLabels[viewedStage]} evidence`}
                </small>
              </span>
              {!design && artifactAction}
            </div>
          </section>
        ) : viewedStage === "grill" &&
          task.currentStage === "grill" &&
          task.status === "awaiting-grill" &&
          !design ? (
          <section className="workflow-command tone-answer" aria-label="Current task actions">
            <div className="workflow-command-row">
              <span className="workflow-command-copy">
                <span className="workflow-command-title">
                  <strong>Grill</strong>
                  <em>
                    {task.grillSession?.questions.some((item) => !item.answer)
                      ? "Needs your answer"
                      : "Ready to continue"}
                  </em>
                </span>
                <small>Review the evidence and record your decision.</small>
              </span>
              <GrillActions task={task} busy={busy} connected={connected} {...grill} />
            </div>
          </section>
        ) : (
          <WorkflowCommand
            key={task.id}
            task={task}
            gateway={gateway}
            busy={busy}
            connected={connected}
            command={command}
            onGrill={onAction}
            onContinue={onContinue}
            hideGrillAction
            retainedArtifactAction={artifactAction}
          />
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
      <section className={`task-main${design ? " workspace-design-scroll" : ""}`}>
        <ScrollArea
          key={design ? "design" : viewedStage}
          className="task-stage-content"
          label={design ? "Design review content" : `${stageLabels[viewedStage]} stage content`}
        >
          {!design && viewedStage !== task.currentStage && (
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
                <section className="implementation-workshop" aria-label="Implementation worker">
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
              {["test", "final-review", "approval"].includes(viewedStage) &&
                !(viewedStage === "approval" && task.pullRequestIntent) && (
                  <StageSummary task={task} stage={viewedStage} run={viewedRun} />
                )}
              {["test", "final-review", "approval"].includes(viewedStage) &&
                !(viewedStage === "approval" && task.pullRequestIntent) && (
                  <CandidateIdentity task={task} onDiff={onDiff} />
                )}
              {viewedStage === "approval" && (
                <div className={task.pullRequestIntent ? "delivery-stack" : "approval-evidence-grid"}>
                  <DeliveryEvidence task={task} onDiff={onDiff} />
                  <CandidateReadiness task={task} />
                </div>
              )}
              {["final-review", "approval"].includes(viewedStage) && (
                <>
                  {viewedStage === "final-review" && <CandidateReadiness task={task} />}
                  <JourneyEvidence
                    evidence={evidence}
                    stage={viewedStage as "final-review" | "approval"}
                    onStage={selectStage}
                  />
                </>
              )}
              {viewedStage === "implement" && <CandidateEvidence task={task} onDiff={onDiff} />}
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
                <Grill
                  task={task}
                  busy={busy}
                  error={null}
                  connected={connected}
                  onArtifact={onArtifact}
                  {...grill}
                  run={viewedRun}
                  embedded
                />
              )}
              <StageEvidence
                key={`${task.id}:${viewedStage}`}
                evidence={evidence}
                stage={viewedStage}
                gateway={gateway}
                onArtifact={onArtifact}
                onWatch={onWatch}
                onMore={onMore}
                reviewIdentity={
                  viewedStage === "dev-review" ? <CandidateIdentity task={task} onDiff={onDiff} /> : undefined
                }
                footer={
                  ["dev-review", "test", "final-review", "approval"].includes(viewedStage) ? (
                    <CandidateHistory task={task} onDiff={onDiff} />
                  ) : undefined
                }
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
            Viewed: {design ? "Design review" : stageLabels[viewedStage]}
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
        <TaskUsage evidence={evidence} stage={viewedStage} onMore={() => onMore("runs")} />
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
        {viewedStage === "grill" && <GrillDecisions task={task} />}
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
