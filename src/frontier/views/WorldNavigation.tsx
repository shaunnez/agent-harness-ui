import {
  Books,
  Buildings,
  ChartBar,
  DotsNine,
  GearSix,
  GlobeHemisphereWest,
  ListBullets,
  Robot,
} from "@phosphor-icons/react";
import { useRef } from "react";

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
  projectName,
}: {
  onWorld(): void;
  onOpen(destination: Destination): void;
  projectName?: string;
}) {
  const menu = useRef<HTMLElement>(null);
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
