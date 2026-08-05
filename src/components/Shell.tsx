import {
  Bird,
  CaretDoubleLeft,
  CaretDoubleRight,
  CirclesFour,
  ClockCounterClockwise,
  Code,
  GearSix,
  ListChecks,
  Plus,
  Robot,
  SidebarSimple,
} from "@phosphor-icons/react";
import type { AppScreen, RuntimeStatus } from "../domain";
import { Button } from "./Primitives";

interface ShellProps {
  screen: AppScreen;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: (screen: AppScreen) => void;
  onNewTask: () => void;
  onOpenChangelog: () => void;
  runtimeStatus: RuntimeStatus | null;
}

const navItems = [
  { id: "command" as const, label: "Command Centre", icon: CirclesFour },
  { id: "tasks" as const, label: "Tasks", icon: ListChecks },
  { id: "skills" as const, label: "Skills", icon: Code },
  { id: "agents" as const, label: "Agents", icon: Robot },
  { id: "settings" as const, label: "Settings", icon: GearSix },
];

export function Shell({
  screen,
  collapsed,
  onToggleCollapsed,
  onNavigate,
  onNewTask,
  onOpenChangelog,
  runtimeStatus,
}: ShellProps) {
  const repositoryName =
    runtimeStatus?.suggestedRepository.split(/[\\/]/).filter(Boolean).at(-1) ?? "local workspace";
  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`} aria-label="Primary navigation">
      <div className="brand-row">
        <span className="brand-mark" aria-hidden>
          <Bird size={25} weight="duotone" />
        </span>
        <span className="brand-name">Agent Harness</span>
        <button
          className="icon-button sidebar__toggle"
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapsed}
        >
          <SidebarSimple size={18} />
        </button>
      </div>

      <section className="repository-switcher" aria-label="Active repository">
        <span className="repository-switcher__label">Repository</span>
        <strong>{repositoryName}</strong>
        <span className={`connection-dot ${runtimeStatus ? "" : "connection-dot--muted"}`} aria-hidden />
        <span className="sr-only">Repository configured</span>
      </section>

      <nav className="primary-nav">
        {navItems.map((item) => {
          const NavIcon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              className={`nav-item ${screen === item.id ? "nav-item--active" : ""}`}
              onClick={() => onNavigate(item.id)}
              aria-label={item.label}
              aria-current={screen === item.id ? "page" : undefined}
              title={collapsed ? item.label : undefined}
            >
              <NavIcon size={19} aria-hidden />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <Button
        tone="secondary"
        icon={Plus}
        className="sidebar__new-task"
        onClick={onNewTask}
        aria-label="New task"
      >
        New task
        <kbd>N</kbd>
      </Button>
      <Button
        tone="ghost"
        icon={ClockCounterClockwise}
        className="sidebar__changelog"
        onClick={onOpenChangelog}
        aria-label="View changelog"
      >
        View changelog
      </Button>

      <div className="sidebar__spacer" />

      <section className="provider-connections" aria-label="Model connections">
        <span className="sidebar-label">Connections</span>
        {(runtimeStatus?.providers ?? [{ id: "codex", label: "Codex", available: Boolean(runtimeStatus?.available), authenticated: Boolean(runtimeStatus?.authenticated), executionEnabled: true, detail: runtimeStatus?.message ?? "Runtime unavailable" }]).filter((provider) => provider.available).map((provider) => (
          <div className={`provider-connection provider-connection--${provider.id === "codex" ? "codex" : "harness"}`} key={provider.id} title={provider.detail}>
            <span className="provider-orb" aria-hidden />
            <span>{provider.label}</span>
            <span className="provider-connection__state">{provider.executionEnabled ? (provider.authenticated ? "Connected" : "Offline") : provider.authenticated ? "Signed in" : "Unavailable"}</span>
          </div>
        ))}
      </section>

      <div className="sidebar-profile">
        <span className="avatar">SK</span>
        <span className="sidebar-profile__text">
          <strong>s.k.dev</strong>
          <small>Senior developer</small>
        </span>
        <button
          type="button"
          className="sidebar-profile__toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <CaretDoubleRight size={15} /> : <CaretDoubleLeft size={15} />}
        </button>
      </div>
    </aside>
  );
}
