import { useEffect, useRef, useState } from "react";
import { type Overlay, overlayHash, parseOverlay } from "./routes";

export interface WorldLocation {
  view: "world" | "project" | "agent";
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
}
export const worldLocation: WorldLocation = { view: "world", projectId: null, taskId: null, runId: null };
export function parseLocation(hash: string): WorldLocation {
  try {
    const [view, id, runId] = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    if (view === "project" && id) return { ...worldLocation, view, projectId: id };
    if (view === "agent" && id) return { ...worldLocation, view, taskId: id, runId: runId ?? null };
    return worldLocation;
  } catch {
    return worldLocation;
  }
}
function readNavigation() {
  const overlay = parseOverlay(window.location.hash);
  const prior = history.state?.frontierNavigation;
  const location =
    overlay && typeof prior?.worldHash === "string"
      ? parseLocation(prior.worldHash)
      : parseLocation(window.location.hash);
  const stored: Overlay[] =
    overlay && Array.isArray(prior?.panels)
      ? prior.panels
          .map((hash: unknown) => (typeof hash === "string" ? parseOverlay(hash) : null))
          .filter((entry: Overlay | null): entry is Overlay => Boolean(entry))
      : [];
  const last = stored.at(-1);
  return {
    location,
    stack: overlay ? (last && overlayHash(last) === overlayHash(overlay) ? stored : [overlay]) : [],
  };
}
export function useNavigation() {
  const [state, setState] = useState(readNavigation);
  const current = useRef(state);
  current.current = state;
  useEffect(() => {
    const update = () => {
      const next = readNavigation();
      current.current = next;
      setState(next);
    };
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);
  function commit(next: typeof state) {
    const worldHash =
      next.location.view === "project"
        ? `project/${encodeURIComponent(next.location.projectId ?? "")}`
        : next.location.view === "agent"
          ? `agent/${encodeURIComponent(next.location.taskId ?? "")}/${encodeURIComponent(next.location.runId ?? "")}`
          : "world";
    const panels = next.stack.map(overlayHash);
    history.pushState({ frontierNavigation: { worldHash, panels } }, "", `#${panels.at(-1) ?? worldHash}`);
    current.current = next;
    setState(next);
  }
  function navigate(location: WorldLocation) {
    commit({ location, stack: [] });
  }
  function setStack(update: Overlay[] | ((prior: Overlay[]) => Overlay[])) {
    commit({
      ...current.current,
      stack: typeof update === "function" ? update(current.current.stack) : update,
    });
  }
  return { ...state, navigate, setStack };
}
