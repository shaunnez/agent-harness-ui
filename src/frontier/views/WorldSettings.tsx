import { useState } from "react";
import type { WorldPreferences } from "../app/preferences";
import type { FrontierGateway, FrontierSnapshot } from "../runtime/contracts";
import { EnvironmentSettings } from "./EnvironmentSettings";
import { RetainedWorktrees } from "./RetainedWorktrees";

export function WorldSettings({
  preferences,
  onChange,
  snapshot,
  mode,
  onRetry,
  gateway,
  connected,
  busy,
  error,
  command,
  onExecution,
  onAddProject,
  readWorldHour,
}: {
  preferences: WorldPreferences;
  onChange(value: WorldPreferences): void;
  snapshot: FrontierSnapshot;
  mode: "live" | "fixture";
  onRetry(): void;
  gateway: FrontierGateway;
  connected: boolean;
  busy: boolean;
  error: string | null;
  command(action: () => Promise<unknown>, then?: () => void): Promise<void>;
  onExecution(): void;
  onAddProject(): void;
  readWorldHour?(): number | undefined;
}) {
  const [tab, setTab] = useState("world");
  return (
    <div className="overlay-body execution-settings world-settings-layout">
      <nav className="settings-nav" aria-label="World settings sections">
        <button type="button" className={tab === "world" ? "selected" : ""} onClick={() => setTab("world")}>
          World & controls
        </button>
        <button
          type="button"
          className={tab === "connection" ? "selected" : ""}
          onClick={() => setTab("connection")}
        >
          Connection
        </button>
        <button
          type="button"
          className={tab === "storage" ? "selected" : ""}
          onClick={() => setTab("storage")}
        >
          Retained worktrees
        </button>
        <button type="button" onClick={onExecution}>
          Agent execution
        </button>
      </nav>
      <div className="settings-editor">
        <div className="settings-editor-scroll">
          {tab === "world" && (
            <>
              <h2>World & controls</h2>
              <p>Display choices save immediately on this device. They never pause backend execution.</p>
              <EnvironmentSettings
                preferences={preferences}
                onChange={onChange}
                readWorldHour={readWorldHour}
              />
              <div className="world-controls-columns">
                <section>
                  <label className="setting-row">
                    <span>
                      <strong>Camera sensitivity</strong>
                      <small>Drag and zoom response</small>
                    </span>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={preferences.cameraSensitivity}
                      onChange={(event) =>
                        onChange({ ...preferences, cameraSensitivity: Number(event.target.value) })
                      }
                    />
                    <output>{preferences.cameraSensitivity.toFixed(1)}×</output>
                  </label>
                  <Toggle
                    label="Follow selection"
                    detail="Centre the camera when selecting a task"
                    checked={preferences.followSelection}
                    onChange={(value) => onChange({ ...preferences, followSelection: value })}
                  />
                  <Toggle
                    label="World motion"
                    detail="System reduced motion is always respected"
                    checked={preferences.motion}
                    onChange={(value) => onChange({ ...preferences, motion: value })}
                  />
                  <Toggle
                    label="Ambient audio"
                    detail="Quiet local ambience; starts after interaction"
                    checked={preferences.ambientAudio}
                    onChange={(value) => onChange({ ...preferences, ambientAudio: value })}
                  />
                  <Toggle
                    label="Effects audio"
                    detail="Soft feedback when selecting objects"
                    checked={preferences.effectsAudio}
                    onChange={(value) => onChange({ ...preferences, effectsAudio: value })}
                  />
                  <Toggle
                    label="World labels"
                    detail="Task names remain available in the journal"
                    checked={preferences.labels}
                    onChange={(value) => onChange({ ...preferences, labels: value })}
                  />
                  <label className="setting-row">
                    <span>
                      <strong>Label size</strong>
                    </span>
                    <select
                      value={preferences.labelSize}
                      onChange={(event) =>
                        onChange({ ...preferences, labelSize: event.target.value as "normal" | "large" })
                      }
                    >
                      <option value="normal">Normal</option>
                      <option value="large">Large</option>
                    </select>
                  </label>
                </section>
                <aside className="world-preference-preview">
                  <img src="/assets/mf.ui.project-thumbnail.png" alt="Project base artwork" />
                  <strong>World preferences</strong>
                  <p>
                    Move around your projects with the mouse, keyboard or minimap. Opening a workspace
                    preserves the camera.
                  </p>
                </aside>
              </div>
              <section className="workflow-card">
                <h3>Keyboard & navigation</h3>
                <dl className="keyboard-guide">
                  <dt>Drag terrain / arrow keys</dt>
                  <dd>Pan</dd>
                  <dt>Scroll / + / −</dt>
                  <dd>Zoom</dd>
                  <dt>Space</dt>
                  <dd>Follow selected task</dd>
                  <dt>G · P · J or /</dt>
                  <dd>World · Projects · Tasks / search</dd>
                  <dt>A · K · U · comma</dt>
                  <dd>Agents · Skills · Usage · Settings</dd>
                  <dt>Escape</dt>
                  <dd>Return one panel, or clear world selection</dd>
                </dl>
              </section>
            </>
          )}
          {tab === "connection" && (
            <>
              <h2>Connection</h2>
              <p>Connect the local companion, register a repository, then create a task.</p>
              <dl className="contract-facts">
                <dt>Data source</dt>
                <dd>
                  {mode === "fixture"
                    ? "Sample world, held in this tab's memory"
                    : snapshot.status?.authMethod === "deterministic-fixture"
                      ? "Isolated deterministic API fixture"
                      : "Local Agent Harness runtime"}
                </dd>
                <dt>API reachability</dt>
                <dd>{snapshot.connection}</dd>
                <dt>Last successful refresh</dt>
                <dd>
                  {snapshot.updatedAt
                    ? new Date(snapshot.updatedAt).toLocaleString()
                    : "No successful refresh yet"}
                </dd>
                <dt>Execution</dt>
                <dd>{snapshot.status?.message ?? "Not yet retrieved"}</dd>
                <dt>Authentication method</dt>
                <dd>{snapshot.status?.authMethod ?? "Not reported"}</dd>
                <dt>Model catalogue</dt>
                <dd>{snapshot.status?.catalog?.source ?? "Unavailable"}</dd>
              </dl>
              {snapshot.error && (
                <p role="alert" className="form-error">
                  {snapshot.error}
                </p>
              )}
              {snapshot.status?.providers?.map((provider) => (
                <section className="workflow-card" key={provider.id}>
                  <h3>{provider.label}</h3>
                  <p>{provider.detail}</p>
                  <small>
                    Available: {provider.available ? "Yes" : "No"} · Authenticated:{" "}
                    {provider.authenticated ? "Yes" : "No"} · Execution enabled:{" "}
                    {provider.executionEnabled ? "Yes" : "No"}
                  </small>
                </section>
              ))}
              <div className="library-filters">
                <button type="button" className="primary" onClick={onRetry}>
                  Refresh connection
                </button>
                <button type="button" disabled={!connected} onClick={onAddProject}>
                  Add a project
                </button>
              </div>
              <p>
                When disconnected, task evidence and drafts remain visible. Refresh restores current state
                before enabling actions. Local Codex execution uses the existing ChatGPT-authenticated CLI.
              </p>
              <p>
                <a href={mode === "fixture" ? "/?mode=live#world" : "/?mode=fixture#world"}>
                  {mode === "fixture" ? "Open local runtime" : "Explore sample world"}
                </a>
              </p>
            </>
          )}
          {tab === "storage" && (
            <RetainedWorktrees
              tasks={snapshot.tasks}
              gateway={gateway}
              connected={connected}
              busy={busy}
              error={error}
              command={command}
            />
          )}
        </div>
        <p className="settings-local-note">
          World controls affect this browser only. Execution defaults are managed separately.
        </p>
      </div>
    </div>
  );
}
function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
