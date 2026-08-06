import {
  BirdIcon,
  CaretDoubleLeftIcon,
  CaretDoubleRightIcon,
  CirclesFourIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  GearSixIcon,
  ListChecksIcon,
  PlusIcon,
  RobotIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import type { AppScreen, RuntimeStatus } from "../domain";
import { Button } from "./Primitives";

/**
 * One vocabulary for both providers' connection state, shared by the sidebar
 * (this file) and the Settings runtime-connection rows (SettingsScreen.tsx) — the
 * two used to describe the same underlying fields with different words ("Connected"
 * vs "Signed in", a grey dot vs a coloured one), which read as disagreement even
 * when both providers were in fact working.
 */
export type ConnectionState = "connected" | "unverified" | "not-signed-in" | "unavailable";

export function providerConnectionState(provider?: {
  available?: boolean;
  authenticated?: boolean;
  executionEnabled?: boolean;
}): ConnectionState {
  if (!provider?.available) return "unavailable";
  if (!provider.authenticated) return "not-signed-in";
  return provider.executionEnabled ? "connected" : "unverified";
}

export function connectionStateLabel(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "unverified":
      return "Signed in · unverified";
    case "not-signed-in":
      return "Not signed in";
    case "unavailable":
      return "Unavailable";
  }
}

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
  { id: "command" as const, label: "Command Centre", icon: CirclesFourIcon },
  { id: "tasks" as const, label: "Tasks", icon: ListChecksIcon },
  { id: "skills" as const, label: "Skills", icon: CodeIcon },
  { id: "agents" as const, label: "Agents", icon: RobotIcon },
  { id: "settings" as const, label: "Settings", icon: GearSixIcon },
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
          <BirdIcon size={25} weight="duotone" />
        </span>
        <span className="brand-name">Agent Harness</span>
        <button
          className="icon-button sidebar__toggle"
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapsed}
        >
          <SidebarSimpleIcon size={18} />
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
        icon={PlusIcon}
        className="sidebar__new-task"
        onClick={onNewTask}
        aria-label="New task"
      >
        New task
        <kbd>N</kbd>
      </Button>
      <Button
        tone="ghost"
        icon={ClockCounterClockwiseIcon}
        className="sidebar__changelog"
        onClick={onOpenChangelog}
        aria-label="View changelog"
      >
        View changelog
      </Button>

      <div className="sidebar__spacer" />

      <section className="provider-connections" aria-label="Model connections">
        <span className="sidebar-label">Connections</span>
        {(runtimeStatus?.providers ?? [{ id: "codex", label: "Codex", available: Boolean(runtimeStatus?.available), authenticated: Boolean(runtimeStatus?.authenticated), executionEnabled: true, detail: runtimeStatus?.message ?? "Runtime unavailable" }]).filter((provider) => provider.available).map((provider) => {
          // The orb variant is the provider's own brand colour (Codex blue, Claude
          // violet), independent of connection state — it used to fall through to the
          // generic "harness" grey for anything that wasn't Codex, which is why Claude's
          // dot stayed grey while signed in and reads as "inactive" even when connected.
          const variant = provider.id === "codex" || provider.id === "claude" ? provider.id : "harness";
          const state = providerConnectionState(provider);
          return (
            <div className={`provider-connection provider-connection--${variant}`} key={provider.id} title={provider.detail}>
              <span className="provider-orb" aria-hidden />
              <span>{provider.label}</span>
              <span className={`provider-connection__state provider-connection__state--${state}`}>
                {connectionStateLabel(state)}
              </span>
            </div>
          );
        })}
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
          {collapsed ? <CaretDoubleRightIcon size={15} /> : <CaretDoubleLeftIcon size={15} />}
        </button>
      </div>
    </aside>
  );
}
