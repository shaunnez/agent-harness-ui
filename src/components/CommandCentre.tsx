import {
  ArrowRight,
  CheckCircle,
  Clock,
  Cpu,
  CurrencyDollar,
  GitBranch,
  HourglassMedium,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";
import { recentTasks } from "../domain";
import { Button, ModelStack, PriorityBadge, SectionHeader } from "./Primitives";

export function CommandCentre({ onOpenTask }: { onOpenTask: () => void }) {
  return (
    <div className="page command-centre-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">goose-hub · local workspace</p>
          <h1>Command Centre</h1>
          <p>One deterministic view of active work, evidence, and human decisions.</p>
        </div>
        <div className="health-summary" role="status" aria-label="Project health">
          <ShieldCheck size={18} weight="fill" />
          <span>
            <strong>Healthy</strong> · main clean · 142 tests passing
          </span>
        </div>
      </header>

      <section className="current-run" aria-labelledby="current-run-title">
        <div className="current-run__main">
          <div className="current-run__status">
            <span className="live-pulse" aria-hidden />
            Active workflow
          </div>
          <h2 id="current-run-title">Add task priority and expose it through the API</h2>
          <p>
            Implementation agent is updating schema, routes, UI badges, and deterministic acceptance tests.
          </p>
          <div className="current-run__meta">
            <span className="mono">GH-241</span>
            <PriorityBadge priority="medium" />
            <ModelStack
              models={[
                { provider: "codex", model: "Codex 1.2" },
                { provider: "claude", model: "Claude 3.7 Sonnet" },
              ]}
              compact
            />
            <span>
              <Clock size={15} /> 12m 44s
            </span>
            <span>
              <GitBranch size={15} /> Implement run 1 of 3
            </span>
          </div>
        </div>
        <div className="current-run__progress">
          <div
            className="progress-ring"
            role="progressbar"
            aria-label="Workflow progress"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={6}
          >
            <span>6/10</span>
          </div>
          <div>
            <strong>Implement</strong>
            <span>Patch produced · schema validated</span>
          </div>
        </div>
        <Button tone="primary" icon={ArrowRight} onClick={onOpenTask}>
          Open workspace
        </Button>
      </section>

      <div className="command-grid">
        <section className="recent-runs">
          <SectionHeader
            title="Recent tasks"
            description="Deterministic status across the active repository"
          />
          <div className="task-table">
            <div className="task-table__header">
              <span>Task</span>
              <span>Status</span>
              <span>Stage</span>
              <span>Tokens</span>
              <span>Approx. cost</span>
              <span>Models</span>
            </div>
            {recentTasks.map((task) => (
              <button className="task-table__row" type="button" key={task.id} onClick={onOpenTask}>
                <span className="task-table__title">
                  <span className="mono">{task.id}</span>
                  <strong>{task.title}</strong>
                  <PriorityBadge priority={task.priority.toLowerCase() as "low" | "medium" | "high"} />
                </span>
                <span>
                  <span className={`status-dot status-dot--${task.status.toLowerCase().replace(" ", "-")}`} />
                  {task.status}
                </span>
                <span>{task.stage}</span>
                <span className="mono">{task.tokens}</span>
                <span className="mono" title="Estimate from configured input, output, and cache rates">
                  {task.cost}
                </span>
                <ModelStack models={task.models} compact />
              </button>
            ))}
          </div>
        </section>

        <aside className="command-side">
          <section className="attention-list">
            <SectionHeader title="Needs attention" />
            <button type="button" className="attention-row" onClick={onOpenTask}>
              <span className="attention-row__icon">
                <Warning size={17} weight="fill" />
              </span>
              <span>
                <strong>GH-238 · Repair runs exhausted</strong>
                <small>Choose override, re-plan, or mark blocked</small>
              </span>
              <ArrowRight size={15} />
            </button>
            <button type="button" className="attention-row" onClick={onOpenTask}>
              <span className="attention-row__icon attention-row__icon--amber">
                <HourglassMedium size={17} />
              </span>
              <span>
                <strong>GH-235 · Clarification waiting</strong>
                <small>One repository policy decision required</small>
              </span>
              <ArrowRight size={15} />
            </button>
          </section>

          <section className="usage-summary">
            <SectionHeader title="Usage · today" />
            <div className="usage-line">
              <span>
                <Cpu size={16} />
                Agent runs
              </span>
              <strong>18</strong>
              <small>12 Codex · 6 Claude</small>
            </div>
            <div className="usage-line">
              <span>
                <CheckCircle size={16} />
                Tokens
              </span>
              <strong>284k</strong>
              <small>71% cache hit</small>
            </div>
            <div className="usage-line">
              <span>
                <CurrencyDollar size={16} />
                Approx. cost
              </span>
              <strong>$6.42</strong>
              <small title="Illustrative estimate from configured model rates and cache discounts">
                Estimated · cached rates included
              </small>
            </div>
            <div className="usage-line">
              <span>
                <Clock size={16} />
                Elapsed
              </span>
              <strong>2h 18m</strong>
              <small>1h 46m saved</small>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
