export interface EnvironmentPreferences {
  mode: "cycle" | "fixed";
  dayMinutes: number;
  hour: number;
  anchorMs: number;
}

export const defaultEnvironment: EnvironmentPreferences = {
  mode: "cycle",
  dayMinutes: 60,
  hour: 9,
  anchorMs: 0,
};
export function wrapHour(hour: number) {
  return ((hour % 24) + 24) % 24;
}
export function normalizeEnvironment(value: unknown): EnvironmentPreferences {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const finite = (key: string, fallback: number) =>
    typeof data[key] === "number" && Number.isFinite(data[key]) ? data[key] : fallback;
  return {
    mode: data.mode === "fixed" ? "fixed" : "cycle",
    dayMinutes: Math.max(10, Math.min(240, finite("dayMinutes", 60))),
    hour: wrapHour(finite("hour", 9)),
    anchorMs: Math.max(0, Math.min(8.64e15, finite("anchorMs", 0))),
  };
}
export function worldHour(preferences: EnvironmentPreferences, now: number) {
  return wrapHour(
    preferences.hour +
      (preferences.mode === "cycle"
        ? ((now - preferences.anchorMs) / (preferences.dayMinutes * 60_000)) * 24
        : 0),
  );
}
/** Rebase speed/mode changes to the current hour rather than jumping the sun. */
export function changeEnvironment(
  preferences: EnvironmentPreferences,
  change: Partial<EnvironmentPreferences>,
  now: number,
  displayedHour = worldHour(preferences, now),
) {
  return normalizeEnvironment({ ...preferences, hour: displayedHour, ...change, anchorMs: now });
}
export function formatWorldHour(hour: number) {
  const minutes = Math.floor(wrapHour(hour) * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

type Color = readonly [number, number, number];
interface Keyframe {
  hour: number;
  land: Color;
  sea: Color;
  lamps: number;
}
const midnight: Keyframe = { hour: 0, land: [0.42, 0.5, 0.76], sea: [0.16, 0.26, 0.46], lamps: 1 };
const keys: Keyframe[] = [
  { hour: 0, land: [0.42, 0.5, 0.76], sea: [0.16, 0.26, 0.46], lamps: 1 },
  { hour: 4.5, land: [0.4, 0.49, 0.76], sea: [0.16, 0.27, 0.49], lamps: 1 },
  { hour: 5.5, land: [0.65, 0.54, 0.76], sea: [0.37, 0.3, 0.58], lamps: 0.85 },
  { hour: 7, land: [1, 0.84, 0.76], sea: [0.72, 0.68, 0.77], lamps: 0.14 },
  { hour: 9, land: [1, 1, 1], sea: [1, 1, 1], lamps: 0 },
  { hour: 15.5, land: [1, 1, 0.97], sea: [0.95, 0.97, 1], lamps: 0 },
  { hour: 17, land: [1, 0.83, 0.59], sea: [0.75, 0.67, 0.65], lamps: 0.12 },
  { hour: 18.5, land: [0.93, 0.59, 0.58], sea: [0.5, 0.33, 0.51], lamps: 0.48 },
  { hour: 19.5, land: [0.53, 0.43, 0.73], sea: [0.24, 0.22, 0.46], lamps: 0.82 },
  { hour: 21, land: [0.42, 0.5, 0.76], sea: [0.16, 0.26, 0.46], lamps: 1 },
  { hour: 24, land: [0.42, 0.5, 0.76], sea: [0.16, 0.26, 0.46], lamps: 1 },
];
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
function colorBetween(a: Color, b: Color, amount: number) {
  const rgb = a.map((channel, index) => Math.round(mix(channel, b[index] ?? channel, amount) * 255));
  return ((rgb[0] ?? 0) << 16) | ((rgb[1] ?? 0) << 8) | (rgb[2] ?? 0);
}
export function lightingAt(hour: number) {
  const value = wrapHour(hour);
  const index = keys.findIndex((key) => key.hour > value);
  const next = keys[index] ?? { ...midnight, hour: 24 };
  const prior = keys[Math.max(0, index - 1)] ?? midnight;
  const linear = (value - prior.hour) / (next.hour - prior.hour);
  const blend = linear * linear * (3 - 2 * linear);
  const phase =
    value < 5
      ? "Night"
      : value < 7.5
        ? "Dawn"
        : value < 16
          ? "Daylight"
          : value < 18
            ? "Golden hour"
            : value < 19
              ? "Sunset"
              : value < 21
                ? "Dusk"
                : "Night";
  return {
    hour: value,
    phase,
    land: colorBetween(prior.land, next.land, blend),
    sea: colorBetween(prior.sea, next.sea, blend),
    lamps: mix(prior.lamps, next.lamps, blend),
  };
}
export type WorldLighting = ReturnType<typeof lightingAt>;

/** Animation admission freezes the displayed light; explicit time changes still apply. */
export class LightingClock {
  private preferences = defaultEnvironment;
  private animate = false;
  private heldHour = 9;
  configure(preferences: EnvironmentPreferences, animate: boolean, now: number) {
    const changed = JSON.stringify(preferences) !== JSON.stringify(this.preferences);
    this.heldHour = changed ? worldHour(preferences, now) : this.hour(now);
    this.preferences = preferences;
    this.animate = animate;
  }
  hour(now: number) {
    return this.animate ? worldHour(this.preferences, now) : this.heldHour;
  }
}
