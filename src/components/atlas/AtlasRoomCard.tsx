import type { Icon } from "@phosphor-icons/react";
import {
  ClipboardText,
  Cube,
  FileText,
  Flask,
  GitBranch,
  Hammer,
  MagnifyingGlass,
  Package,
  Question,
  ShieldCheck,
  UserCircleCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import approvalConsole from "../../assets/atlas/approval-console.png";
import cargoCrate from "../../assets/atlas/cargo-crate.png";
import courierPod from "../../assets/atlas/courier-pod.png";
import implementRoomShell from "../../assets/atlas/room-shell-implement.png";
import reviewRoomShell from "../../assets/atlas/room-shell-review.png";
import standardRoomShell from "../../assets/atlas/room-shell-standard.png";
import routeTableConsole from "../../assets/atlas/route-table-console.png";
import scoutRadarConsole from "../../assets/atlas/scout-radar-console.png";
import synthesisConsole from "../../assets/atlas/synthesis-console.png";
import testLabRig from "../../assets/atlas/test-lab-rig.png";
import workerDrone from "../../assets/atlas/worker-drone.png";
import type { RuntimeTaskSummary, RuntimeWorkPackage, StageId } from "../../domain";
import {
  ATLAS_WORLD_HEIGHT,
  ATLAS_WORLD_WIDTH,
  type AtlasRoom,
  getAtlasStatusLabel,
  getAtlasTaskTone,
  getPackageOverview,
  getTaskColor,
} from "./atlasModel";

const stageIcons: Record<StageId, Icon> = {
  triage: Cube,
  scouts: MagnifyingGlass,
  grill: Question,
  specification: FileText,
  plan: GitBranch,
  implement: Hammer,
  "dev-review": ShieldCheck,
  test: Flask,
  "final-review": ClipboardText,
  approval: UserCircleCheck,
};

export function AtlasRoomCard({
  room,
  tasks,
  selectedTaskId,
  onSelectTask,
  onOpenWorkbench,
}: {
  room: AtlasRoom;
  tasks: RuntimeTaskSummary[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onOpenWorkbench: (taskId: string) => void;
}) {
  const roomTasks = tasks
    .filter((task) => task.currentStage === room.stageId)
    .sort((left, right) => Number(right.id === selectedTaskId) - Number(left.id === selectedTaskId));
  const active = roomTasks.some((task) => task.id === selectedTaskId);
  const roomTones = roomTasks.map(getAtlasTaskTone);
  const activityClass = roomTones.includes("running")
    ? "atlas-room--working"
    : roomTones.includes("attention")
      ? "atlas-room--attention"
      : roomTones.includes("blocked")
        ? "atlas-room--blocked"
        : roomTones.includes("complete")
          ? "atlas-room--complete"
          : "";
  const Icon = stageIcons[room.stageId];
  const roomShell =
    room.stageId === "implement"
      ? implementRoomShell
      : room.stageId === "dev-review"
        ? reviewRoomShell
        : standardRoomShell;
  const style = {
    "--room-x": `${(room.x / ATLAS_WORLD_WIDTH) * 100}%`,
    "--room-y": `${(room.y / ATLAS_WORLD_HEIGHT) * 100}%`,
    "--room-width": `${(room.width / ATLAS_WORLD_WIDTH) * 100}%`,
    "--room-height": `${(room.height / ATLAS_WORLD_HEIGHT) * 100}%`,
    "--room-accent": room.accent,
  } as CSSProperties;

  return (
    <section
      className={`atlas-room atlas-room--${room.stageId} ${roomTasks.length ? "atlas-room--occupied" : ""} ${activityClass} ${active ? "atlas-room--active" : ""}`}
      style={style}
      data-atlas-room={room.stageId}
      aria-label={`${room.number}. ${room.stageId}, ${room.roomName}; ${roomTasks.length} task${roomTasks.length === 1 ? "" : "s"}`}
    >
      <img className="atlas-room__shell" src={roomShell} alt="" aria-hidden />
      {active ? <span className="atlas-room__active-label">Current stage</span> : null}
      <div className="atlas-room__inner">
        <header className="atlas-room__header">
          <span className="atlas-room__number">{room.number}</span>
          <strong>{stageLabel(room.stageId)}</strong>
          <small>{room.roomName}</small>
        </header>
        <div className="atlas-room__body">
          {room.stageId === "implement" ? (
            <ImplementHangar
              tasks={roomTasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
              onOpenWorkbench={onOpenWorkbench}
            />
          ) : room.stageId === "dev-review" ? (
            <ReviewBays tasks={roomTasks} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
          ) : (
            <StandardRoom
              tasks={roomTasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
              Icon={Icon}
              stageId={room.stageId}
            />
          )}
        </div>
      </div>
      <span
        className="atlas-room__counter"
        title={`${roomTasks.length} tasks in ${stageLabel(room.stageId)}`}
      >
        <ClipboardText size={13} weight="bold" /> {roomTasks.length}
      </span>
    </section>
  );
}

function StandardRoom({
  tasks,
  selectedTaskId,
  onSelectTask,
  Icon,
  stageId,
}: {
  tasks: RuntimeTaskSummary[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  Icon: Icon;
  stageId: StageId;
}) {
  if (!tasks.length) return <RoomApparatus stageId={stageId} Icon={Icon} />;
  const visible = tasks.slice(0, 2);
  return (
    <div className={`atlas-pod-stack ${visible.length > 1 ? "atlas-pod-stack--multiple" : ""}`}>
      {visible.map((task) => (
        <TaskPod
          key={task.id}
          task={task}
          selected={task.id === selectedTaskId}
          compact={visible.length > 1}
          onSelect={() => onSelectTask(task.id)}
        />
      ))}
      {tasks.length > visible.length ? (
        <span className="atlas-room__overflow">+{tasks.length - visible.length}</span>
      ) : null}
    </div>
  );
}

function RoomApparatus({ stageId, Icon }: { stageId: StageId; Icon: Icon }) {
  const apparatusAssets: Partial<Record<StageId, string>> = {
    scouts: scoutRadarConsole,
    plan: routeTableConsole,
    test: testLabRig,
    "final-review": synthesisConsole,
    approval: approvalConsole,
  };
  const asset = apparatusAssets[stageId];
  return (
    <span className="atlas-room__apparatus" aria-hidden>
      {asset ? <img src={asset} alt="" /> : <Icon size={38} weight="duotone" />}
    </span>
  );
}

function ImplementHangar({
  tasks,
  selectedTaskId,
  onSelectTask,
  onOpenWorkbench,
}: {
  tasks: RuntimeTaskSummary[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onOpenWorkbench: (taskId: string) => void;
}) {
  if (!tasks.length)
    return (
      <span className="atlas-room__apparatus atlas-room__empty--hangar">
        <Hammer size={42} weight="duotone" />
        <small>No task in build</small>
      </span>
    );
  const visibleTasks = tasks.slice(0, 2);
  const primary = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const overview = getPackageOverview(primary?.workPackages ?? []);
  return (
    <div className={`atlas-hangar ${visibleTasks.length === 1 ? "atlas-hangar--single-task" : ""}`}>
      <div className="atlas-hangar__jobs">
        {visibleTasks.map((task) => (
          <ImplementationJob
            key={task.id}
            task={task}
            selected={task.id === selectedTaskId}
            condensed={visibleTasks.length > 1}
            onSelect={() => onSelectTask(task.id)}
          />
        ))}
      </div>
      {tasks.length > visibleTasks.length ? (
        <span className="atlas-room__overflow atlas-room__overflow--hangar">
          +{tasks.length - visibleTasks.length} tasks
        </span>
      ) : null}
      <div className="atlas-hangar__footer">
        <div className="atlas-hangar__totals">
          <span>
            {primary?.id} · {overview.total} package{overview.total === 1 ? "" : "s"}
          </span>
          <span className="text-blue">{overview.active} active</span>
          <span className="text-green">{overview.ready} ready</span>
          <span className="text-green">{overview.integrated} integrated</span>
          <span className={overview.blocked ? "text-red" : ""}>{overview.blocked} blocked</span>
        </div>
        {primary ? (
          <button
            type="button"
            className="atlas-hangar__workbench"
            onClick={() => onOpenWorkbench(primary.id)}
          >
            <GitBranch size={14} weight="bold" />
            <span>
              <strong>Open workbench</strong>
              <small>Dependency batches · 1–N packages</small>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ImplementationJob({
  task,
  selected,
  condensed,
  onSelect,
}: {
  task: RuntimeTaskSummary;
  selected: boolean;
  condensed: boolean;
  onSelect: () => void;
}) {
  const tone = getAtlasTaskTone(task);
  const visiblePackages = task.workPackages.slice(0, condensed ? 3 : 6);
  const packageOverview = getPackageOverview(task.workPackages);
  return (
    <article className={`atlas-job atlas-job--${tone} ${selected ? "atlas-job--selected" : ""}`}>
      <button type="button" className="atlas-job__task" onClick={onSelect} aria-pressed={selected}>
        <TaskCore task={task} />
        <span>
          <strong className="mono">{task.id}</strong>
          <small>{getAtlasStatusLabel(task)}</small>
        </span>
        {tone === "blocked" ? <strong className="atlas-job__blocked">Blocked</strong> : null}
        {tone === "blocked" && packageOverview.blocked ? (
          <small className="atlas-job__blocked-reason">
            {packageOverview.blocked} package{packageOverview.blocked === 1 ? "" : "s"} blocked
          </small>
        ) : null}
      </button>
      <div
        className={`atlas-package-bays ${visiblePackages.length === 1 ? "atlas-package-bays--single" : ""}`}
      >
        {visiblePackages.length ? (
          visiblePackages.map((item) => <PackageBay item={item} key={item.id} />)
        ) : (
          <span className="atlas-package-bay atlas-package-bay--empty">No packages persisted</span>
        )}
        {task.workPackages.length > visiblePackages.length ? (
          <span className="atlas-package-bay atlas-package-bay--overflow">
            +{task.workPackages.length - visiblePackages.length}
          </span>
        ) : null}
      </div>
      {tone === "blocked" ? <span className="atlas-task-seal" aria-hidden /> : null}
    </article>
  );
}

function PackageBay({ item }: { item: RuntimeWorkPackage }) {
  const status = packageStatus(item.status);
  const sprite = item.status === "integrated" || item.status === "planned" ? cargoCrate : workerDrone;
  return (
    <span
      className={`atlas-package-bay atlas-package-bay--${status.tone}`}
      title={`${item.title}: ${status.label}`}
    >
      <img className="atlas-package-bay__sprite" src={sprite} alt="" aria-hidden />
      <span>
        <Package size={13} weight="duotone" />
        <strong className="mono">{item.id}</strong>
      </span>
      <small>{status.label}</small>
    </span>
  );
}

function ReviewBays({
  tasks,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: RuntimeTaskSummary[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}) {
  if (!tasks.length)
    return (
      <span className="atlas-room__apparatus atlas-room__empty--review">
        <ShieldCheck size={42} weight="duotone" />
        <small>Inspection bays clear</small>
      </span>
    );
  const visible = tasks.slice(0, 2);
  return (
    <div className={`atlas-review-bays ${visible.length === 1 ? "atlas-review-bays--single" : ""}`}>
      {visible.map((task) => {
        const tone = getAtlasTaskTone(task);
        return (
          <button
            type="button"
            key={task.id}
            className={`atlas-review-bay atlas-review-bay--${tone} ${task.id === selectedTaskId ? "atlas-review-bay--selected" : ""}`}
            onClick={() => onSelectTask(task.id)}
            aria-pressed={task.id === selectedTaskId}
            title={
              tone === "blocked"
                ? (task.error ?? "Repair required")
                : `${task.id}: ${getAtlasStatusLabel(task)}`
            }
          >
            <TaskCore task={task} />
            <span>
              <strong className="mono">{task.id}</strong>
              <small>{getAtlasStatusLabel(task)}</small>
              {tone === "blocked" ? <em>{shortBlockedReason(task)}</em> : null}
            </span>
            {tone === "blocked" ? <span className="atlas-task-seal" aria-hidden /> : null}
          </button>
        );
      })}
      {tasks.length > visible.length ? (
        <span className="atlas-room__overflow">+{tasks.length - visible.length}</span>
      ) : null}
    </div>
  );
}

function shortBlockedReason(task: RuntimeTaskSummary) {
  const persisted = task.error ?? task.workPackages.find((item) => item.status === "failed")?.error;
  if (!persisted) return "Repair required";
  if (/denied tool calls?|tool policy|read-only stage/i.test(persisted)) return "Tool policy violation";
  if (/timed? out|timeout/i.test(persisted)) return "Run timed out";
  if (/merge conflict/i.test(persisted)) return "Merge conflict";
  const firstLine = persisted
    .split(/[\n.!?]/, 1)[0]
    ?.replace(/\s+/g, " ")
    .trim();
  if (!firstLine) return "Repair required";
  return firstLine.length > 42 ? `${firstLine.slice(0, 39)}…` : firstLine;
}

function TaskPod({
  task,
  selected,
  compact,
  onSelect,
}: {
  task: RuntimeTaskSummary;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  const tone = getAtlasTaskTone(task);
  return (
    <button
      type="button"
      className={`atlas-pod atlas-pod--${tone} ${selected ? "atlas-pod--selected" : ""} ${compact ? "atlas-pod--compact" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      title={`${task.id}: ${getAtlasStatusLabel(task)}`}
      style={{ "--task-color": getTaskColor(task.id) } as CSSProperties}
    >
      <TaskCore task={task} />
      <strong className="mono">{task.id}</strong>
      {!compact || tone === "blocked" || tone === "attention" ? (
        <small>{getAtlasStatusLabel(task)}</small>
      ) : null}
      {tone === "blocked" ? (
        <>
          <span className="atlas-task-seal" aria-hidden />
          <em>
            <WarningCircle size={11} weight="fill" /> Blocked
          </em>
        </>
      ) : null}
    </button>
  );
}

function TaskCore({ task }: { task: RuntimeTaskSummary }) {
  const tone = getAtlasTaskTone(task);
  return (
    <span
      className={`atlas-task-core atlas-task-core--${tone}`}
      style={{ "--task-color": getTaskColor(task.id) } as CSSProperties}
      aria-hidden
    >
      <img className="atlas-task-core__courier" src={courierPod} alt="" />
      {tone === "running" ? <img className="atlas-task-core__agent" src={workerDrone} alt="" /> : null}
      <i aria-hidden />
    </span>
  );
}

function packageStatus(status: RuntimeWorkPackage["status"]) {
  if (status === "ready_for_integration") return { label: "ready", tone: "ready" };
  if (status === "integrated") return { label: "integrated", tone: "integrated" };
  if (status === "running") return { label: "active", tone: "running" };
  if (status === "failed") return { label: "blocked", tone: "failed" };
  return { label: "queued", tone: "queued" };
}

function stageLabel(stageId: StageId) {
  const labels: Record<StageId, string> = {
    triage: "Triage",
    scouts: "Repo scouts",
    grill: "Grill",
    specification: "Task spec",
    plan: "Impl plan",
    implement: "Implement",
    "dev-review": "Dev review",
    test: "Test",
    "final-review": "Final review",
    approval: "Human approval",
  };
  return labels[stageId];
}
