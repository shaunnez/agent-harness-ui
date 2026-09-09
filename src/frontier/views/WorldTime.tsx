import { MoonStars, Sun, SunHorizon } from "@phosphor-icons/react";
import type { WorldPreferences } from "../app/preferences";
import { formatWorldHour, type WorldLighting } from "../world/environment-model";

export function WorldTime({
  lighting,
  preferences,
  moving,
  onSettings,
}: {
  lighting: WorldLighting;
  preferences: WorldPreferences;
  moving: boolean;
  onSettings(): void;
}) {
  const Icon = lighting.phase === "Night" ? MoonStars : lighting.phase === "Daylight" ? Sun : SunHorizon;
  return (
    <button
      type="button"
      className={`world-time panel phase-${lighting.phase.toLowerCase().replaceAll(" ", "-")}`}
      onClick={onSettings}
      aria-label={`World time: ${formatWorldHour(lighting.hour)}, ${lighting.phase}. Open lighting settings`}
    >
      <Icon size={24} weight="duotone" />
      <span>
        <small>
          World time ·{" "}
          {preferences.environment.mode === "fixed"
            ? "Fixed"
            : !moving
              ? "Motion paused"
              : `${preferences.environment.dayMinutes} min day`}
        </small>
        <strong>
          {formatWorldHour(lighting.hour)} <span>{lighting.phase}</span>
        </strong>
      </span>
    </button>
  );
}
