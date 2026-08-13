import type { Icon } from "@phosphor-icons/react";
import { CheckCircle, Circle, Info, WarningCircle, XCircle } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Provider, TaskRunState } from "../domain";

type ButtonTone = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  icon?: Icon;
  compact?: boolean;
}

export function Button({
  tone = "secondary",
  icon: ButtonIcon,
  compact,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={`button button--${tone} ${compact ? "button--compact" : ""} ${className}`} {...props}>
      {ButtonIcon ? <ButtonIcon aria-hidden size={compact ? 15 : 16} weight="bold" /> : null}
      {children}
    </button>
  );
}

export function PriorityBadge({ priority }: { priority: "low" | "medium" | "high" }) {
  return <span className={`badge badge--${priority}`}>{priority}</span>;
}

export function ProviderTag({ provider, model }: { provider: Provider; model?: string }) {
  const label = provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : "Harness";
  return (
    <span className={`provider-tag provider-tag--${provider}`}>
      <span className="provider-tag__dot" aria-hidden />
      {model ?? label}
    </span>
  );
}

export function ModelStack({
  models,
  compact = false,
}: {
  models: Array<{ provider: Exclude<Provider, "harness">; model: string }>;
  compact?: boolean;
}) {
  return (
    <span
      className={`model-stack ${compact ? "model-stack--compact" : ""}`}
      role="img"
      aria-label={`Models: ${models.map((item) => item.model).join(", ")}`}
    >
      {models.map((item) => (
        <ProviderTag key={item.model} provider={item.provider} model={item.model} />
      ))}
    </span>
  );
}

const runStateCopy: Record<TaskRunState, string> = {
  running: "Running",
  paused: "Paused",
  "needs-input": "Needs input",
  failed: "Failed",
  repairing: "Repairing",
  blocked: "Blocked",
  "awaiting-approval": "Awaiting approval",
  "merged-to-target": "Merged to target",
  completed: "Completed",
  closed: "Closed",
  continued: "Continued",
  archived: "Archived",
};

export function StateBadge({ state, label }: { state: TaskRunState; label?: string }) {
  const StateIcon =
    state === "failed" || state === "blocked"
      ? XCircle
      : state === "completed"
        ? CheckCircle
        : state === "closed" || state === "continued" || state === "archived"
          ? Circle
          : state === "needs-input" || state === "awaiting-approval" || state === "merged-to-target"
            ? WarningCircle
            : Info;
  return (
    <span className={`state-badge state-badge--${state}`}>
      <StateIcon aria-hidden size={14} weight="fill" />
      {label ?? runStateCopy[state]}
    </span>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="section-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <p className="section-header__description">{description}</p> : null}
      </div>
      {action ? <div className="section-header__action">{action}</div> : null}
    </header>
  );
}

export function EvidenceState({ tone }: { tone: "passed" | "failed" | "pending" }) {
  const Icon = tone === "passed" ? CheckCircle : tone === "failed" ? XCircle : Circle;
  return (
    <Icon
      className={`evidence-state evidence-state--${tone}`}
      aria-label={tone}
      size={16}
      weight={tone === "pending" ? "regular" : "fill"}
    />
  );
}

export function EmptyState({ icon: EmptyIcon, title, copy }: { icon: Icon; title: string; copy: string }) {
  return (
    <div className="empty-state">
      <EmptyIcon size={30} aria-hidden />
      <strong>{title}</strong>
      <span>{copy}</span>
    </div>
  );
}
