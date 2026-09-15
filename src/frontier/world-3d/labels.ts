interface LabelBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Keep labels tied to their projected workers, moving only enough to separate adjacent cards. */
export function separateLabels(labels: LabelBox[]) {
  const placed: Array<LabelBox & { bottom: number }> = [];
  for (const label of [...labels].sort((a, b) => b.y - a.y || a.id.localeCompare(b.id))) {
    let bottom = label.y;
    for (let pass = 0; pass < placed.length; pass++) {
      const collision = placed.find(
        (other) =>
          Math.abs(label.x - other.x) < (label.width + other.width) / 2 + 8 &&
          bottom > other.bottom - other.height - 8 &&
          bottom - label.height < other.bottom + 8,
      );
      if (!collision) break;
      bottom = collision.bottom - collision.height - 8;
    }
    placed.push({ ...label, bottom });
  }
  return placed;
}
