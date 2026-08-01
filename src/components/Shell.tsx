import {
  Bird,
  CaretDoubleLeft,
  CaretDoubleRight,
  CirclesFour,
  Code,
  GearSix,
  ListChecks,
  Plus,
  Robot,
  SidebarSimple,
} from "@phosphor-icons/react";
import type { AppScreen } from "../domain";
import { Button } from "./Primitives";

interface ShellProps {
  screen: AppScreen;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: (screen: AppScreen) => void;
  onNewTask: () => void;
}

const navItems = [
  { id: "command" as const, label: "Command Centre", icon: CirclesFour },
  { id: "tasks" as const, label: "Tasks", icon: ListChecks },
  { id: "skills" as const, label: "Skills", icon: Code },
  { id: "agents" as const, label: "Agents", icon: Robot },
  { id: "settings" as const, label: "Settings", icon: GearSix },
];

export function Shell({ screen, collapsed, onToggleCollapsed, onNavigate, onNewTask }: ShellProps) {
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
        <strong>goose-hub</strong>
        <span className="connection-dot" aria-hidden />
        <span className="sr-only">Repository healthy</span>
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

      <div className="sidebar__spacer" />

      <section className="provider-connections" aria-label="Model connections">
        <span className="sidebar-label">Connections</span>
        <div className="provider-connection provider-connection--codex">
          <span className="provider-orb" aria-hidden />
          <span>OpenAI models</span>
          <span className="provider-connection__state">Connected</span>
        </div>
        <div className="provider-connection provider-connection--claude">
          <span className="provider-orb" aria-hidden />
          <span>Anthropic models</span>
          <span className="provider-connection__state">Connected</span>
        </div>
        <div className="provider-connection provider-connection--harness">
          <span className="provider-orb" aria-hidden />
          <span>Local harness</span>
          <span className="provider-connection__state">Healthy</span>
        </div>
      </section>

      <div className="sidebar-profile">
        <span className="avatar">SK</span>
        <span className="sidebar-profile__text">
          <strong>s.k.dev</strong>
          <small>Senior developer</small>
        </span>
        {collapsed ? <CaretDoubleRight size={15} /> : <CaretDoubleLeft size={15} />}
      </div>
    </aside>
  );
}
