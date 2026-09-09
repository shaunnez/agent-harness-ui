export interface Point {
  x: number;
  y: number;
}
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export const cameraLimits = { min: 0.3, max: 3 };
export function screenToWorld(point: Point, camera: Camera): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}
export function worldToScreen(point: Point, camera: Camera): Point {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}
export function pointInContainedImage(
  point: Point,
  box: { width: number; height: number },
  image: { width: number; height: number },
): Point | null {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale,
    height = image.height * scale;
  const x = (point.x - (box.width - width) / 2) / width;
  const y = (point.y - (box.height - height) / 2) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
export function zoomAround(camera: Camera, point: Point, amount: number): Camera {
  const fixed = screenToWorld(point, camera);
  const zoom = Math.max(cameraLimits.min, Math.min(cameraLimits.max, camera.zoom * amount));
  return { x: point.x - fixed.x * zoom, y: point.y - fixed.y * zoom, zoom };
}
export function constrainCamera(
  camera: Camera,
  viewport: { width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
): Camera {
  const center = screenToWorld({ x: viewport.width / 2, y: viewport.height / 2 }, camera);
  const x = Math.max(bounds.x - 300, Math.min(bounds.x + bounds.width + 300, center.x));
  const y = Math.max(bounds.y - 300, Math.min(bounds.y + bounds.height + 300, center.y));
  return {
    x: viewport.width / 2 - x * camera.zoom,
    y: viewport.height / 2 - y * camera.zoom,
    zoom: camera.zoom,
  };
}
export function coverBackdrop(
  camera: Camera,
  viewport: { width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
): Camera {
  const center = screenToWorld({ x: viewport.width / 2, y: viewport.height / 2 }, camera);
  const zoom = Math.max(0.55, camera.zoom, viewport.width / bounds.width, viewport.height / bounds.height);
  return {
    x: Math.max(
      viewport.width - (bounds.x + bounds.width) * zoom,
      Math.min(-bounds.x * zoom, viewport.width / 2 - center.x * zoom),
    ),
    y: Math.max(
      viewport.height - (bounds.y + bounds.height) * zoom,
      Math.min(-bounds.y * zoom, viewport.height / 2 - center.y * zoom),
    ),
    zoom,
  };
}
export function fitCamera(
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  top = 120,
  bottom = 230,
): Camera {
  const zoom = Math.max(
    cameraLimits.min,
    Math.min(cameraLimits.max, (width - 120) / bounds.width, (height - top - bottom) / bounds.height),
  );
  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: top + (height - top - bottom) / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}
