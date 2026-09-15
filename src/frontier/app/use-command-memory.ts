import { useEffect, useState } from "react";
import type { WorkspaceHead } from "../../domain/workspace-history.ts";
import {
  acknowledge,
  commandMemoryKey,
  establishBaseline,
  readCommandMemory,
  toggleWatchPin,
  writeCommandMemory,
  type Checkpoint,
  type CommandMemory,
  type WatchPin,
} from "./command-memory.ts";

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
export function useCommandMemory(head: WorkspaceHead | null) {
  const source = head?.available ? head.sourceId : null;
  const [state, setState] = useState<{ source: string | null; value: CommandMemory; error: string | null }>({
    source: null,
    value: { checkpoint: null, pins: [] },
    error: null,
  });
  useEffect(() => {
    if (!source || !head) return;
    const refresh = () => {
      try {
        setState({ source, value: establishBaseline(browserStorage(), head), error: null });
      } catch (error) {
        setState({
          source,
          value: readCommandMemory(browserStorage(), source),
          error: error instanceof Error ? error.message : "Browser preferences could not be loaded.",
        });
      }
    };
    let active = true;
    const initialise = async () => {
      try {
        if (!navigator.locks)
          throw new Error(
            "This browser cannot safely save shared watch pins or briefing checkpoints. Use a browser with Web Locks support.",
          );
        await navigator.locks.request(commandMemoryKey, () => {
          if (active) refresh();
        });
      } catch (error) {
        if (active)
          setState({
            source,
            value: readCommandMemory(browserStorage(), source),
            error: error instanceof Error ? error.message : "Browser preferences could not be loaded.",
          });
      }
    };
    void initialise();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === commandMemoryKey || event.key === null) void initialise();
    };
    window.addEventListener("storage", storageChanged);
    return () => {
      active = false;
      window.removeEventListener("storage", storageChanged);
    };
  }, [source, head]);
  async function change(update: (value: CommandMemory) => CommandMemory) {
    if (!source) return false;
    try {
      const write = () => {
        setState({ source, value: writeCommandMemory(browserStorage(), source, update), error: null });
        return true;
      };
      if (!navigator.locks)
        throw new Error(
          "This browser cannot safely save shared watch pins or briefing checkpoints. Use a browser with Web Locks support.",
        );
      return await navigator.locks.request(commandMemoryKey, write);
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Preference could not be saved.",
      }));
      return false;
    }
  }
  return {
    ...(state.source === source ? state.value : { checkpoint: null, pins: [] }),
    error: state.source === source ? state.error : null,
    toggle: (pin: WatchPin) => change((current) => toggleWatchPin(current, pin)),
    review: (point: Checkpoint) => change((current) => acknowledge(current, point)),
  };
}
