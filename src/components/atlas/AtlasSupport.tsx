import {
  ArrowRight,
  ArrowSquareOut,
  CheckCircle,
  GitBranch,
  HourglassMedium,
  Hammer,
  Robot,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import cargoCrate from "../../assets/atlas/cargo-crate.png";
import courierPod from "../../assets/atlas/courier-pod.png";
import workerDrone from "../../assets/atlas/worker-drone.png";
import { type RuntimeTaskSummary, type StageId, workflowStages } from "../../domain";
import { getEffectiveStageRunAttempts, getEffectiveStageRunLimit } from "../../runtime-stage-limits";
import { Button, PriorityBadge } from "../Primitives";
import {
  candidateGateStages,
  getRuntimeFreshnessLabel,
  isStageComplete,
  isStageRunning,
} from "../runtime/workflow";
import {
  formatAtlasTime,
  getAtlasStatusLabel,
  getAtlasTaskTone,
  getPackageOverview,
  getStageRoom,
  getTaskColor,
} from "./atlasModel";

export function AtlasLegend({
  tasks,
  selectedTaskId,
}: {
  tasks: RuntimeTaskSummary[];
  selectedTaskId: string | null;
}) {
  const routeTasks = [...tasks]
    .sort((left, right) => Number(right.id === selectedTaskId) - Number(left.id === selectedTaskId))
    .slice(0, 4);
  return (
    <fieldset className="atlas-legend">
      <legend>Legend</legend>
      <div className="atlas-legend__objects">
        <span>
          <img className="atlas-legend__object-art" src={courierPod} alt="" />
          <small>
            <strong>Courier pod</strong>Task
          </small>
        </span>
        <span>
          <img className="atlas-legend__object-art" src={workerDrone} alt="" />
          <small>
            <strong>Signal core</strong>Active agent
          </small>
        </span>
        <span>
          <img className="atlas-legend__object-art" src={cargoCrate} alt="" />
          <small>
            <strong>Cargo crate</strong>Persisted handoff
          </small>
        </span>
      </div>
      <div className="atlas-legend__routes">
        {routeTasks.map((task) => (
          <span key={task.id}>
            <i style={{ background: getTaskColor(task.id) }} />
            {task.id} route
          </span>
        ))}
        <span>
          <i className="atlas-legend__future" />
          Future route
        </span>
      </div>
      <div className="atlas-legend__states">
        <span className="atlas-legend__state atlas-legend__state--running">
          <Robot size={17} weight="fill" />
          <span>
            <strong>Running</strong>
            <small>Agent working</small>
          </span>
        </span>
        <span className="atlas-legend__state atlas-legend__state--attention">
          <HourglassMedium size={17} weight="fill" />
          <span>
            <strong>Needs input</strong>
            <small>Waiting for human</small>
          </span>
        </span>
        <span className="atlas-legend__state atlas-legend__state--complete">
          <CheckCircle size={17} weight="fill" />
          <span>
            <strong>Completed</strong>
            <small>Evidence retained</small>
          </span>
        </span>
        <span className="atlas-legend__state atlas-legend__state--blocked">
          <WarningCircle size={17} weight="fill" />
          <span>
            <strong>Blocked / repair</strong>
            <small>Action required</small>
          </span>
        </span>
      </div>
    </fieldset>
  );
}

export function RecentHandoffs({
  tasks,
  onOpenTask,
  onViewAll,
  readOnly = false,
}: {
  tasks: RuntimeTaskSummary[];
  onOpenTask: (taskId: string, stageId?: StageId) => void;
  onViewAll?: () => void;
  readOnly?: boolean;
}) {
  const handoffs = buildRecentHandoffs(tasks).slice(0, 5);
  return (
    <section className="atlas-handoffs">
      <header>
        <div>
          <p className="eyebrow">Persisted cargo</p>
          <h2>Recent handoffs</h2>
        </div>
        {onViewAll ? (
          <button type="button" onClick={onViewAll}>
            View all <ArrowRight size={14} />
          </button>
        ) : null}
      </header>
      {handoffs.length ? (
        <div className="atlas-handoffs__list">
          {handoffs.map((handoff) => (
            <button
              type="button"
              key={handoff.key}
              onClick={() => onOpenTask(handoff.taskId, handoff.to)}
              disabled={readOnly}
              title={readOnly ? "Task workspaces are unavailable in the hosted UI preview" : undefined}
            >
              <time>{formatAtlasTime(handoff.at)}</time>
              <span>
                <img className="atlas-handoff__crate" src={cargoCrate} alt="" />
                <strong className="mono">{handoff.taskId}</strong>
              </span>
              <small>
                {stageName(handoff.from)} → {stageName(handoff.to)}
              </small>
              <em>{handoff.artifact}</em>
            </button>
          ))}
        </div>
      ) : (
        <p className="atlas-handoffs__empty">No cross-stage artifact handoff has been persisted yet.</p>
      )}
    </section>
  );
}

export function TaskAtlasInspector({
  task,
  onOpenTask,
  onOpenWorkbench,
  onClose,
  readOnly = false,
  previewing = false,
}: {
  task: RuntimeTaskSummary;
  onOpenTask: (taskId: string, stageId?: StageId) => void;
  onOpenWorkbench: () => void;
  onClose: () => void;
  readOnly?: boolean;
  previewing?: boolean;
}) {
  const room = getStageRoom(task.currentStage);
  const tone = getAtlasTaskTone(task);
  const candidate = task.candidates.at(-1);
  const packageOverview = getPackageOverview(task.workPackages);
  const currentArtifact = [...task.artifacts]
    .reverse()
    .find((artifact) => artifact.stage === task.currentStage);
  const latestArtifact = task.artifacts.at(-1);
  const freshGates = candidateGateStages.filter((stageId) => isStageComplete(task, stageId)).length;
  const blockedPackage = task.workPackages.find((item) => item.status === "failed");
  const inspectorAction = getInspectorAction(task, tone);

  return (
    <aside className="atlas-inspector" aria-label={`Selected task ${task.id}`}>
      <header>
        <span className="atlas-inspector__identity">
          <i style={{ background: getTaskColor(task.id) }} aria-hidden />
          <strong className="mono">{task.id}</strong>
        </span>
        <PriorityBadge priority={task.priority} />
        <button
          type="button"
          className="atlas-inspector__close"
          onClick={onClose}
          aria-label="Close task summary"
        >
          <X size={17} />
        </button>
      </header>
      <h2>{task.title}</h2>
      {previewing ? (
        <div className="atlas-inspector__preview" role="status">
          Visual state preview · persisted task data is unchanged
        </div>
      ) : null}
      <div className={`atlas-inspector__status atlas-inspector__status--${tone}`}>
        {tone === "blocked" ? (
          <WarningCircle weight="fill" />
        ) : tone === "complete" ? (
          <CheckCircle weight="fill" />
        ) : (
          <Robot weight="fill" />
        )}
        <span>
          <small>Current room</small>
          <strong>
            {room?.roomName ?? task.currentStage} · {getAtlasStatusLabel(task)}
          </strong>
        </span>
      </div>
      {tone === "blocked" ? (
        <div className="atlas-blocked-callout" role="alert">
          <span>Route sealed</span>
          <strong>
            {task.error ??
              blockedPackage?.error ??
              "Repair evidence is required before this task can continue."}
          </strong>
        </div>
      ) : null}
      <dl className="atlas-inspector__facts">
        <div>
          <dt>Stage run</dt>
          <dd>
            {getEffectiveStageRunAttempts(task)} of {getEffectiveStageRunLimit(task)}
          </dd>
        </div>
        <div>
          <dt>Since</dt>
          <dd>{formatAtlasTime(task.updatedAt)}</dd>
        </div>
        <div>
          <dt>Candidate</dt>
          <dd>{candidate ? `${candidate.id} r${candidate.revisionNumber}` : "Not assembled"}</dd>
        </div>
        <div>
          <dt>Latest handoff</dt>
          <dd>{latestArtifact?.name ?? "None yet"}</dd>
        </div>
        <div>
          <dt>Gates fresh</dt>
          <dd>
            {freshGates} of {candidateGateStages.length}
          </dd>
        </div>
        <div>
          <dt>Current evidence</dt>
          <dd>
            {currentArtifact?.name ??
              (isStageRunning(task, task.currentStage) ? "Run in progress" : "Not produced")}
          </dd>
        </div>
      </dl>
      {task.workPackages.length ? (
        <section className="atlas-package-summary">
          <header>
            <span>
              <Hammer size={16} /> Implementation packages
            </span>
            <strong>{packageOverview.total}</strong>
          </header>
          <div>
            <span className="text-blue">{packageOverview.active} active</span>
            <span className="text-green">{packageOverview.ready} ready</span>
            <span className="text-green">{packageOverview.integrated} integrated</span>
            <span className="text-red">{packageOverview.blocked} blocked</span>
            <span>{packageOverview.queued} queued</span>
          </div>
          <Button tone="secondary" icon={GitBranch} onClick={onOpenWorkbench}>
            Open workbench
          </Button>
        </section>
      ) : null}
      <div className="atlas-inspector__actions">
        <Button
          tone="primary"
          icon={ArrowSquareOut}
          onClick={() => onOpenTask(task.id, inspectorAction.stageId)}
          disabled={readOnly || previewing}
        >
          {previewing ? "Preview only" : readOnly ? "Hosted preview" : inspectorAction.label}
        </Button>
        <span
          className="atlas-inspector__freshness"
          role="img"
          aria-label={`${freshGates} of ${candidateGateStages.length} candidate gates fresh`}
        >
          {candidateGateStages.map((stageId) => (
            <i
              key={stageId}
              title={`${stageId}: ${getRuntimeFreshnessLabel(task, stageId)}`}
              className={isStageComplete(task, stageId) ? "is-fresh" : ""}
            />
          ))}
        </span>
      </div>
    </aside>
  );
}

function getInspectorAction(task: RuntimeTaskSummary, tone: ReturnType<typeof getAtlasTaskTone>) {
  if (task.status === "repair-required")
    return { label: "Open repair workspace", stageId: "implement" as StageId };
  if (tone === "blocked") return { label: "Resolve blocker", stageId: task.currentStage };
  if (task.status === "awaiting-human-approval")
    return { label: "Review & continue", stageId: "approval" as StageId };
  if (task.status.startsWith("awaiting-")) return { label: "Provide input", stageId: task.currentStage };
  if (tone === "running") return { label: "Open live task", stageId: task.currentStage };
  if (tone === "complete") return { label: "View task", stageId: task.currentStage };
  return { label: "Enter task", stageId: task.currentStage };
}

export function InspectorReopen({ task, onOpen }: { task: RuntimeTaskSummary; onOpen: () => void }) {
  return (
    <button type="button" className="atlas-inspector-reopen" onClick={onOpen}>
      <span style={{ "--task-color": getTaskColor(task.id) } as CSSProperties}>
        <Robot size={18} weight="duotone" />
      </span>
      <span>
        <small>Task summary closed</small>
        <strong className="mono">{task.id}</strong>
      </span>
      Open summary <ArrowRight size={15} />
    </button>
  );
}

function buildRecentHandoffs(tasks: RuntimeTaskSummary[]) {
  return tasks
    .flatMap((task) => {
      const artifacts = [...task.artifacts].sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      );
      const rows: Array<{
        key: string;
        taskId: string;
        from: StageId;
        to: StageId;
        at: string;
        artifact: string;
        color: string;
      }> = [];
      let previous = artifacts[0];
      for (const artifact of artifacts.slice(1)) {
        if (previous && artifact.stage !== previous.stage) {
          rows.push({
            key: `${task.id}-${previous.id}-${artifact.id}`,
            taskId: task.id,
            from: previous.stage,
            to: artifact.stage,
            at: artifact.createdAt,
            artifact: previous.name,
            color: getTaskColor(task.id),
          });
        }
        previous = artifact;
      }
      const latest = artifacts.at(-1);
      if (latest && latest.stage !== task.currentStage) {
        rows.push({
          key: `${task.id}-${latest.id}-current`,
          taskId: task.id,
          from: latest.stage,
          to: task.currentStage,
          at: task.updatedAt,
          artifact: latest.name,
          color: getTaskColor(task.id),
        });
      }
      return rows;
    })
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

function stageName(stageId: StageId) {
  return workflowStages.find((stage) => stage.id === stageId)?.shortLabel ?? stageId;
}
