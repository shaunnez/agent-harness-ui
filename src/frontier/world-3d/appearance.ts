import type { RuntimeProject } from "../../domain.ts";
import { assignSlots, isProjectSlot, projectKey, type SlotAssignments } from "./colony.ts";

/** Four crowns on the shared hex shell. */
export const baseVariants = ["bastion", "command", "relay", "foundry"] as const;
export type BaseVariant = (typeof baseVariants)[number];
/** Retained only by the manifest schema check: the published manifest still carries the old kit. */
export const legacyBaseVariants = ["command", "relay", "foundry"] as const;
export type LegacyBaseVariant = (typeof legacyBaseVariants)[number];
/**
 * `color` is the daylight surface tint and the HUD swatch. `light` is what the base emits after dark,
 * and it is a separate, far more saturated value on purpose: emissive is multiplied by an intensity
 * near 3, so a pastel clips channel by channel toward white and loses its hue. At that gain #3f9dff
 * reads lavender, #ee625d reads orange and #ffa64d reads yellow -- the colour has to start deep to
 * survive being that bright.
 */
export const basePalettes = {
  blue: { label: "Blue", color: "#3f9dff", light: "#0038ff", glow: 1 },
  red: { label: "Red", color: "#ee625d", light: "#e00016", glow: 1 },
  orange: { label: "Orange", color: "#ffa64d", light: "#ff5c00", glow: 1 },
  purple: { label: "Purple", color: "#b685ff", light: "#6600cc", glow: 1 },
  // Research bases: fully saturated surfaces and a stronger identity glow, so a research base is
  // told apart from a delivery base at a glance.
  green: { label: "Green", color: "#2ee65c", light: "#00b52e", glow: 1.7 },
  pink: { label: "Pink", color: "#ff5fb8", light: "#e0007a", glow: 1.7 },
  silver: { label: "Silver", color: "#dfe6ec", light: "#7f93a8", glow: 1.5 },
  // Black by day; after dark it glows a deep purple, so the base still reads at night.
  black: { label: "Black", color: "#24123a", light: "#4b0a8c", glow: 1.7 },
} as const;
export type BasePalette = keyof typeof basePalettes;
export type ProjectKind = NonNullable<RuntimeProject["kind"]>;
/** Relay is kept for research projects; delivery projects choose among the other three. */
export const researchBaseVariant: BaseVariant = "relay";
export const deliveryBaseVariants: readonly BaseVariant[] = ["bastion", "command", "foundry"];
export const deliveryPalettes: readonly BasePalette[] = ["blue", "red", "orange", "purple"];
export const researchPalettes: readonly BasePalette[] = ["green", "pink", "silver", "black"];
export function variantsFor(kind: ProjectKind | undefined): readonly BaseVariant[] {
  return kind === "research" ? [researchBaseVariant] : deliveryBaseVariants;
}
export function palettesFor(kind: ProjectKind | undefined): readonly BasePalette[] {
  return kind === "research" ? researchPalettes : deliveryPalettes;
}
/**
 * Keeps an appearance inside its project kind: research bases are always Relay in a research
 * colour, and delivery bases never are. A colour from the other set maps to the one at the same
 * position, so a correction keeps the project's place in the palette.
 */
export function fitAppearance(
  kind: ProjectKind | undefined,
  appearance: BaseAppearance,
  replacementVariant?: BaseVariant,
): BaseAppearance {
  const variants = variantsFor(kind);
  const palettes = palettesFor(kind);
  const variant = variants.includes(appearance.variant)
    ? appearance.variant
    : (replacementVariant ?? variants[0] ?? "command");
  const other = kind === "research" ? deliveryPalettes : researchPalettes;
  const palette = palettes.includes(appearance.palette)
    ? appearance.palette
    : (palettes[Math.max(0, other.indexOf(appearance.palette))] ?? palettes[0] ?? "blue");
  return variant === appearance.variant && palette === appearance.palette
    ? appearance
    : { ...appearance, variant, palette };
}
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
  const variants = variantsFor(project.kind);
  const palettes = palettesFor(project.kind);
  return {
    variant: variants[n % variants.length] ?? "command",
    palette: palettes[(n >>> 8) % palettes.length] ?? "blue",
  };
}
/**
 * Fills in variant, palette and colony slot for projects that lack them. Saved choices keep their
 * building and colour unless they break the project-kind rule (a delivery base saved as Relay
 * before Relay became research-only), which `fitAppearance` corrects.
 */
export function assignMissingAppearances(projects: RuntimeProject[], saved: BaseAppearances) {
  const result = { ...saved };
  const slots = assignSlots(projects, savedSlots(saved));
  const counts = Object.fromEntries(deliveryBaseVariants.map((variant) => [variant, 0])) as Record<
    BaseVariant,
    number
  >;
  const leastUsed = (key: string) => {
    const least = Math.min(...Object.values(counts));
    const available = deliveryBaseVariants.filter((variant) => counts[variant] === least);
    return available[hash(key) % available.length] ?? "command";
  };
  for (const project of projects) {
    const value = saved[projectAppearanceKey(project)];
    if (value && project.kind !== "research" && value.variant in counts) counts[value.variant]++;
  }
  for (const project of [...projects].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = projectAppearanceKey(project);
    const existing = result[key];
    if (existing) {
      const fitted = fitAppearance(
        project.kind,
        existing,
        project.kind === "research" ? undefined : leastUsed(key),
      );
      if (fitted !== existing && project.kind !== "research") counts[fitted.variant]++;
      result[key] = slots[key] && fitted.slot !== slots[key] ? { ...fitted, slot: slots[key] } : fitted;
      continue;
    }
    const fallback = defaultAppearance(project);
    const variant = project.kind === "research" ? researchBaseVariant : leastUsed(key);
    result[key] = { ...fallback, variant, ...(slots[key] ? { slot: slots[key] } : {}) };
    if (project.kind !== "research") counts[variant]++;
  }
  return result;
}
export function appearanceComplete(appearance: BaseAppearance | undefined): appearance is BaseAppearance {
  return Boolean(appearance?.slot);
}
/** Saved, placed, and within its project kind's buildings and colours. */
export function appearanceSettled(project: RuntimeProject, appearance: BaseAppearance | undefined) {
  return appearanceComplete(appearance) && fitAppearance(project.kind, appearance) === appearance;
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
export function randomAppearance(random = Math.random, kind?: ProjectKind): BaseAppearance {
  const variants = variantsFor(kind);
  const palettes = palettesFor(kind);
  const pick = <T>(items: readonly T[]) =>
    items[Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)))];
  return { variant: pick(variants) ?? "command", palette: pick(palettes) ?? "blue" };
}
