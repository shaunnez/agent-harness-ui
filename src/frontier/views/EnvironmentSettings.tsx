import { MoonStars, Sun, SunHorizon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { WorldPreferences } from "../app/preferences";
import {
  changeEnvironment,
  type EnvironmentPreferences,
  formatWorldHour,
  worldHour,
} from "../world/environment-model";

export function EnvironmentSettings({
  preferences,
  onChange,
  readWorldHour,
}: {
  preferences: WorldPreferences;
  onChange(value: WorldPreferences): void;
  readWorldHour?(): number | undefined;
}) {
  const settings = preferences.environment;
  const change = (value: Partial<EnvironmentPreferences>) =>
    onChange({
      ...preferences,
      environment: changeEnvironment(settings, value, Date.now(), readWorldHour?.()),
    });
  const hour =
    settings.mode === "fixed" ? settings.hour : (readWorldHour?.() ?? worldHour(settings, Date.now()));
  return (
    <section className="environment-settings" aria-labelledby="environment-title">
      <div className="environment-heading">
        <div>
          <h3 id="environment-title">A world that never stands still</h3>
          <p>A full day in one hour by default. Choose the pace, or hold your favourite light.</p>
        </div>
        <span className="world-time-caption">Local world time</span>
      </div>
      <fieldset className="lighting-presets" aria-label="Lighting presets">
        {(
          [
            { label: "Dawn", hour: 6, Icon: SunHorizon },
            { label: "Daylight", hour: 12, Icon: Sun },
            { label: "Dusk", hour: 19.4, Icon: SunHorizon },
            { label: "Night", hour: 23, Icon: MoonStars },
          ] as const
        ).map(({ label, hour: time, Icon }) => (
          <button
            key={label}
            type="button"
            className={`lighting-preset preset-${label.toLowerCase()}`}
            aria-pressed={settings.mode === "fixed" && Math.abs(hour - time) < 0.05}
            onClick={() => change({ mode: "fixed", hour: time })}
          >
            <Icon size={24} weight="duotone" />
            <strong>{label}</strong>
            <small>{formatWorldHour(time)}</small>
          </button>
        ))}
      </fieldset>
      <div className="environment-fields">
        <label className="setting-row">
          <span>
            <strong>Lighting mode</strong>
            <small>Presets hold the light until you resume the cycle</small>
          </span>
          <select
            value={settings.mode}
            onChange={(event) => change({ mode: event.target.value as "cycle" | "fixed" })}
          >
            <option value="cycle">Day / night cycle</option>
            <option value="fixed">Fixed time</option>
          </select>
        </label>
        <label className="setting-row" htmlFor="world-day-minutes">
          <span>
            <strong>Length of a world day</strong>
            <small>Real minutes · 10 to 240</small>
          </span>
          <DayLength value={settings.dayMinutes} onChange={(dayMinutes) => change({ dayMinutes })} />
          <span>min</span>
        </label>
        <label className="setting-row time-scrubber">
          <span>
            <strong>Time of day</strong>
            <small>Scrub to choose a fixed light</small>
          </span>
          <input
            type="range"
            min="0"
            max="23.9"
            step="0.1"
            aria-label="Time of day"
            aria-valuetext={formatWorldHour(hour)}
            value={hour}
            onChange={(event) => change({ mode: "fixed", hour: Number(event.target.value) })}
          />
          <output>{formatWorldHour(hour)}</output>
        </label>
        <label className="setting-row">
          <span>
            <strong>Idle roaming</strong>
            <small>
              Unassigned base crew and explicitly idle workers. Waiting and blocked workers stay at their
              stations.
            </small>
          </span>
          <input
            type="checkbox"
            checked={preferences.idleRoaming}
            onChange={(event) => onChange({ ...preferences, idleRoaming: event.target.checked })}
          />
        </label>
      </div>
      <p className="environment-note">
        Roaming base crew are scenery. Work animations illustrate the recorded agent role; task status,
        progress and usage come from the runtime.
      </p>
    </section>
  );
}

function DayLength({ value, onChange }: { value: number; onChange(value: number): void }) {
  const [draft, setDraft] = useState(String(value));
  // Preserve partial keyboard edits; external preference changes replace the draft.
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type="number"
      id="world-day-minutes"
      min="10"
      max="240"
      step="1"
      aria-label="Length of a world day in minutes"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const next = event.target.valueAsNumber;
        if (Number.isFinite(next) && next >= 10 && next <= 240) onChange(next);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
