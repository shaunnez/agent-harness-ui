import { Container, Matrix } from "pixi.js";
import type { WorldAssets } from "./assets";
import type { Point } from "./camera";

export interface Island {
  position: Point;
}
export function islandScale({ y }: Point) {
  return y < 1000 ? 2 : 1.7;
}
export function islandAnchor({ x, y }: Point) {
  return { x, y: y + (y < 1000 ? 150 : 130) };
}

function onIsland(point: Point, islands: Island[]) {
  return islands.some(({ position }) => {
    const scale = islandScale(position),
      anchor = islandAnchor(position);
    return (
      Math.abs(point.x - anchor.x) / (225 * scale) +
        Math.abs(point.y - (anchor.y - 112.5 * scale)) / (112.5 * scale) <=
      1
    );
  });
}

/** Fixed infrastructure connects project entrances; it never encodes task progress. */
export function projectRoutes(assets: WorldAssets, islands: Island[]) {
  const container = new Container();
  const add = (id: string, x: number, y: number, scale = 1) => {
    const sprite = assets.sprite(id, x, y, scale);
    if (sprite) container.addChild(sprite);
  };
  const segment = (from: Point, to: Point) => {
    const dx = to.x - from.x,
      dy = to.y - from.y;
    if (Math.abs(dx) < 2) return;
    const direction = Math.sign(dx * dy),
      count = Math.max(1, Math.round(Math.abs(dx) / 160));
    const lengthScale = Math.abs(dx) / count / 160;
    const widthScale = 1.1;
    for (let index = 0; index < count; index++) {
      const middle = { x: from.x + (dx * (index + 0.5)) / count, y: from.y + (dy * (index + 0.5)) / count };
      const land = onIsland(middle, islands);
      const cinematic = !land && assets.direction === "cinematic" && assets.has("mf.cinematic.bridge");
      const art = assets.sprite(
        cinematic
          ? direction > 0
            ? "mf.cinematic.bridge-se"
            : "mf.cinematic.bridge"
          : `mf.route.${land ? "road" : "bridge"}.${direction > 0 ? "se" : "sw"}`,
      );
      if (!art) continue;
      const piece = new Container();
      piece.addChild(art);
      // Blender's 12m span projects to310.319logical px; its2.8m deck to72.408px.
      const along = cinematic ? (lengthScale * 160) / 310.319 : lengthScale;
      const across = cinematic ? (widthScale * 24) / 72.408 : widthScale;
      const a = (along + across) / 2,
        shear = direction * (along - across);
      // Adapt length along the ground axis while preserving the shared road width.
      piece.setFromMatrix(new Matrix(a, shear / 4, shear, a, middle.x, middle.y));
      container.addChild(piece);
    }
  };
  islands.forEach((island, index) => {
    if (!index) return;
    const prior = islands
      .slice(0, index)
      .reduce((nearest, candidate) =>
        Math.hypot(candidate.position.x - island.position.x, candidate.position.y - island.position.y) <
        Math.hypot(nearest.position.x - island.position.x, nearest.position.y - island.position.y)
          ? candidate
          : nearest,
      );
    const [upper, lower] = [prior.position, island.position].sort((a, b) => a.y - b.y);
    if (!upper || !lower) return;
    const from = { x: upper.x, y: upper.y + 10 },
      to = { x: lower.x, y: lower.y + 10 };
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const se = dy + dx / 2,
      sw = dy - dx / 2;
    const joint = se >= 0 ? { x: from.x + se, y: from.y + se / 2 } : { x: from.x - sw, y: from.y + sw / 2 };
    if (Math.abs(joint.x - from.x) < 65 || Math.abs(to.x - joint.x) < 65) {
      segment(from, joint);
      segment(joint, to);
      return;
    }
    if (!onIsland(joint, islands)) add("mf.terrain.shore.rim", joint.x, joint.y + 67.5, 0.6);
    const firstEnd = {
      x: joint.x - Math.sign(joint.x - from.x) * 52.8,
      y: joint.y - Math.sign(joint.y - from.y) * 26.4,
    };
    const secondStart = {
      x: joint.x + Math.sign(to.x - joint.x) * 52.8,
      y: joint.y + Math.sign(to.y - joint.y) * 26.4,
    };
    segment(from, firstEnd);
    segment(secondStart, to);
    add("mf.route.road.junction", joint.x, joint.y, 1.1);
  });
  return container;
}
