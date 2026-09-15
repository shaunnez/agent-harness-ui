import type { WorkspaceHead } from "../../domain/workspace-history.ts";

export const commandMemoryKey = "mission-frontier.command-memory.v1";
export interface WatchPin {
  taskId: string;
  runId: string | null;
}
export interface Checkpoint {
  sequence: number;
  at: string;
}
export interface CommandMemory {
  checkpoint: Checkpoint | null;
  pins: WatchPin[];
}
export interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const pinKey = (pin: WatchPin) => `${pin.taskId}:${pin.runId ?? "task"}`;
const empty = (): CommandMemory => ({ checkpoint: null, pins: [] });
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

function readRegistry(storage: MemoryStorage | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(commandMemoryKey) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
export function readCommandMemory(storage: MemoryStorage | null, source: string): CommandMemory {
  const value = readRegistry(storage)[source];
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty();
  const stored = value as Partial<CommandMemory>;
  const point = stored.checkpoint;
  const checkpoint =
    point &&
    Number.isSafeInteger(point.sequence) &&
    point.sequence >= 0 &&
    typeof point.at === "string" &&
    Number.isFinite(Date.parse(point.at))
      ? point
      : null;
  const seen = new Set<string>();
  const pins = Array.isArray(stored.pins)
    ? stored.pins
        .filter((pin) => {
          if (
            !pin ||
            !validId(pin.taskId) ||
            !(pin.runId === null || validId(pin.runId)) ||
            seen.has(pinKey(pin))
          )
            return false;
          seen.add(pinKey(pin));
          return true;
        })
        .slice(0, 4)
        .map(({ taskId, runId }) => ({ taskId, runId }))
    : [];
  return { checkpoint, pins };
}
export function writeCommandMemory(
  storage: MemoryStorage | null,
  source: string,
  update: (latest: CommandMemory) => CommandMemory,
) {
  const next = update(readCommandMemory(storage, source));
  if (!storage) throw new Error("Browser storage is unavailable. This preference cannot be remembered.");
  const registry = readRegistry(storage);
  // Keep a bounded set of source namespaces. Always retain the currently used source.
  const entries = Object.entries(registry)
    .filter(([key]) => key !== source)
    .slice(-11);
  storage.setItem(commandMemoryKey, JSON.stringify({ ...Object.fromEntries(entries), [source]: next }));
  return next;
}
export function establishBaseline(storage: MemoryStorage | null, head: WorkspaceHead) {
  if (!head.available || !head.sourceId) return empty();
  const existing = readCommandMemory(storage, head.sourceId);
  if (existing.checkpoint) return existing;
  return writeCommandMemory(storage, head.sourceId, (current) => {
    if (current.checkpoint) return current;
    return { pins: current.pins, checkpoint: { sequence: head.upper, at: head.capturedAt } };
  });
}
export function toggleWatchPin(current: CommandMemory, pin: WatchPin): CommandMemory {
  const exists = current.pins.some((item) => pinKey(item) === pinKey(pin));
  if (!exists && current.pins.length >= 4)
    throw new Error("Four pins are already in use. Remove a pin before adding another.");
  return {
    ...current,
    pins: exists ? current.pins.filter((item) => pinKey(item) !== pinKey(pin)) : [...current.pins, pin],
  };
}
export function acknowledge(current: CommandMemory, point: Checkpoint): CommandMemory {
  if (
    current.checkpoint &&
    (current.checkpoint.sequence > point.sequence ||
      (current.checkpoint.sequence === point.sequence &&
        Date.parse(current.checkpoint.at) > Date.parse(point.at)))
  )
    return current;
  return { ...current, checkpoint: point };
}
