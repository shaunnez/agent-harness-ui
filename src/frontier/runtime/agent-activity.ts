import type { RuntimeEvent, RuntimeRun, RuntimeToolCall } from "../../domain.ts";

export function runEvents(events: RuntimeEvent[], run: RuntimeRun | undefined) {
  if (!run) return [];
  return [
    ...new Map(
      events
        .filter((event) => event.runId === run.id || (!event.runId && event.stage === run.stage))
        .map((event) => [event.id, event]),
    ).values(),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
export function currentRecordedTool(run: RuntimeRun | undefined, events: RuntimeEvent[], active: boolean) {
  if (!run || !active) return undefined;
  const tools = new Map<string, RuntimeToolCall>();
  for (const tool of [
    ...run.toolCalls,
    ...events
      .filter((event) => event.runId === run.id)
      .flatMap((event) => (event.toolCall ? [event.toolCall] : [])),
  ]) {
    if (!tool.id) continue;
    // A retained terminal result wins over an out-of-order started observation.
    if (tools.get(tool.id)?.phase !== "completed") tools.set(tool.id, tool);
  }
  return [...tools.values()].reverse().find((tool) => tool.phase === "started");
}
export function eventAge(at: string | undefined, now: number) {
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return Math.max(0, now - Date.parse(at));
}
export function activityScroll({
  following,
  previousHeight,
  height,
  top,
  earlier,
}: {
  following: boolean;
  previousHeight: number;
  height: number;
  top: number;
  earlier: boolean;
}) {
  return following ? height : earlier ? top + Math.max(0, height - previousHeight) : top;
}
