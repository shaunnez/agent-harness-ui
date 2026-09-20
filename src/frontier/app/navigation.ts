import { useEffect, useRef, useState } from "react";
import type { DecisionSession } from "../runtime/decision-session.ts";
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
  const rawReview = prior?.review;
  const review: DecisionSession | null =
    overlay &&
    rawReview &&
    Array.isArray(rawReview.ids) &&
    rawReview.ids.every((id: unknown) => typeof id === "string") &&
    typeof rawReview.selectedId === "string"
      ? {
          sourceId: typeof rawReview.sourceId === "string" ? rawReview.sourceId : null,
          ids: rawReview.ids.slice(0, 1000),
          selectedId: rawReview.selectedId,
          originSelectedId:
            typeof rawReview.originSelectedId === "string" ? rawReview.originSelectedId : null,
        }
      : null;
  return {
    location,
    review,
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
    history.pushState(
      { frontierNavigation: { worldHash, panels, review: next.review } },
      "",
      `#${panels.at(-1) ?? worldHash}`,
    );
    current.current = next;
    setState(next);
  }
  function navigate(location: WorldLocation) {
    commit({ location, stack: [], review: null });
  }
  function setStack(update: Overlay[] | ((prior: Overlay[]) => Overlay[])) {
    const nextStack = typeof update === "function" ? update(current.current.stack) : update;
    commit({
      ...current.current,
      stack: nextStack,
      review: nextStack.length ? current.current.review : null,
    });
  }
  function reviewDecision(review: DecisionSession, overlay: Overlay) {
    commit({ ...current.current, review, stack: [overlay] });
  }
  return { ...state, navigate, setStack, reviewDecision };
}
