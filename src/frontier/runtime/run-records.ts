import { useEffect, useRef, useState } from "react";
import type { RuntimePage, RuntimeRun } from "../../domain";
import type { FrontierGateway, TaskSummary } from "./contracts";
import { errorMessage } from "./coordinator";
import { refreshPage } from "./pages";

export interface RunRecord {
  task: TaskSummary;
  run: RuntimeRun;
}
interface Entry {
  page?: RuntimePage<RuntimeRun>;
  error?: string;
}
/** Only retrieves the requested task window, with four concurrent reads and explicit history paging. */
export function useRunRecords(tasks: TaskSummary[], gateway: FrontierGateway, enabled = true) {
  const [limit, setLimit] = useState(12);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [loading, setLoading] = useState(false);
  const [attempt, retry] = useState(0);
  const generation = useRef(0);
  const paging = useRef(new Set<string>());
  const selected = tasks.slice(0, limit);
  const key = JSON.stringify(selected.map((task) => [task.id, task.pollVersion ?? task.updatedAt]));
  const latestTasks = useRef(selected);
  latestTasks.current = selected;
  // biome-ignore lint/correctness/useExhaustiveDependencies: The stable task-version key and explicit retry epoch start bounded retrieval without refetching on local state updates.
  useEffect(() => {
    const sequence = ++generation.current;
    if (!enabled) {
      setLoading(false);
      return;
    }
    const work = [...latestTasks.current];
    setLoading(true);
    const worker = async () => {
      while (work.length && generation.current === sequence) {
        const task = work.shift();
        if (!task) break;
        try {
          const page = await gateway.runs(task.id);
          if (generation.current === sequence)
            setEntries((previous) => ({
              ...previous,
              [task.id]: { page: refreshPage(previous[task.id]?.page, page) },
            }));
        } catch (error) {
          if (generation.current === sequence)
            setEntries((previous) => ({
              ...previous,
              [task.id]: { ...previous[task.id], error: errorMessage(error) },
            }));
        }
      }
    };
    Promise.all(Array.from({ length: Math.min(4, work.length) }, worker)).finally(() => {
      if (generation.current === sequence) setLoading(false);
    });
    return () => {
      generation.current++;
    };
  }, [gateway, key, enabled, attempt]);
  async function more(id: string) {
    const entry = entries[id];
    if (!entry?.page?.nextCursor || paging.current.has(id)) return;
    paging.current.add(id);
    const sequence = generation.current;
    try {
      const page = await gateway.runs(id, entry.page.nextCursor);
      if (sequence === generation.current)
        setEntries((previous) => {
          const items = new Map((previous[id]?.page?.items ?? []).map((run) => [run.id, run]));
          for (const run of page.items) items.set(run.id, run);
          return { ...previous, [id]: { page: { ...page, items: [...items.values()] } } };
        });
    } catch (error) {
      if (sequence === generation.current)
        setEntries((previous) => ({ ...previous, [id]: { ...previous[id], error: errorMessage(error) } }));
    } finally {
      paging.current.delete(id);
    }
  }
  const records: RunRecord[] = selected.flatMap((task) =>
    (entries[task.id]?.page?.items ?? []).map((run) => ({ task, run })),
  );
  return {
    records,
    loading,
    entries,
    selected,
    hasMoreTasks: tasks.length > limit,
    loadTasks: () => setLimit(limit + 12),
    more,
    retry: () => retry(attempt + 1),
  };
}
