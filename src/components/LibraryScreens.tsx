import {
  ArrowLeft,
  ArrowRight,
  Brain,
  ChartLineUp,
  CheckCircle,
  Code,
  CurrencyDollar,
  Database,
  FileCode,
  FloppyDisk,
  GitBranch,
  MagnifyingGlass,
  Robot,
  ShieldCheck,
  SlidersHorizontal,
  TerminalWindow,
} from "@phosphor-icons/react";
import { useState } from "react";
import { recentTasks, workflowStages } from "../domain";
import { Button, ModelStack, PriorityBadge, ProviderTag, SectionHeader, StateBadge } from "./Primitives";

export function TasksScreen({ onOpenTask }: { onOpenTask: () => void }) {
  return (
    <div className="page library-page">
      <SectionHeader
        eyebrow="goose-hub"
        title="Tasks"
        description="Every development goal, model assignment, and deterministic workflow state."
        action={
          <Button tone="secondary" icon={SlidersHorizontal}>
            Filter
          </Button>
        }
      />
      <div className="toolbar">
        <MagnifyingGlass size={17} />
        <input aria-label="Search tasks" placeholder="Search tasks, IDs, models, or artifacts…" />
        <span>4 tasks</span>
      </div>
      <div className="library-table library-table--tasks">
        <div className="library-table__header">
          <span>Task</span>
          <span>Status</span>
          <span>Stage trail</span>
          <span>Stage run</span>
          <span>Tokens</span>
          <span>Approx. cost</span>
          <span>Models</span>
        </div>
        {recentTasks.map((task) => (
          <button className="library-table__row" type="button" key={task.id} onClick={onOpenTask}>
            <span>
              <span className="task-title-line">
                <span className="mono">{task.id}</span>
                <PriorityBadge priority={task.priority.toLowerCase() as "low" | "medium" | "high"} />
              </span>
              <strong>{task.title}</strong>
            </span>
            <StateBadge
              state={
                task.status === "Running"
                  ? "running"
                  : task.status === "Blocked"
                    ? "blocked"
                    : task.status === "Completed"
                      ? "completed"
                      : "needs-input"
              }
            />
            <StageTrail
              activeIndex={task.stageIndex}
              stage={task.stage}
              completed={task.status === "Completed"}
            />
            <span className="stage-run-cell">
              <strong className="mono">
                {task.stageRun} / {task.stageRunLimit}
              </strong>
              <small>current stage</small>
            </span>
            <span className="mono">{task.tokens}</span>
            <span className="mono" title="Estimate from configured input, output, and cache rates">
              {task.cost}
            </span>
            <ModelStack models={task.models} compact />
          </button>
        ))}
      </div>
    </div>
  );
}

function StageTrail({
  activeIndex,
  stage,
  completed,
}: {
  activeIndex: number;
  stage: string;
  completed: boolean;
}) {
  return (
    <span className="stage-trail" role="img" aria-label={`Current stage ${stage}, ${activeIndex + 1} of 10`}>
      <span className="stage-trail__label">{stage}</span>
      <span className="stage-trail__nodes" aria-hidden>
        {workflowStages.map((item, index) => (
          <i
            key={item.id}
            className={
              completed || index < activeIndex
                ? "stage-trail__done"
                : index === activeIndex
                  ? "stage-trail__active"
                  : ""
            }
          >
            {completed || index < activeIndex ? "✓" : index === activeIndex ? activeIndex + 1 : ""}
          </i>
        ))}
      </span>
    </span>
  );
}

const skillRecords = [
  {
    id: "triage",
    name: "triage",
    description: "Verify and classify incoming work before it reaches an implementation agent.",
    version: "v2.4",
    success: "97%",
    avgCost: "$0.08",
    avgTokens: "3.2k",
    source: "https://github.com/mattpocock/skills/blob/main/docs/engineering/triage.md",
    usedBy: "Triage agent",
    input: "Issue, PR, or task description; repository and tracker context",
    output: "Verified category, workflow state, rationale, and ready-for-agent brief",
    prompt:
      "Verify the claim before promoting work. Recommend exactly one category role and one workflow state, explain why, and wait for human direction before changing tracker state.",
  },
  {
    id: "research",
    name: "research",
    description: "Read primary sources and leave a cited Markdown research artifact.",
    version: "v1.8",
    success: "99%",
    avgCost: "$0.14",
    avgTokens: "6.8k",
    source: "https://github.com/mattpocock/skills/blob/main/docs/engineering/research.md",
    usedBy: "Repository research agent",
    input: "A factual question plus allowed repositories, documentation, and APIs",
    output: "Cited Markdown findings sourced only from primary material",
    prompt:
      "Answer the question from sources that own the answer. Prefer repository code, official docs, specs, and first-party APIs. Save one cited Markdown artifact.",
  },
  {
    id: "grill-with-docs",
    name: "grill-with-docs",
    description: "Walk the decision tree one question at a time and preserve settled language.",
    version: "v3.1",
    success: "94%",
    avgCost: "$0.22",
    avgTokens: "9.6k",
    source: "https://github.com/mattpocock/skills/blob/main/docs/engineering/grill-with-docs.md",
    usedBy: "Clarification agent",
    input: "A fuzzy plan or design plus repository evidence",
    output: "Settled decisions, CONTEXT.md glossary updates, and rare ADR proposals",
    prompt:
      "Run a grilling session using domain modeling. Ask one decision at a time, recommend an answer, read the codebase for facts, and do not act until shared understanding is confirmed.",
  },
  {
    id: "to-spec",
    name: "to-spec",
    description: "Synthesize settled context into a complete specification without re-interviewing.",
    version: "v2.6",
    success: "96%",
    avgCost: "$0.31",
    avgTokens: "12.4k",
    source: "https://github.com/mattpocock/skills/blob/main/docs/engineering/to-spec.md",
    usedBy: "Specification agent",
    input: "Conversation, repository evidence, glossary, ADRs, and agreed test seams",
    output: "Problem, solution, user stories, decisions, testing, scope, and notes",
    prompt:
      "Synthesize what is already known. Prefer existing test seams, include extensive independently checkable user stories, and publish the finished spec without another interview.",
  },
  {
    id: "to-tickets",
    name: "to-tickets",
    description: "Split a settled spec into tracer-bullet tickets with explicit blocking edges.",
    version: "v2.2",
    success: "93%",
    avgCost: "$0.19",
    avgTokens: "7.1k",
    source: "https://github.com/mattpocock/skills/blob/main/docs/engineering/to-tickets.md",
    usedBy: "Planning agent",
    input: "Approved specification and configured tracker",
    output: "Vertical-slice tickets, dependencies, frontier, and publication record",
    prompt:
      "Create thin vertical slices that are demoable end-to-end. Declare blockers on every ticket, publish blockers first, and use expand-contract only for unavoidable wide refactors.",
  },
  {
    id: "implement",
    name: "implement",
    description: "Build approved tickets through TDD, typechecking, the full suite, and review.",
    version: "v4.0",
    success: "92%",
    avgCost: "$0.74",
    avgTokens: "28.5k",
    source: "https://github.com/mattpocock/skills/blob/main/docs/engineering/implement.md",
    usedBy: "Implementation agent",
    input: "Approved spec or tickets with pre-agreed seams",
    output: "Test-driven patch, verification evidence, review findings, and commit",
    prompt:
      "Implement only the settled work. Use TDD at pre-agreed seams, typecheck and run focused tests regularly, run the full suite once, then request code review.",
  },
  {
    id: "code-review",
    name: "code-review",
    description: "Review a fixed diff independently against repository standards and the spec.",
    version: "v3.3",
    success: "98%",
    avgCost: "$0.42",
    avgTokens: "15.7k",
    source: "https://github.com/mattpocock/skills/blob/main/docs/engineering/code-review.md",
    usedBy: "Standards reviewer + Spec reviewer",
    input: "Fixed point, non-empty diff, standards sources, and originating spec",
    output: "Separate Standards and Spec findings; no blended verdict",
    prompt:
      "Pin the fixed point, then run Standards and Spec reviews in separate contexts. Preserve both reports side by side and never merge or re-rank their findings.",
  },
  {
    id: "tdd",
    name: "tdd",
    description: "Drive one observable behavior at a time through a red-green loop.",
    version: "v2.9",
    success: "95%",
    avgCost: "$0.37",
    avgTokens: "13.9k",
    source: "https://github.com/mattpocock/skills/blob/main/docs/engineering/tdd.md",
    usedBy: "Implementation agent",
    input: "Concrete behavior, stable public seam, and independent expected values",
    output: "Tracer test plus iterative red-green implementation evidence",
    prompt:
      "Write one behavior test, make it pass, then choose the next. Test public interfaces, use independent expected values, and refactor only while green.",
  },
] as const;

export function SkillsScreen() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = skillRecords.find((skill) => skill.id === selectedId);
  if (selected) return <SkillDetail skill={selected} onBack={() => setSelectedId(null)} />;
  const icons = [MagnifyingGlass, Database, Brain, FileCode, GitBranch, TerminalWindow, ShieldCheck, Code];
  return (
    <div className="page library-page">
      <SectionHeader
        eyebrow="Model-neutral capabilities"
        title="Skills"
        description="Reusable instructions define how work is done; agent profiles decide which model runs them."
      />
      <div className="skill-list">
        {skillRecords.map((skill, index) => {
          const SkillIcon = icons[index] ?? Code;
          return (
            <button
              className="skill-row"
              type="button"
              key={skill.id}
              onClick={() => setSelectedId(skill.id)}
            >
              <SkillIcon size={20} />
              <span>
                <strong>{skill.name}</strong>
                <small>
                  {skill.description} · {skill.version}
                </small>
              </span>
              <span className="skill-metric">
                <strong>{skill.success}</strong>
                <small>successful gates</small>
              </span>
              <span className="skill-metric">
                <strong>{skill.avgCost}</strong>
                <small>average cost</small>
              </span>
              <ArrowRight size={16} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SkillDetail({ skill, onBack }: { skill: (typeof skillRecords)[number]; onBack: () => void }) {
  const [prompt, setPrompt] = useState<string>(skill.prompt);
  const [saved, setSaved] = useState(false);
  return (
    <div className="page library-page detail-page">
      <button type="button" className="detail-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Skills
      </button>
      <SectionHeader
        eyebrow={`Installed skill · ${skill.version}`}
        title={skill.name}
        description={skill.description}
        action={<span className="badge badge--success">Enabled</span>}
      />
      <div className="detail-metrics">
        <Metric icon={CheckCircle} label="Successful gates" value={skill.success} />
        <Metric icon={CurrencyDollar} label="Average cost" value={skill.avgCost} />
        <Metric icon={ChartLineUp} label="Average tokens" value={skill.avgTokens} />
        <Metric icon={Robot} label="Used by" value={skill.usedBy} />
      </div>
      <div className="detail-grid">
        <section className="detail-panel detail-panel--prompt">
          <header>
            <span>
              <h3>Installed prompt</h3>
              <p>Editable prototype copy; a real save would create a versioned local override.</p>
            </span>
            <a href={skill.source} target="_blank" rel="noreferrer">
              View source <ArrowRight size={13} />
            </a>
          </header>
          <textarea
            aria-label={`${skill.name} prompt`}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setSaved(false);
            }}
            rows={10}
          />
          <div className="detail-panel__actions">
            <Button tone="primary" icon={FloppyDisk} onClick={() => setSaved(true)}>
              Save local override
            </Button>
            {saved ? (
              <span className="saved-note">Saved as draft v{Number(skill.version.slice(1)) + 0.1}</span>
            ) : null}
          </div>
        </section>
        <aside className="detail-panel detail-contracts">
          <h3>Contract</h3>
          <div>
            <span>Input</span>
            <p>{skill.input}</p>
          </div>
          <div>
            <span>Output</span>
            <p>{skill.output}</p>
          </div>
          <div>
            <span>Success definition</span>
            <p>Output schema valid, required evidence recorded, and the owning deterministic gate passed.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

const agentProfiles = [
  {
    id: "triage-agent",
    name: "Triage agent",
    status: "Available",
    provider: "codex" as const,
    model: "Codex 1.2 Mini",
    fallback: "Claude 3.7 Haiku",
    reasoning: "Medium",
    skills: ["triage", "domain-modeling"],
    runs: 24,
    success: "97%",
    avgCost: "$0.09",
    mission:
      "Verify and classify work, then produce a concise brief without changing tracker state before human confirmation.",
  },
  {
    id: "research-agent",
    name: "Repository research agent",
    status: "Available",
    provider: "codex" as const,
    model: "Codex 1.2 Mini",
    fallback: "Claude 3.7 Haiku",
    reasoning: "Medium",
    skills: ["research", "codebase-design"],
    runs: 18,
    success: "99%",
    avgCost: "$0.16",
    mission:
      "Collect primary-source facts from code, docs, history, and tests. Never turn a missing fact into a question for the user.",
  },
  {
    id: "clarification-agent",
    name: "Clarification agent",
    status: "Waiting on GH-235",
    provider: "claude" as const,
    model: "Claude 3.7 Sonnet",
    fallback: "Codex 1.2",
    reasoning: "High",
    skills: ["grill-with-docs", "domain-modeling"],
    runs: 9,
    success: "94%",
    avgCost: "$0.24",
    mission:
      "Walk the decision tree one question at a time, recommend an answer, and persist settled vocabulary without over-producing ADRs.",
  },
  {
    id: "implementation-agent",
    name: "Implementation agent",
    status: "Running GH-241",
    provider: "codex" as const,
    model: "Codex 1.2",
    fallback: "Claude 3.7 Sonnet",
    reasoning: "High",
    skills: ["implement", "tdd"],
    runs: 12,
    success: "92%",
    avgCost: "$0.78",
    mission:
      "Execute only approved tickets through vertical red-green slices at the seams agreed in the specification.",
  },
  {
    id: "standards-reviewer",
    name: "Standards reviewer",
    status: "Available",
    provider: "codex" as const,
    model: "Codex 1.2",
    fallback: "Claude 3.7 Sonnet",
    reasoning: "High",
    skills: ["code-review"],
    runs: 14,
    success: "98%",
    avgCost: "$0.39",
    mission:
      "Review a pinned diff only against documented repository standards and the explicit smell baseline.",
  },
  {
    id: "spec-reviewer",
    name: "Spec reviewer",
    status: "Available",
    provider: "claude" as const,
    model: "Claude 3.7 Sonnet",
    fallback: "Codex 1.2",
    reasoning: "High",
    skills: ["code-review"],
    runs: 14,
    success: "96%",
    avgCost: "$0.46",
    mission:
      "Review the same pinned diff only against the originating spec, keeping findings separate from standards review.",
  },
] as const;

export function AgentsScreen() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = agentProfiles.find((agent) => agent.id === selectedId);
  if (selected) return <AgentDetail key={selected.id} agent={selected} onBack={() => setSelectedId(null)} />;
  return (
    <div className="page library-page">
      <SectionHeader
        eyebrow="Execution roster"
        title="Agents"
        description="Agents are configurable roles that combine one or more skills with a primary model, fallback, and reasoning policy."
      />
      <div className="agent-grid">
        {agentProfiles.map((agent) => (
          <button
            className="agent-panel"
            type="button"
            key={agent.id}
            onClick={() => setSelectedId(agent.id)}
          >
            <div className="agent-panel__head">
              <span className={`agent-icon agent-icon--${agent.provider}`}>
                <Robot size={22} />
              </span>
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.status}</small>
              </span>
              <ArrowRight size={16} />
            </div>
            <dl>
              <div>
                <dt>Primary model</dt>
                <dd>
                  <ProviderTag provider={agent.provider} model={agent.model} />
                </dd>
              </div>
              <div>
                <dt>Skills</dt>
                <dd>{agent.skills.join(" · ")}</dd>
              </div>
              <div>
                <dt>Reasoning</dt>
                <dd>{agent.reasoning}</dd>
              </div>
              <div>
                <dt>Success / avg. cost</dt>
                <dd>
                  {agent.success} · {agent.avgCost}
                </dd>
              </div>
            </dl>
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentDetail({ agent, onBack }: { agent: (typeof agentProfiles)[number]; onBack: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="page library-page detail-page">
      <button type="button" className="detail-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Agents
      </button>
      <SectionHeader
        eyebrow="Agent profile"
        title={agent.name}
        description={agent.mission}
        action={<span className="badge badge--success">Enabled</span>}
      />
      <div className="detail-metrics">
        <Metric icon={TerminalWindow} label="Runs today" value={String(agent.runs)} />
        <Metric icon={CheckCircle} label="Successful gates" value={agent.success} />
        <Metric icon={CurrencyDollar} label="Average cost" value={agent.avgCost} />
        <Metric icon={Code} label="Skills" value={agent.skills.join(" + ")} />
      </div>
      <div className="detail-grid">
        <section className="detail-panel agent-config-panel">
          <h3>Execution policy</h3>
          <div className="agent-config-grid">
            <label className="field">
              <span>Primary model</span>
              <select defaultValue={agent.model} onChange={() => setSaved(false)}>
                <option>Codex 1.2</option>
                <option>Codex 1.2 Mini</option>
                <option>Claude 3.7 Sonnet</option>
                <option>Claude 3.7 Haiku</option>
              </select>
            </label>
            <label className="field">
              <span>Fallback model</span>
              <select defaultValue={agent.fallback} onChange={() => setSaved(false)}>
                <option>Codex 1.2</option>
                <option>Codex 1.2 Mini</option>
                <option>Claude 3.7 Sonnet</option>
                <option>Claude 3.7 Haiku</option>
                <option>Pause and ask human</option>
              </select>
            </label>
            <label className="field">
              <span>Reasoning</span>
              <select defaultValue={agent.reasoning} onChange={() => setSaved(false)}>
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </label>
            <label className="field">
              <span>Maximum stage runs</span>
              <select defaultValue="3" onChange={() => setSaved(false)}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="5">5</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>Role instructions</span>
            <textarea defaultValue={agent.mission} rows={6} onChange={() => setSaved(false)} />
          </label>
          <div className="detail-panel__actions">
            <Button tone="primary" icon={FloppyDisk} onClick={() => setSaved(true)}>
              Save agent profile
            </Button>
            {saved ? <span className="saved-note">Agent profile saved locally</span> : null}
          </div>
        </section>
        <aside className="detail-panel detail-contracts">
          <h3>Assignment boundary</h3>
          <div>
            <span>Skills</span>
            <p>{agent.skills.join(", ")}</p>
          </div>
          <div>
            <span>Model ownership</span>
            <p>This profile chooses the model. Tasks never override it globally.</p>
          </div>
          <div>
            <span>Run policy</span>
            <p>Each stage run is counted independently. Exhaustion pauses only the owning stage.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Code; label: string; value: string }) {
  return (
    <div>
      <span>
        <Icon size={16} /> {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

export function SettingsScreen() {
  return (
    <div className="page library-page settings-page">
      <SectionHeader
        eyebrow="Local orchestration"
        title="Settings"
        description="Repository-wide deterministic policy. Model routing lives with each agent profile."
      />
      <section className="settings-section">
        <h3>Workflow policy</h3>
        <SettingRow
          title="Default workflow"
          copy="Investigate + Implement"
          control={
            <select aria-label="Default workflow">
              <option>Investigate + Implement</option>
              <option>Investigate only</option>
            </select>
          }
        />
        <SettingRow
          title="Maximum stage runs"
          copy="Default repair limit per agent-owned stage"
          control={
            <select aria-label="Maximum stage runs">
              <option>3 runs</option>
              <option>5 runs</option>
            </select>
          }
        />
        <SettingRow
          title="Require human final approval"
          copy="Never publish without a person"
          control={<Toggle checked label="Require human final approval" />}
        />
      </section>
      <section className="settings-section">
        <h3>Cost estimates</h3>
        <SettingRow
          title="Show approximate cost"
          copy="Derived from configured model input, output, and cached-token rates"
          control={<Toggle checked label="Show approximate cost" />}
        />
        <SettingRow
          title="Currency"
          copy="Display currency for local estimates"
          control={
            <select aria-label="Cost currency">
              <option>USD</option>
              <option>NZD</option>
            </select>
          }
        />
      </section>
      <section className="settings-section">
        <h3>Local environment</h3>
        <SettingRow
          title="Repository root"
          copy="Validated before each run"
          control={<code>C:\Users\nimbl\projects\goose-hub</code>}
        />
        <SettingRow
          title="Worktree root"
          copy="Ephemeral isolated changes"
          control={<code>.worktrees/</code>}
        />
      </section>
    </div>
  );
}

function Toggle({ checked, label }: { checked: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "toggle--on" : ""}`}
    >
      <span />
    </button>
  );
}

function SettingRow({ title, copy, control }: { title: string; copy: string; control: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span>
        <strong>{title}</strong>
        <small>{copy}</small>
      </span>
      <div>{control}</div>
    </div>
  );
}
