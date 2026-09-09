export type WindowFamily = "task" | "evidence" | "form" | "management" | "agent";
export interface WindowSize {
  width: number;
  height: number;
}
export type WindowSizes = Partial<Record<WindowFamily, WindowSize>>;
export const windowLayoutKey = "mission-frontier.windows.v1";
const families: WindowFamily[] = ["task", "evidence", "form", "management", "agent"];
type StorageAccess = Pick<Storage, "getItem" | "setItem">;

export function readWindowSizes(storage: StorageAccess): WindowSizes {
  try {
    const value = JSON.parse(storage.getItem(windowLayoutKey) ?? "null");
    return Object.fromEntries(
      families.flatMap((family) => {
        const size = value?.[family];
        return size &&
          [size.width, size.height].every(
            (n) => typeof n === "number" && Number.isFinite(n) && n >= 200 && n <= 10000,
          )
          ? [[family, { width: size.width, height: size.height }]]
          : [];
      }),
    );
  } catch {
    return {};
  }
}
export function saveWindowSizes(storage: StorageAccess, sizes: WindowSizes) {
  try {
    storage.setItem(windowLayoutKey, JSON.stringify(sizes));
  } catch {
    /* Keep this session usable. */
  }
}
export function windowBounds(family: WindowFamily, viewport: WindowSize, expanded = false) {
  const agent = family === "agent";
  return {
    width: Math.max(
      240,
      agent && !expanded && viewport.width > 760
        ? Math.min(viewport.width - 32, Math.max(540, viewport.width * 0.6))
        : viewport.width - (expanded ? 16 : 32),
    ),
    height: Math.max(
      200,
      viewport.height - (agent ? (viewport.width <= 760 ? 194 : 142) : expanded ? 16 : 48),
    ),
  };
}
export function fitWindow(
  size: WindowSize,
  family: WindowFamily,
  viewport: WindowSize,
  expanded = false,
): WindowSize {
  const max = windowBounds(family, viewport, expanded);
  return {
    width: Math.round(Math.min(max.width, Math.max(family === "agent" ? 450 : 560, size.width))),
    height: Math.round(Math.min(max.height, Math.max(360, size.height))),
  };
}
export function defaultWindow(family: WindowFamily, viewport: WindowSize): WindowSize {
  return fitWindow(
    {
      width: family === "agent" ? 540 : family === "task" || family === "evidence" ? 1440 : 1200,
      height: viewport.height,
    },
    family,
    viewport,
  );
}
export function resizedWindow(
  size: WindowSize,
  edge: string,
  dx: number,
  dy: number,
  centred: boolean,
): WindowSize {
  const factor = centred ? 2 : 1;
  return {
    width: size.width + (edge.includes("e") ? dx : edge.includes("w") ? -dx : 0) * factor,
    height: size.height + (edge.includes("s") ? dy : edge.includes("n") ? -dy : 0) * factor,
  };
}
