export function minimapFrame(
  bounds: { x: number; y: number; width: number; height: number },
  aspectRatio: number,
) {
  const width = Math.max(bounds.width, bounds.height * aspectRatio);
  const height = width / aspectRatio;
  return {
    x: bounds.x - (width - bounds.width) / 2,
    y: bounds.y - (height - bounds.height) / 2,
    width,
    height,
  };
}
