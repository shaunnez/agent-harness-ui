import type { WorldPreferences } from "../app/preferences";
import { researchEngineLabel, researchEnginePlan } from "../runtime/research";
import type { ConsoleEngine } from "./gateway";

/**
 * Settings → Research, in the console. The engine is not a choice here: the research service runs
 * DeepSeek on the US-hosted provider its configuration names, and refuses any other, so this only
 * says what it is. The world's display preferences stay in this browser.
 */
export function ConsoleSettings({
  mode,
  engine,
  preferences,
  onPreferences,
}: {
  mode: "fixture" | "live";
  engine: ConsoleEngine | null;
  preferences: WorldPreferences;
  onPreferences(value: WorldPreferences): void;
}) {
  return (
    <div className="overlay-body">
      <section className="workflow-card">
        <h3>Research agent</h3>
        <p className="quiet">
          Every question runs on the research service's configured engine. It is set where the service is
          deployed, not here, and a run on any provider outside the US is refused.
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
