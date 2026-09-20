import type { RuntimeProject } from "../../domain.ts";
import { assignSlots, projectKey, isProjectSlot, type SlotAssignments } from "./colony.ts";

/** Four crowns on the shared hex shell; the archipelago kit behind the colony flag knows only the last three. */
export const baseVariants = ["bastion", "command", "relay", "foundry"] as const;
export type BaseVariant = (typeof baseVariants)[number];
export const legacyBaseVariants = ["command", "relay", "foundry"] as const;
export type LegacyBaseVariant = (typeof legacyBaseVariants)[number];
/** The archipelago has no hex Bastion; a Bastion project renders its Command building there. */
export function legacyVariant(variant: BaseVariant): LegacyBaseVariant {
  return variant === "bastion" ? "command" : variant;
}
/**
 * `color` is the daylight surface tint and the HUD swatch. `light` is what the base emits after dark,
 * and it is a separate, far more saturated value on purpose: emissive is multiplied by an intensity
 * near 3, so a pastel clips channel by channel toward white and loses its hue. At that gain #3f9dff
 * reads lavender, #ee625d reads orange and #ffa64d reads yellow -- the colour has to start deep to
 * survive being that bright.
 */
export const basePalettes = {
  blue: { label: "Blue", color: "#3f9dff", light: "#0038ff" },
  red: { label: "Red", color: "#ee625d", light: "#e00016" },
  orange: { label: "Orange", color: "#ffa64d", light: "#ff5c00" },
  purple: { label: "Purple", color: "#b685ff", light: "#6600cc" },
} as const;
export type BasePalette = keyof typeof basePalettes;
export const baseNames: Record<BaseVariant, string> = {
  bastion: "Bastion",
  command: "Command",
  relay: "Relay",
  foundry: "Foundry",
};
export interface BaseAppearance {
  variant: BaseVariant;
  palette: BasePalette;
  /** Colony slot (P1..P18). Persisted with the appearance so a base never moves once placed. */
  slot?: string;
}
export type BaseAppearances = Record<string, BaseAppearance>;
export const appearanceStorageKey = "mission-frontier.3d-project-appearance.v1";
export const projectAppearanceKey = projectKey;
export function parseAppearances(value: unknown): BaseAppearances {
  const data = value as { version?: number; projects?: unknown } | null;
  if (data?.version !== 1 || !data.projects || typeof data.projects !== "object") return {};
  const result: BaseAppearances = {};
  for (const [key, candidate] of Object.entries(data.projects)) {
    const entry = candidate as Partial<BaseAppearance> | null;
    if (
      entry &&
      baseVariants.includes(entry.variant as BaseVariant) &&
      Object.hasOwn(basePalettes, entry.palette ?? "")
    )
      result[key] = {
        variant: entry.variant as BaseVariant,
        palette: entry.palette as BasePalette,
        ...(typeof entry.slot === "string" && isProjectSlot(entry.slot) ? { slot: entry.slot } : {}),
      };
  }
  return result;
}
/** Slot assignments already recorded, including those of projects no longer listed. */
export function savedSlots(appearances: BaseAppearances): SlotAssignments {
  const result: SlotAssignments = {};
  for (const [key, appearance] of Object.entries(appearances))
    if (appearance.slot) result[key] = appearance.slot;
  return result;
}
export function readAppearances(storage: Pick<Storage, "getItem">): BaseAppearances {
  try {
    return parseAppearances(JSON.parse(storage.getItem(appearanceStorageKey) ?? "null"));
  } catch {
    return {};
  }
}
function hash(value: string) {
  let n = 2166136261;
  for (const char of value) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return n >>> 0;
}
// Stable pseudorandom defaults are immediately usable even when browser storage is unavailable.
export function defaultAppearance(project: RuntimeProject): BaseAppearance {
  const n = hash(projectAppearanceKey(project));
  const palettes = Object.keys(basePalettes) as BasePalette[];
  return {
    variant: baseVariants[n % baseVariants.length] ?? "command",
    palette: palettes[(n >>> 8) % palettes.length] ?? "blue",
  };
}
/** Fills in variant, palette and colony slot for projects that lack them; saved values never change. */
export function assignMissingAppearances(projects: RuntimeProject[], saved: BaseAppearances) {
  const result = { ...saved };
  const slots = assignSlots(projects, savedSlots(saved));
  const counts = Object.fromEntries(baseVariants.map((variant) => [variant, 0])) as Record<
    BaseVariant,
    number
  >;
  for (const project of projects) {
    const value = saved[projectAppearanceKey(project)];
    if (value) counts[value.variant]++;
  }
  for (const project of [...projects].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = projectAppearanceKey(project);
    const existing = result[key];
    if (existing) {
      if (slots[key] && existing.slot !== slots[key]) result[key] = { ...existing, slot: slots[key] };
      continue;
    }
    const fallback = defaultAppearance(project);
    const least = Math.min(...Object.values(counts));
    const available = baseVariants.filter((variant) => counts[variant] === least);
    const variant = available[hash(key) % available.length] ?? "command";
    result[key] = { ...fallback, variant, ...(slots[key] ? { slot: slots[key] } : {}) };
    counts[variant]++;
  }
  return result;
}
export function appearanceComplete(appearance: BaseAppearance | undefined): appearance is BaseAppearance {
  return Boolean(appearance?.slot);
}
export function saveAppearance(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  appearance: BaseAppearance,
) {
  const current = readAppearances(storage);
  // A colour or building choice never moves a base: the recorded slot survives the new choice.
  const slot = appearance.slot ?? current[key]?.slot;
  const next = {
    ...current,
    [key]: slot ? { ...appearance, slot } : { variant: appearance.variant, palette: appearance.palette },
  };
  storage.setItem(appearanceStorageKey, JSON.stringify({ version: 1, projects: next }));
  return next;
}
export function randomAppearance(random = Math.random): BaseAppearance {
  const palettes = Object.keys(basePalettes) as BasePalette[];
  return {
    variant:
      baseVariants[
        Math.min(baseVariants.length - 1, Math.max(0, Math.floor(random() * baseVariants.length)))
      ] ?? "command",
    palette: palettes[Math.min(3, Math.max(0, Math.floor(random() * palettes.length)))] ?? "blue",
  };
}
