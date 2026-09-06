import { ArrowRight, BookOpen, Code, LockSimple } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { agentRoles, policyIdForRole } from "../../components/AgentRoles";
import type {
  RuntimeAgentPolicy,
  RuntimeSettings,
  RuntimeStatus,
  StageId,
  WorkflowProfileId,
} from "../../domain";
import { usePanelState } from "../app/panel-state";
import type { FrontierGateway, TaskSummary } from "../runtime/contracts";
import { settingsInput, settingsIssue } from "../runtime/settings";
import { PolicyChoice } from "./PolicyMatrix";

const purposes: Record<string, string> = {
  triage: "Classify scope and risk, then select the fact-finding scouts needed for the task.",
  scouts:
    "Gather repository facts with selected code path, dependency, pattern, schema, test inventory and user journey scouts.",
  grill: "Resolve low-risk details and bring consequential product decisions to the operator.",
  specification: "Turn repository evidence and recorded decisions into scoped acceptance criteria.",
  plan: "Define isolated work packages, owned paths, dependencies and verification commands.",
  implement: "Produce and qualify a scoped change in an isolated worktree, then assemble a candidate.",
  repair: "Repair the retained candidate and create a new revision for downstream gates.",
  "dev-review": "Inspect the exact candidate, returning structured findings and a recorded gate verdict.",
  test: "Interpret repository verification already executed by the harness against the candidate.",
  "final-review": "Review the complete recorded journey and exact tested candidate before human approval.",
  approval:
    "Record explicit operator approval and publish the exact candidate through the GitHub delivery boundary.",
};
export function Skills({
  initialRole,
  status,
  tasks,
  gateway,
  connected,
  busy,
  error,
  command,
  onSettings,
  onTask,
}: {
  initialRole?: string;
  status: RuntimeStatus | null;
  tasks: TaskSummary[];
  gateway: FrontierGateway;
  connected: boolean;
  busy: boolean;
  error: string | null;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
  onSettings(): void;
  onTask(id: string): void;
}) {
  const [selection, select] = usePanelState(`skill:${initialRole ?? "all"}`, initialRole ?? "implement");
  const [query, setQuery] = useState("");
  const selected = agentRoles.find((role) => role.id === selection) ?? agentRoles[0];
  if (!selected) return <p>No runtime roles are defined.</p>;
  const policyRole = policyIdForRole(selected.id);
  const stage = (policyRole === "repair" ? "implement" : policyRole) as StageId;
  const recent = tasks.filter(
    (task) =>
      (task.attemptsByStage[stage] ?? 0) > 0 ||
      task.runs?.some((run) => run.stage === stage) ||
      (task.currentStage === stage && Boolean(task.activeRunIds?.length)) ||
      task.artifacts.some((artifact) => artifact.stage === policyRole),
  );
  return (
    <div className="overlay-body skills-layout">
      <nav className="skill-navigation" aria-label="Skill catalogue">
        <input
          aria-label="Search skills"
          placeholder="Search skills and roles"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {agentRoles
          .filter((role) => !role.parentId)
          .filter((role) => `${role.label} ${role.skill}`.toLowerCase().includes(query.toLowerCase()))
          .map((role) => (
            <button
              type="button"
              key={role.id}
              className={role.id === selected.id || role.id === selected.parentId ? "selected" : ""}
              onClick={() => select(role.id)}
            >
              <Code size={19} />
              <span>
                {role.label}
                <small>{role.skill}</small>
              </span>
            </button>
          ))}
      </nav>
      <section className="skill-detail">
        <header>
          <img src="/assets/mf.worker.standard.portrait.r1.png" alt="" />
          <span className="eyebrow">Runtime capability</span>
          <h2>{selected.label}</h2>
          <code>{selected.skill}</code>
        </header>
        <p>{purposes[policyRole]}</p>
        <dl className="contract-facts">
          <dt>Inputs</dt>
          <dd>
            {["implement", "repair", "dev-review", "test", "final-review", "approval"].includes(policyRole)
              ? "Approved task context, work packages and exact candidate identity"
              : "Task brief, repository authority and retained upstream evidence"}
          </dd>
          <dt>Outputs</dt>
          <dd>
            {policyRole === "approval"
              ? "Operator approval and retained PR identity"
              : "Recorded run and durable artifact with policy, usage and supplied-context manifest"}
          </dd>
          <dt>Execution boundary</dt>
          <dd>
            {["implement", "repair"].includes(policyRole)
              ? "Writes confined to an isolated task worktree"
              : policyRole === "approval"
                ? "Deterministic operator action; no model"
                : policyRole === "test"
                  ? "Harness verification in the candidate; the exact candidate must remain clean"
                  : "Read-only repository access"}
          </dd>
          <dt>Policy scope</dt>
          <dd>
            {selected.parentId
              ? "This scout uses the shared Repository scouts policy."
              : "Per role and workflow profile, copied into new tasks."}
          </dd>
        </dl>
        <SkillSource key={selected.id} role={selected.id} />
        <section>
          <h3>Tasks with recorded stage evidence</h3>
          {recent.slice(0, 8).map((task) => (
            <button type="button" className="text-row" key={task.id} onClick={() => onTask(task.id)}>
              <span>
                <strong>
                  {task.id} · {task.title}
                </strong>
                <small>{task.status}</small>
              </span>
              <ArrowRight size={17} />
            </button>
          ))}
          {!recent.length && (
            <p className="quiet">No recorded stage evidence in the retrieved task summaries.</p>
          )}
          <small>Open a task for the exact role and run history.</small>
        </section>
      </section>
      <aside className="record-inspector">
        <h2>Policy for new tasks</h2>
        {selected.provider === "harness" ? (
          <p>Human approval is a deterministic gate. It does not use a model.</p>
        ) : status?.settings ? (
          <RoleDefault
            key={policyRole}
            role={policyRole}
            status={status}
            settings={status.settings}
            gateway={gateway}
            busy={busy}
            connected={connected}
            command={command}
          />
        ) : (
          <p>Runtime settings are unavailable.</p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button type="button" className="wide-button" onClick={onSettings}>
          All execution settings
        </button>
        <p className="quiet">
          Started runs retain their recorded configuration. To change a task's future roles, open its Role
          policies panel.
        </p>
      </aside>
    </div>
  );
}
function RoleDefault({
  role,
  status,
  settings,
  gateway,
  busy,
  connected,
  command,
}: {
  role: string;
  status: RuntimeStatus;
  settings: RuntimeSettings;
  gateway: FrontierGateway;
  busy: boolean;
  connected: boolean;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
}) {
  const [profile, setProfile] = useState<WorkflowProfileId>("standard");
  return (
    <>
      <label className="field">
        Profile
        <select value={profile} onChange={(event) => setProfile(event.target.value as WorkflowProfileId)}>
          <option value="fast">Fast</option>
          <option value="standard">Standard</option>
          <option value="high-risk">High risk</option>
        </select>
      </label>
      <RoleDefaultForm
        key={profile}
        {...{ role, status, settings, gateway, busy, connected, command, profile }}
      />
    </>
  );
}
function RoleDefaultForm({
  role,
  status,
  settings,
  gateway,
  busy,
  connected,
  command,
  profile,
}: Parameters<typeof RoleDefault>[0] & { profile: WorkflowProfileId }) {
  const original = settingsInput(settings);
  const inherited = original.profileStagePolicies[profile][role] ??
    original.stagePolicies[role] ?? { model: original.defaultModel, reasoning: original.defaultReasoning };
  const [policy, setPolicy] = useState<RuntimeAgentPolicy>(inherited);
  const [baseline, setBaseline] = useState(JSON.stringify(original));
  const [saved, setSaved] = useState(false);
  const matrices = {
    ...original.profileStagePolicies,
    [profile]: { ...original.profileStagePolicies[profile], [role]: policy },
  };
  const draft = { ...original, stagePolicies: matrices.standard, profileStagePolicies: matrices };
  const stale = baseline !== JSON.stringify(original);
  const issue = settingsIssue(draft, status);
  return (
    <>
      <div className="role-policy-choice">
        <PolicyChoice
          label="Role default"
          value={policy}
          status={status}
          disabled={busy}
          onChange={(value) => {
            setPolicy(value);
            setSaved(false);
          }}
        />
      </div>
      {issue && <p>{issue}</p>}
      {stale && <p role="alert">Defaults changed. Load the current policy before saving.</p>}
      <p className="quiet">Applies only to new {profile} tasks created after saving.</p>
      <button
        type="button"
        className="primary wide-button"
        disabled={
          busy ||
          !connected ||
          stale ||
          Boolean(issue) ||
          JSON.stringify(policy) === JSON.stringify(inherited)
        }
        onClick={() =>
          void command(async () => {
            const next = await gateway.saveSettings(draft);
            setBaseline(JSON.stringify(settingsInput(next)));
            setSaved(true);
          })
        }
      >
        Save default
      </button>
      <button
        type="button"
        className="wide-button"
        onClick={() => {
          setPolicy(inherited);
          setBaseline(JSON.stringify(original));
          setSaved(false);
        }}
      >
        Load current policy
      </button>
      {saved && <p role="status">Default saved.</p>}
    </>
  );
}
function SkillSource({ role }: { role: string }) {
  const [open, setOpen] = useState(false),
    [source, setSource] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const scout = role === "scouts" || role.startsWith("scout-");
  const path = scout
    ? "server/scouts.mjs"
    : role === "approval"
      ? "server/orchestrator-pr-lifecycle.mjs"
      : "server/prompts.mjs";
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const request = scout
      ? import("../../../server/scouts.mjs?raw")
      : role === "approval"
        ? import("../../../server/orchestrator-pr-lifecycle.mjs?raw")
        : import("../../../server/prompts.mjs?raw");
    request
      .then((module) => {
        if (!disposed) setSource(module.default);
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      });
    return () => {
      disposed = true;
    };
  }, [open, scout, role]);
  return (
    <section className="skill-source">
      <h3>
        <BookOpen size={20} /> Skill instructions <LockSimple size={16} />
      </h3>
      <p>
        Read-only source from this frontend build: <code>{path}</code>. Historical artifacts retain their
        supplied-context manifest.
      </p>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Close source" : "View source instructions"}
      </button>
      {open && <pre>{error ?? source ?? "Loading source…"}</pre>}
    </section>
  );
}
