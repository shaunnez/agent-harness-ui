import type { RuntimePage } from "../../domain";

/** Refresh the leading page without discarding history the operator already requested. */
export function refreshPage<T extends { id: string }>(
  previous: RuntimePage<T> | undefined,
  latest: RuntimePage<T>,
): RuntimePage<T> {
  if (!previous || !latest.nextCursor) return latest;
  const freshIds = new Set(latest.items.map((item) => item.id));
  // Without overlap, use the new cursor so a burst of records cannot create a hidden gap.
  if (!previous.items.some((item) => freshIds.has(item.id))) return latest;
  return {
    ...latest,
    nextCursor: previous.nextCursor,
    items: [...latest.items, ...previous.items.filter((item) => !freshIds.has(item.id))],
  };
}
