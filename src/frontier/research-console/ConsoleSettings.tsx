import { useState } from "react";
import type { WorldPreferences } from "../app/preferences";
import { researchEngineLabel, researchEnginePlan } from "../runtime/research";
import type { ConsoleEngine } from "./gateway";

/**
 * Settings → Research, in the console. The provider choice is saved on the research service;
 * its key stays in the service environment. The world's display preferences stay in this browser.
 */
export function ConsoleSettings({
  mode,
  engine,
  onSelectModel,
  preferences,
  onPreferences,
}: {
  mode: "fixture" | "live";
  engine: ConsoleEngine | null;
  onSelectModel(model: string): Promise<void>;
  preferences: WorldPreferences;
  onPreferences(value: WorldPreferences): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = draft ?? engine?.engine.model ?? "";
  const configured = engine?.models.find((entry) => entry.id === selected)?.configured ?? false;

  async function saveModel() {
    setSaving(true);
    setError(null);
    try {
      await onSelectModel(selected);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay-body">
      <section className="workflow-card">
        <h3>Research agent</h3>
        <p className="quiet">
          New questions use the selected DeepSeek provider. Questions already running keep their recorded
          model. Provider keys stay in the research service's environment.
        </p>
        <div className="design-policy-default">
          <h4>Engine</h4>
          <p>
            {engine
              ? `${researchEngineLabel(engine.engine)} · ${researchEnginePlan(engine.engine)}`
              : "Unknown until the service answers"}
          </p>
          <small>
            {engine
              ? `${engine.runsPerQuestion} run${engine.runsPerQuestion === 1 ? "" : "s"} per question from PlanCheck; the three closest are scored.`
              : null}
          </small>
        </div>
        {mode === "live" && engine && (
          <div className="design-policy-default">
            <label htmlFor="research-console-model">Provider for new questions</label>
            <select
              id="research-console-model"
              value={selected}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              disabled={saving}
            >
              {engine.models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                  {entry.configured ? "" : " · key missing"}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={saving || !configured || selected === engine.engine.model}
              onClick={() => void saveModel()}
            >
              {saving ? "Saving…" : "Use for new questions"}
            </button>
            {!configured && (
              <small>Add this provider's API key to the service environment, then restart the service.</small>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        )}
        {mode === "live" && engine?.pacing && (
          <div className="design-policy-default">
            <h4>Pacing</h4>
            <p>
              {engine.pacing.limit} run{engine.pacing.limit === 1 ? "" : "s"} at once now, between{" "}
              {engine.pacing.min} and {engine.pacing.max}
            </p>
            <small>
              Grows by one after a run of calls the provider accepts, halves when it throttles.{" "}
              {engine.pacing.throttles
                ? `Throttled ${engine.pacing.throttles} time${engine.pacing.throttles === 1 ? "" : "s"} since the service started.`
                : "Not throttled since the service started."}
              {engine.pacing.coolingDownMs
                ? ` Waiting ${Math.ceil(engine.pacing.coolingDownMs / 1000)} s.`
                : ""}
            </small>
          </div>
        )}
        {mode === "fixture" && (
          <p className="quiet">Sample research: the recorded questions, with nothing sent anywhere.</p>
        )}
      </section>
      <section className="workflow-card">
        <h3>World</h3>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={preferences.motion}
            onChange={(event) => onPreferences({ ...preferences, motion: event.target.checked })}
          />
          <span>Motion</span>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={preferences.labels}
            onChange={(event) => onPreferences({ ...preferences, labels: event.target.checked })}
          />
          <span>Base labels</span>
        </label>
      </section>
    </div>
  );
}
