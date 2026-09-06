export interface WorldPreferences {
  motion: boolean;
  labels: boolean;
  labelSize: "normal" | "large";
  cameraSensitivity: number;
  followSelection: boolean;
  ambientAudio: boolean;
  effectsAudio: boolean;
}
export const defaultPreferences: WorldPreferences = {
  motion: true,
  labels: true,
  labelSize: "normal",
  cameraSensitivity: 1,
  followSelection: false,
  ambientAudio: false,
  effectsAudio: false,
};
const key = "mission-frontier.preferences.v1";
export function readPreferences(): WorldPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return {
      ...defaultPreferences,
      motion: typeof value?.motion === "boolean" ? value.motion : true,
      labels: typeof value?.labels === "boolean" ? value.labels : true,
      labelSize: value?.labelSize === "large" ? "large" : "normal",
      cameraSensitivity:
        typeof value?.cameraSensitivity === "number" && Number.isFinite(value.cameraSensitivity)
          ? Math.max(0.5, Math.min(2, value.cameraSensitivity))
          : 1,
      followSelection: value?.followSelection === true,
      ambientAudio: value?.ambientAudio === true,
      effectsAudio: value?.effectsAudio === true,
    };
  } catch {
    return { ...defaultPreferences };
  }
}
export function savePreferences(value: WorldPreferences) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Device preferences remain usable in memory. */
  }
}
