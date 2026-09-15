import { useLayoutEffect, useRef } from "react";

export function useBottomHudLayout(selected: boolean, baseSelected: boolean, view: string) {
  const shell = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = shell.current;
    if (view === "agent" || (!selected && !baseSelected)) {
      root?.style.removeProperty("--bottom-hud-height");
      return;
    }
    const dock = root?.querySelector<HTMLElement>(".selection-hud");
    if (!root || !dock) {
      root?.style.removeProperty("--bottom-hud-height");
      return;
    }
    const sync = () =>
      root.style.setProperty("--bottom-hud-height", `${dock.getBoundingClientRect().height}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [selected, baseSelected, view]);
  return shell;
}
