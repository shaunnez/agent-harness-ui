import {
  Books,
  Buildings,
  ChartBar,
  ClockCounterClockwise,
  DotsNine,
  GearSix,
  GlobeHemisphereWest,
  ListBullets,
  Robot,
} from "@phosphor-icons/react";
import { useRef } from "react";
import { useCommandWorkspace } from "../app/command-context";

type Destination = "tasks" | "projects" | "agents" | "skills" | "usage" | "settings";
const destinations = [
  { kind: "projects", label: "Projects", detail: "Repositories and bases", icon: Buildings, shortcut: "P" },
  { kind: "agents", label: "Agents", detail: "Recorded workers and runs", icon: Robot, shortcut: "A" },
  { kind: "skills", label: "Skills", detail: "Roles and model policies", icon: Books, shortcut: "K" },
  {
    kind: "usage",
    label: "Usage",
    detail: "Recorded tokens, time and estimates",
    icon: ChartBar,
    shortcut: "U",
  },
  {
    kind: "settings",
    label: "Settings",
    detail: "Models and execution defaults",
    icon: GearSix,
    shortcut: ",",
  },
] as const;

export function WorldNavigation({
  onWorld,
  onOpen,
  onBriefing,
  projectName,
}: {
  onWorld(): void;
  onOpen(destination: Destination): void;
  onBriefing(): void;
  projectName?: string;
}) {
  const menu = useRef<HTMLElement>(null);
  const context = useCommandWorkspace();
  const head = context?.snapshot.workspace;
  const pending = Boolean(
    head?.available &&
      !context?.snapshot.workspaceError &&
      context?.memory.checkpoint &&
      head.upper > context.memory.checkpoint.sequence,
  );
  return (
    <nav className="world-navigation" aria-label="Main navigation">
      <button type="button" className="selected" onClick={onWorld}>
        <GlobeHemisphereWest size={18} />
        World
      </button>
      <button type="button" onClick={() => onOpen("tasks")}>
        <ListBullets size={18} />
        Tasks<kbd>J</kbd>
      </button>
      <button type="button" popoverTarget="frontier-destinations" aria-label="Open command menu">
        <DotsNine size={19} />
        Manage
      </button>
      <section
        ref={menu}
        id="frontier-destinations"
        popover="auto"
        className="management-menu panel"
        aria-label="Management destinations"
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <header>Command menu</header>
        <button
          type="button"
          onClick={() => {
            menu.current?.hidePopover();
            context?.briefing.begin();
            onBriefing();
          }}
        >
          <ClockCounterClockwise size={22} />
          <span>
            <strong>While you were away</strong>
            <small>Recorded workspace briefing</small>
          </span>
          {pending && <span className="update-dot" role="img" aria-label="Unreviewed changes" />}
        </button>
        {destinations.map(({ kind, label, detail, icon: Icon, shortcut }) => (
          <button
            key={kind}
            type="button"
            onClick={() => {
              menu.current?.hidePopover();
              onOpen(kind);
            }}
          >
            <Icon size={22} />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
            <kbd>{shortcut}</kbd>
          </button>
        ))}
      </section>
      {projectName && <span className="breadcrumb">/ {projectName}</span>}
    </nav>
  );
}
