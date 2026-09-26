// Procedural world for the Age of Agents map: an island continent with one walled
// kingdom per project, a Grand Market for Linear caravans, a river ring-fencing the
// research realm, and the GitHub Capital on its own island across the sea.
import type { StageId } from "../../domain.ts";
import { type BuildingKind, type Kingdom, stageBuildings } from "../realm.ts";

export const N = 80;
export type Tile =
  | "deep"
  | "water"
  | "shallow"
  | "sand"
  | "grass"
  | "meadow"
  | "forest"
  | "road"
  | "farm"
  | "plaza"
  | "bridge";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function valueNoise(seed: number, scale: number) {
  const rand = rng(seed);
  const size = Math.ceil(N / scale) + 3;
  const grid = Array.from({ length: size * size }, () => rand());
  const at = (x: number, y: number) => grid[y * size + x] ?? 0;
  return (x: number, y: number) => {
    const fx = x / scale;
    const fy = y / scale;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx;
    const b = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
    return a * (1 - sy) + b * sy;
  };
}

type Point = { x: number; y: number };
/** Consecutive point pairs of a polyline. */
export function segments(points: Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  points.forEach((point, i) => {
    const next = points[i + 1];
    if (next) out.push([point, next]);
  });
  return out;
}

export interface Placed {
  id: string;
  kind:
    | BuildingKind
    | "towncenter"
    | "market"
    | "capital"
    | "observatory"
    | "mine"
    | "lodge"
    | "assay"
    | "archive"
    | "scope"
    | "review-hall";
  x: number;
  y: number;
  size: number;
  kingdomId: string | null;
  stage?: StageId;
  name: string;
}
export interface Decor {
  kind: "tree" | "gold" | "stone" | "stake" | "hay" | "berry";
  x: number;
  y: number;
  variant: number;
  size: number;
}
export interface Path {
  id: string;
  points: { x: number; y: number }[];
  kind: "ring" | "trade" | "sea";
}
export interface World {
  tiles: Tile[];
  height: Float32Array;
  explored: Float32Array;
  buildings: Placed[];
  decor: Decor[];
  paths: Path[];
  market: { x: number; y: number };
  capital: { x: number; y: number };
  plots: { kingdomId: string; x: number; y: number; index: number }[];
}

const clampTile = (v: number) => Math.max(0, Math.min(N - 1, Math.floor(v)));
export const tileAt = (world: World, x: number, y: number): Tile =>
  world.tiles[clampTile(y) * N + clampTile(x)] ?? "deep";
export const heightAt = (world: World, x: number, y: number) =>
  world.height[clampTile(y) * N + clampTile(x)] ?? 0;
export const exploredAt = (world: World, x: number, y: number) =>
  world.explored[clampTile(y) * N + clampTile(x)] ?? 0;

export const ringRadius = 8.6;
const stageAngle = (index: number, count: number) => (135 + (index * 360) / count) * (Math.PI / 180);
export const researchStations: { kind: Placed["kind"]; name: string }[] = [
  { kind: "scope", name: "Scoping Tent" },
  { kind: "lodge", name: "Explorers' Lodge" },
  { kind: "mine", name: "Rate Mine" },
  { kind: "assay", name: "Assay House" },
  { kind: "archive", name: "Source Archive" },
  { kind: "review-hall", name: "Hall of Review" },
];

export function buildWorld(kingdoms: Kingdom[]): World {
  const rand = rng(1066);
  const tiles: Tile[] = new Array(N * N).fill("grass");
  const height = new Float32Array(N * N);
  const explored = new Float32Array(N * N);
  const idx = (x: number, y: number) => y * N + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
  const coast = valueNoise(7, 7);
  const hills = valueNoise(11, 11);
  const detail = valueNoise(23, 3);
  const forestNoise = valueNoise(41, 6);
  const center = N / 2;
  const capital = { x: 74, y: 5 };
  const market = { x: 39, y: 38 };

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = Math.abs(x - center);
      const dy = Math.abs(y - center);
      const d = (dx ** 3 + dy ** 3) ** (1 / 3);
      const edge = 32 + (coast(x, y) - 0.5) * 7;
      const cap = Math.hypot(x - capital.x, y - capital.y);
      height[idx(x, y)] = hills(x, y) * 0.8 + detail(x, y) * 0.2;
      let tile: Tile = "grass";
      if (cap < 5.2) tile = cap > 4.3 ? "sand" : "grass";
      else if (d > edge + 5) tile = "deep";
      else if (d > edge + 2) tile = "water";
      else if (d > edge) tile = "shallow";
      else if (d > edge - 1.3) tile = "sand";
      else if (detail(x, y) > 0.62) tile = "meadow";
      tiles[idx(x, y)] = tile;
    }

  // The river rings the research realm: ring-fenced, reachable by one bridge.
  const river = [
    { x: 44, y: 24 },
    { x: 47, y: 34 },
    { x: 48.5, y: 44 },
    { x: 46, y: 54 },
    { x: 45, y: 66 },
    { x: 44, y: 80 },
  ];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let best = 99;
      for (const [a, b] of segments(river)) best = Math.min(best, segmentDistance({ x, y }, a, b));
      const w = 1.0 + (y - 24) / 60;
      if (y >= 23 && best < w) tiles[idx(x, y)] = "water";
      else if (y >= 23 && best < w + 0.9 && tiles[idx(x, y)] !== "water") tiles[idx(x, y)] = "sand";
    }
  // Spring lake that feeds the river.
  for (let y = 18; y < 30; y++)
    for (let x = 38; x < 50; x++) if (Math.hypot((x - 44) / 1.3, y - 23) < 3.2) tiles[idx(x, y)] = "water";

  const buildings: Placed[] = [];
  const decor: Decor[] = [];
  const paths: Path[] = [];
  const plots: World["plots"] = [];
  const reserved = new Uint8Array(N * N);
  const reserve = (cx: number, cy: number, r: number) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) if (inside(x, y)) reserved[idx(x, y)] = 1;
  };
  const paint = (cx: number, cy: number, r: number, tile: Tile) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (inside(x, y) && Math.abs(x + 0.5 - cx) <= r && Math.abs(y + 0.5 - cy) <= r) {
          const current = tiles[idx(x, y)];
          if (tile === "road" && (current === "water" || current === "shallow")) tiles[idx(x, y)] = "bridge";
          else if (current !== "bridge") tiles[idx(x, y)] = tile;
        }
  };
  const road = (points: { x: number; y: number }[], width = 0.55) => {
    for (const [a, b] of segments(points)) {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 3);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        paint(x, y, width, "road");
        reserve(x, y, 1);
      }
    }
  };

  for (const kingdom of kingdoms) {
    const { x: ox, y: oy } = kingdom.origin;
    // Clear the land under the kingdom (the research realm keeps its river moat intact).
    for (let y = oy - 13; y <= oy + 13; y++)
      for (let x = ox - 13; x <= ox + 13; x++)
        if (inside(x, y) && Math.hypot(x - ox, y - oy) < 12.5 && tiles[idx(x, y)] !== "water")
          tiles[idx(x, y)] = "grass";
    const ring: { x: number; y: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      ring.push({ x: ox + 0.5 + Math.cos(a) * 5.3, y: oy + 0.5 + Math.sin(a) * 5.3 });
    }
    road(ring, 0.5);
    paths.push({ id: `ring-${kingdom.id}`, points: ring, kind: "ring" });
    paint(ox + 0.5, oy + 0.5, 2.6, "plaza");
    reserve(ox + 0.5, oy + 0.5, 3);
    buildings.push({
      id: `tc-${kingdom.id}`,
      kind: kingdom.research ? "observatory" : "towncenter",
      x: ox + 0.5,
      y: oy + 0.5,
      size: 3.4,
      kingdomId: kingdom.id,
      name: kingdom.research ? "Starwatch Observatory" : `${kingdom.name} Town Centre`,
    });
    const stations = kingdom.research
      ? researchStations.map((item) => ({ ...item, stage: undefined as StageId | undefined }))
      : stageBuildings.map((item) => ({
          kind: item.kind as Placed["kind"],
          name: item.name,
          stage: item.stage as StageId | undefined,
        }));
    stations.forEach((station, index) => {
      const a = stageAngle(index, stations.length);
      const x = ox + 0.5 + Math.cos(a) * ringRadius;
      const y = oy + 0.5 + Math.sin(a) * ringRadius;
      const size = station.kind === "workshop" ? 3.2 : station.kind === "keep" ? 2.8 : 2.3;
      buildings.push({
        id: `${kingdom.id}-${station.stage ?? station.kind}`,
        kind: station.kind,
        x,
        y,
        size,
        kingdomId: kingdom.id,
        stage: station.stage,
        name: station.name,
      });
      paint(x, y, size / 2 + 0.3, "plaza");
      reserve(x, y, size / 2 + 1.4);
      road(
        [
          { x: ox + 0.5 + Math.cos(a) * 5.3, y: oy + 0.5 + Math.sin(a) * 5.3 },
          { x: x - Math.cos(a) * (size / 2), y: y - Math.sin(a) * (size / 2) },
        ],
        0.35,
      );
      if (station.kind === "workshop") {
        // Walled package yards beyond the workshop: one per work package.
        for (let p = 0; p < 4; p++) {
          const pa = a + (p - 1.5) * 0.22;
          const px = ox + 0.5 + Math.cos(pa) * (ringRadius + 3.6);
          const py = oy + 0.5 + Math.sin(pa) * (ringRadius + 3.6);
          plots.push({ kingdomId: kingdom.id, x: px, y: py, index: p });
          paint(px, py, 0.7, "plaza");
          reserve(px, py, 1.2);
        }
      }
      if (station.kind === "mine") {
        decor.push({
          kind: "gold",
          x: x + Math.cos(a) * 2.6,
          y: y + Math.sin(a) * 2.6,
          variant: 0,
          size: 1.4,
        });
        reserve(x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6, 1.5);
      }
    });
    // Farms in the gaps outside the ring (delivery kingdoms only).
    if (!kingdom.research)
      for (let i = 0; i < 5; i++) {
        const a = stageAngle(i * 2 + 1, 10) + Math.PI / 10;
        const fx = ox + 0.5 + Math.cos(a) * 12.4;
        const fy = oy + 0.5 + Math.sin(a) * 12.4;
        if (i === 2) continue;
        for (let y = Math.floor(fy - 1); y <= Math.floor(fy + 1); y++)
          for (let x = Math.floor(fx - 1); x <= Math.floor(fx + 1); x++)
            if (inside(x, y) && !reserved[idx(x, y)] && tiles[idx(x, y)] !== "water")
              tiles[idx(x, y)] = "farm";
        reserve(fx, fy, 1.8);
      }
    // Resources near every town: a gold seam, a stone quarry and berry bushes.
    const resources: Decor["kind"][] = ["gold", "stone", "berry"];
    resources.forEach((kind, r) => {
      const a = stageAngle(r * 3 + 1, 10) + Math.PI / 10 + 0.4;
      const rx = ox + 0.5 + Math.cos(a) * 15.5;
      const ry = oy + 0.5 + Math.sin(a) * 15.5;
      if (!inside(Math.floor(rx), Math.floor(ry)) || tiles[idx(Math.floor(rx), Math.floor(ry))] === "water")
        return;
      decor.push({ kind, x: rx, y: ry, variant: r, size: 1 });
      reserve(rx, ry, 1.5);
    });
    if (kingdom.research) {
      // The palisade: research runs inside its own boundary; only one gate faces the realm.
      for (let i = 0; i < 88; i++) {
        const a = (i / 88) * Math.PI * 2;
        const gate = Math.abs(((a - Math.PI * 1.08 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.13;
        if (gate) continue;
        const sx = ox + 0.5 + Math.cos(a) * 12.2;
        const sy = oy + 0.5 + Math.sin(a) * 12.2;
        if (inside(Math.floor(sx), Math.floor(sy)) && tiles[idx(Math.floor(sx), Math.floor(sy))] !== "water")
          decor.push({ kind: "stake", x: sx, y: sy, variant: i, size: 1 });
        reserve(sx, sy, 0.6);
      }
    }
  }

  // Trade roads: every kingdom to the Grand Market, where Linear caravans arrive.
  paint(market.x, market.y, 2.2, "plaza");
  reserve(market.x, market.y, 3);
  buildings.push({
    id: "market",
    kind: "market",
    x: market.x,
    y: market.y,
    size: 3,
    kingdomId: null,
    name: "Grand Market · Linear intake",
  });
  for (const kingdom of kingdoms) {
    const o = { x: kingdom.origin.x + 0.5, y: kingdom.origin.y + 0.5 };
    const dir = Math.atan2(market.y - o.y, market.x - o.x);
    const start = { x: o.x + Math.cos(dir) * 5.3, y: o.y + Math.sin(dir) * 5.3 };
    const bend = kingdom.research
      ? { x: market.x + 4, y: o.y - 1 }
      : { x: start.x + (market.x - start.x) * 0.5, y: start.y };
    const end = { x: market.x + Math.cos(dir + Math.PI) * 2.2, y: market.y + Math.sin(dir + Math.PI) * 2.2 };
    const points = [start, bend, { x: end.x, y: bend.y }, end];
    road(points, 0.5);
    paths.push({ id: `trade-${kingdom.id}`, points, kind: "trade" });
  }
  buildings.push({
    id: "capital",
    kind: "capital",
    x: capital.x,
    y: capital.y,
    size: 4,
    kingdomId: null,
    name: "GitHub Capital",
  });
  paint(capital.x, capital.y, 2.4, "plaza");
  // Sea lane for envoy ships: from the east coast to the Capital.
  paths.push({
    id: "sea-lane",
    kind: "sea",
    points: [
      { x: 72.5, y: 17 },
      { x: 73, y: 11 },
      { x: 74, y: 8.2 },
      { x: 77.5, y: 12 },
      { x: 76.5, y: 19 },
      { x: 72.5, y: 17 },
    ],
  });

  // Forests where nothing is reserved.
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const tile = tiles[idx(x, y)] ?? "deep";
      if (reserved[idx(x, y)] || !["grass", "meadow"].includes(tile)) continue;
      const f = forestNoise(x, y);
      if (f > 0.58) {
        tiles[idx(x, y)] = "forest";
        const count = f > 0.7 ? 2 : 1;
        for (let i = 0; i < count; i++)
          decor.push({
            kind: "tree",
            x: x + 0.2 + rand() * 0.6,
            y: y + 0.2 + rand() * 0.6,
            variant: rand() < 0.55 ? 0 : rand() < 0.8 ? 1 : 2,
            size: 0.8 + rand() * 0.45,
          });
      } else if (rand() < 0.025)
        decor.push({ kind: "tree", x: x + 0.5, y: y + 0.5, variant: 1, size: 0.75 + rand() * 0.3 });
    }
  for (let i = 0; i < 18; i++) {
    const x = 3 + Math.floor(rand() * (N - 6));
    const y = 3 + Math.floor(rand() * (N - 6));
    if (reserved[idx(x, y)] || !["grass", "meadow", "forest"].includes(tiles[idx(x, y)] ?? "deep")) continue;
    decor.push({ kind: rand() < 0.5 ? "gold" : "stone", x: x + 0.5, y: y + 0.5, variant: i, size: 0.8 });
  }

  // "Explored" land: near kingdoms, roads and the Capital. The rest sits under the fog of war.
  const seen: { x: number; y: number; r: number }[] = [
    ...kingdoms.map((k) => ({ x: k.origin.x, y: k.origin.y, r: 19 })),
    { x: market.x, y: market.y, r: 12 },
    { x: capital.x, y: capital.y, r: 8 },
  ];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const s of seen) v = Math.max(v, 1 - Math.max(0, Math.hypot(x - s.x, y - s.y) - s.r) / 7);
      if (tiles[idx(x, y)] === "road" || tiles[idx(x, y)] === "bridge") v = Math.max(v, 0.85);
      explored[idx(x, y)] = Math.max(0, Math.min(1, v));
    }
  return { tiles, height, explored, buildings, decor, paths, market, capital, plots };
}

function segmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function pointOnPath(points: { x: number; y: number }[], t: number) {
  const parts = segments(points).map(([a, b]) => ({ a, b, length: Math.hypot(b.x - a.x, b.y - a.y) }));
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  let d = (((t % 1) + 1) % 1) * total;
  for (const { a, b, length } of parts) {
    if (d <= length) {
      const f = length ? d / length : 0;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        dir: Math.sign(b.x - a.x - (b.y - a.y)) || 1,
      };
    }
    d -= length;
  }
  const last = points[points.length - 1] ?? { x: 0, y: 0 };
  return { x: last.x, y: last.y, dir: 1 };
}
