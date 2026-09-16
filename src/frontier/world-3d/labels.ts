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
 * upward around pinned labels and HUD obstacles; when no upward slot fits inside `bounds`, the card
 * takes the nearest free slot below its neighbours so it stays visible and clickable (a fourteen-task
 * room otherwise pushes its back row off screen or piles it on the top edge). A card that fits
 * nowhere takes the in-bounds slot that covers no HUD panel and the fewest cards: overlap beats
 * invisibility, and a covered card beats a covered panel.
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
  const collides = (label: LabelBox, bottom: number, other: Placed) =>
    Math.abs(label.x - other.x) < (label.width + other.width) / 2 + 8 &&
    bottom > other.bottom - other.height - 8 + 0.01 &&
    bottom - label.height < other.bottom + 8 - 0.01;
  const collision = (label: LabelBox, bottom: number) =>
    placed.find((other) => collides(label, bottom, other));
  const ordered = [...labels].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.y - a.y || a.id.localeCompare(b.id),
  );
  for (const label of ordered) {
    if (label.pinned) {
      placed.push({ ...label, bottom: label.y });
      continue;
    }
    const bounds = limits.bounds;
    const inside = (bottom: number) =>
      !bounds || (bottom - label.height >= bounds.top && bottom <= bounds.bottom);
    const free = (bottom: number) => !collision(label, bottom);
    // Candidate positions: the anchor, then just above or just below every card already placed.
    // Upward slots nearest the anchor win, so an uncrowded stack still grows upward; a card that
    // cannot go up takes the nearest free slot below instead of piling onto the top edge.
    const upward = [label.y, ...placed.map((other) => other.bottom - other.height - 8)]
      .filter((bottom) => bottom <= label.y && inside(bottom))
      .sort((a, b) => b - a);
    const downward = placed
      .map((other) => other.bottom + label.height + 8)
      .filter((bottom) => bottom > label.y && inside(bottom))
      .sort((a, b) => a - b);
    const clamped = bounds ? Math.max(Math.min(label.y, bounds.bottom), bounds.top + label.height) : label.y;
    // Nothing is free: take the slot that covers no HUD panel and the fewest cards, nearest the anchor.
    const fallback = () => {
      let best = clamped;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const candidate of [clamped, ...upward, ...downward]) {
        const hits = placed.filter((other) => collides(label, candidate, other));
        const score =
          hits.filter((other) => other.id.startsWith("obstacle:")).length * 1e6 +
          hits.length * 1e3 +
          Math.abs(candidate - label.y) / 1e3;
        if (score < bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      return best;
    };
    const bottom = upward.find(free) ?? downward.find(free) ?? fallback();
    placed.push({ ...label, bottom });
  }
  return placed.slice(obstacles);
}
