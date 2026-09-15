import { createContext, type ReactNode, useContext, useEffect } from "react";
import type { FrontierSnapshot } from "../runtime/contracts.ts";
import type { RefreshCoordinator } from "../runtime/coordinator.ts";
import { useCommandMemory } from "./use-command-memory.ts";
import { useBriefing } from "./use-briefing.ts";

interface CommandContext {
  memory: ReturnType<typeof useCommandMemory>;
  runtime: RefreshCoordinator;
  snapshot: FrontierSnapshot;
  briefing: ReturnType<typeof useBriefing>;
}
const Context = createContext<CommandContext | null>(null);
export function CommandWorkspaceProvider({
  runtime,
  snapshot,
  children,
}: {
  runtime: RefreshCoordinator;
  snapshot: FrontierSnapshot;
  children: ReactNode;
}) {
  const memory = useCommandMemory(snapshot.workspace);
  const briefing = useBriefing(runtime, snapshot.workspace, memory.checkpoint);
  useEffect(() => {
    if (snapshot.workspace?.sourceId) runtime.setWatchRequests(snapshot.workspace.sourceId, memory.pins);
  }, [runtime, snapshot.workspace?.sourceId, memory.pins]);
  return <Context.Provider value={{ runtime, snapshot, memory, briefing }}>{children}</Context.Provider>;
}
export function useCommandWorkspace() {
  return useContext(Context);
}
