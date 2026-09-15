import type { RuntimeProject } from "../../domain.ts";

export const baseVariants = ["command", "relay", "foundry"] as const;
export type BaseVariant = (typeof baseVariants)[number];
export const basePalettes = {
  blue: { label: "Blue", color: "#3f9dff" },
  red: { label: "Red", color: "#ee625d" },
  orange: { label: "Orange", color: "#ffa64d" },
  purple: { label: "Purple", color: "#b685ff" },
} as const;
export type BasePalette = keyof typeof basePalettes;
export const baseNames: Record<BaseVariant, string> = {
  command: "Command",
  relay: "Relay",
  foundry: "Foundry",
};
export interface BaseAppearance {
  variant: BaseVariant;
  palette: BasePalette;
}
export type BaseAppearances = Record<string, BaseAppearance>;
export const appearanceStorageKey = "mission-frontier.3d-project-appearance.v1";
export function projectAppearanceKey(project: Pick<RuntimeProject, "id" | "repositoryPath">) {
  return `${project.id}:${project.repositoryPath}`;
}
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
      result[key] = { variant: entry.variant as BaseVariant, palette: entry.palette as BasePalette };
  }
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
export function assignMissingAppearances(projects: RuntimeProject[], saved: BaseAppearances) {
  const result = { ...saved };
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
    if (result[key]) continue;
    const fallback = defaultAppearance(project);
    const least = Math.min(...Object.values(counts));
    const available = baseVariants.filter((variant) => counts[variant] === least);
    const variant = available[hash(key) % available.length] ?? "command";
    result[key] = { ...fallback, variant };
    counts[variant]++;
  }
  return result;
}
export function saveAppearance(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  appearance: BaseAppearance,
) {
  const current = readAppearances(storage);
  const next = { ...current, [key]: appearance };
  storage.setItem(appearanceStorageKey, JSON.stringify({ version: 1, projects: next }));
  return next;
}
export function randomAppearance(random = Math.random): BaseAppearance {
  const palettes = Object.keys(basePalettes) as BasePalette[];
  return {
    variant: baseVariants[Math.min(2, Math.max(0, Math.floor(random() * baseVariants.length)))] ?? "command",
    palette: palettes[Math.min(3, Math.max(0, Math.floor(random() * palettes.length)))] ?? "blue",
  };
}
