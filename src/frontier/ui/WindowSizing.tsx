import { ArrowsIn, ArrowsOut, ArrowsOutSimple } from "@phosphor-icons/react";
import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from "react";
import {
  defaultWindow,
  fitWindow,
  readWindowSizes,
  resizedWindow,
  saveWindowSizes,
  windowBounds,
  type WindowFamily,
  type WindowSize,
  type WindowSizes,
} from "../app/window-layout";

export function useWindowSizing(family: WindowFamily) {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [sizes, setSizes] = useState<WindowSizes>(() => {
    try {
      return readWindowSizes(window.localStorage);
    } catch {
      return {};
    }
  });
  const [expanded, setExpanded] = useState<WindowFamily | null>(null);
  const maximised = expanded === family;
  const size = maximised
    ? windowBounds(family, viewport, true)
    : fitWindow(sizes[family] ?? defaultWindow(family, viewport), family, viewport);
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const change = (value: WindowSize) => {
    setExpanded(null);
    const next = { ...sizes, [family]: fitWindow(value, family, viewport) };
    setSizes(next);
    try {
      saveWindowSizes(window.localStorage, {
        ...readWindowSizes(window.localStorage),
        [family]: next[family],
      });
    } catch {
      /* Browser storage can be unavailable. */
    }
  };
  const reset = () => {
    const next = { ...sizes };
    delete next[family];
    setSizes(next);
    setExpanded(null);
    try {
      const stored = readWindowSizes(window.localStorage);
      delete stored[family];
      saveWindowSizes(window.localStorage, stored);
    } catch {
      /* Keep the in-memory reset. */
    }
  };
  return {
    size,
    maximised,
    family,
    change,
    reset,
    toggle: () => setExpanded(maximised ? null : family),
    style: { "--window-width": `${size.width}px`, "--window-height": `${size.height}px` } as CSSProperties,
  };
}
type Sizing = ReturnType<typeof useWindowSizing>;

export function WindowSizeControls({ sizing }: { sizing: Sizing }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="window-controls">
      <button
        type="button"
        className="icon-button"
        aria-label="Adjust window size"
        aria-expanded={editing}
        title="Adjust window size"
        onClick={() => setEditing(!editing)}
      >
        <ArrowsOutSimple size={18} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={sizing.maximised ? "Restore window" : "Maximise window"}
        title={sizing.maximised ? "Restore window" : "Maximise window"}
        onClick={sizing.toggle}
      >
        {sizing.maximised ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}
      </button>
      {editing && (
        <fieldset className="window-size-editor" aria-label="Window size">
          <span>
            {sizing.size.width} × {sizing.size.height}
          </span>
          <button
            type="button"
            onClick={() => sizing.change({ ...sizing.size, width: sizing.size.width - 80 })}
          >
            Narrower
          </button>
          <button
            type="button"
            onClick={() => sizing.change({ ...sizing.size, width: sizing.size.width + 80 })}
          >
            Wider
          </button>
          {sizing.family !== "agent" && (
            <>
              <button
                type="button"
                onClick={() => sizing.change({ ...sizing.size, height: sizing.size.height - 60 })}
              >
                Shorter
              </button>
              <button
                type="button"
                onClick={() => sizing.change({ ...sizing.size, height: sizing.size.height + 60 })}
              >
                Taller
              </button>
            </>
          )}
          <button type="button" onClick={sizing.reset}>
            Reset size
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Done sizing
          </button>
        </fieldset>
      )}
    </div>
  );
}
export function ResizeHandles({ sizing }: { sizing: Sizing }) {
  const drag = useRef<{ x: number; y: number; size: WindowSize; edge: string } | null>(null);
  const start = (event: PointerEvent<HTMLDivElement>, edge: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, size: sizing.size, edge };
  };
  if (sizing.maximised) return null;
  return (sizing.family === "agent" ? ["w"] : ["n", "e", "s", "w", "se", "sw", "ne", "nw"]).map((edge) => (
    <div
      key={edge}
      aria-hidden="true"
      className={`window-resize resize-${edge}`}
      onPointerDown={(event) => start(event, edge)}
      onPointerMove={(event) => {
        const origin = drag.current;
        if (origin) {
          event.stopPropagation();
          sizing.change(
            resizedWindow(
              origin.size,
              origin.edge,
              event.clientX - origin.x,
              event.clientY - origin.y,
              sizing.family !== "agent",
            ),
          );
        }
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  ));
}
