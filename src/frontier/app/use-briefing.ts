import { useRef, useState } from "react";
import type { WorkspaceChange, WorkspaceHead } from "../../domain/workspace-history.ts";
import type { RefreshCoordinator } from "../runtime/coordinator.ts";
import { mergeHistory } from "../runtime/briefing.ts";
import type { Checkpoint } from "./command-memory.ts";

interface BriefingState {
  sourceId: string;
  from: Checkpoint;
  through: Checkpoint;
  items: WorkspaceChange[];
  cursor: string | null;
  loaded: boolean;
  loading: boolean;
  completeCoverage: boolean;
  coverageReason: string | null;
  error: string | null;
}
export function useBriefing(
  runtime: RefreshCoordinator,
  head: WorkspaceHead | null,
  checkpoint: Checkpoint | null,
) {
  const [state, setState] = useState<BriefingState | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const source = useRef(head?.sourceId);
  source.current = head?.sourceId;
  function commit(value: BriefingState | null) {
    latest.current = value;
    setState(value);
  }
  async function load(current: BriefingState) {
    if (latest.current?.loading || current.sourceId !== source.current) return;
    const pending = { ...current, loading: true, error: null };
    commit(pending);
    try {
      const page = await runtime.readHistory({
        sourceId: current.sourceId,
        after: current.from.sequence,
        through: current.through.sequence,
        cursor: current.cursor,
      });
      if (source.current !== current.sourceId || latest.current !== pending) return;
      commit({
        ...current,
        loading: false,
        loaded: true,
        items: mergeHistory(current.items, page),
        cursor: page.nextCursor,
        completeCoverage: current.completeCoverage && page.coverage.complete,
        coverageReason: page.coverage.reason ?? current.coverageReason,
      });
    } catch (error) {
      if (source.current === current.sourceId && latest.current === pending)
        commit({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "History could not be loaded.",
        });
    }
  }
  function begin() {
    if (!head?.available || !head.sourceId || !checkpoint) return;
    if (latest.current?.sourceId === head.sourceId) return;
    if (checkpoint.sequence > head.upper) return;
    const current: BriefingState = {
      sourceId: head.sourceId,
      from: checkpoint,
      through: { sequence: head.upper, at: head.capturedAt },
      items: [],
      cursor: null,
      loaded: false,
      loading: false,
      completeCoverage: true,
      coverageReason: null,
      error: null,
    };
    // An old source's pending page can finish, but can never overwrite this new interval.
    latest.current = null;
    void load(current);
  }
  return {
    state: state?.sourceId === head?.sourceId ? state : null,
    begin,
    more: () => {
      if (latest.current) void load(latest.current);
    },
    clear: () => commit(null),
  };
}
