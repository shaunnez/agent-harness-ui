interface LabelBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A pinned label (room names) stays at its anchor; cards move around it. */
  pinned?: boolean;
}
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LabelLimits {
  /** Screen-space limits a placed card must stay inside (viewport padding). */
  bounds?: { top: number; bottom: number };
  /** HUD panels the cards must not cover (navigation, decisions, dock, minimap). */
  obstacles?: ScreenRect[];
}
type Placed = LabelBox & { bottom: number };

/**
 * Keep labels tied to their projected workers, moving only enough to separate adjacent cards. Cards stack
 * upward around pinned labels and HUD obstacles; when a stack would leave the viewport through
 * `bounds.top`, the card drops below its neighbours instead so it stays visible and clickable (a
 * fourteen-task room otherwise pushes its back row off screen). A card that fits nowhere keeps its
 * upward position clamped inside the bounds: overlap beats invisibility.
 */
export function separateLabels(labels: LabelBox[], limits: LabelLimits = {}) {
  const placed: Placed[] = (limits.obstacles ?? []).map((rect, index) => ({
    id: `obstacle:${index}`,
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
    bottom: rect.y + rect.height,
    pinned: true,
  }));
  const obstacles = placed.length;
  // The tolerance keeps a card stepped exactly one gap past a collider from re-colliding through
  // floating-point error, which otherwise pins the walk on that collider until its passes run out.
  const collision = (label: LabelBox, bottom: number) =>
    placed.find(
      (other) =>
        Math.abs(label.x - other.x) < (label.width + other.width) / 2 + 8 &&
        bottom > other.bottom - other.height - 8 + 0.01 &&
        bottom - label.height < other.bottom + 8 - 0.01,
    );
  const ordered = [...labels].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.y - a.y || a.id.localeCompare(b.id),
  );
  for (const label of ordered) {
    if (label.pinned) {
      placed.push({ ...label, bottom: label.y });
      continue;
    }
    let bottom = label.y;
    for (let pass = 0; pass < placed.length; pass++) {
      const other = collision(label, bottom);
      if (!other) break;
      bottom = other.bottom - other.height - 8;
    }
    const bounds = limits.bounds;
    if (bounds && bottom - label.height < bounds.top) {
      let below = label.y;
      for (let pass = 0; pass < placed.length; pass++) {
        const other = collision(label, below);
        if (!other) break;
        below = other.bottom + label.height + 8;
      }
      bottom = below <= bounds.bottom ? below : Math.max(bottom, bounds.top + label.height);
    }
    placed.push({ ...label, bottom });
  }
  return placed.slice(obstacles);
}
