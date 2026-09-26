// Terrain baking, buildings and units for the Age of Agents map.
import type { Civ } from "../realm.ts";
import {
  type Ctx,
  TH,
  TW,
  box,
  cone,
  crenels,
  cylinder,
  dome,
  fire,
  flag,
  gable,
  groundShadow,
  iso,
  mix,
  plaza,
  pyramid,
  rocks,
  shade,
  smoke,
  tree,
  windowGlow,
} from "./draw.ts";
import { N, type Placed, type Tile, type World, exploredAt, heightAt, tileAt } from "./world.ts";

export const bakePadding = { x: N * (TW / 2) + 40, y: 120 };

const tileColor: Record<Tile, string> = {
  deep: "#1b4262",
  water: "#255f82",
  shallow: "#3c8ba0",
  sand: "#d6c089",
  grass: "#6c9a3c",
  meadow: "#84a845",
  forest: "#4c7630",
  road: "#b39463",
  farm: "#8f6c3a",
  plaza: "#b3a687",
  bridge: "#7d5732",
};

function rand2(x: number, y: number, s = 0) {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

export function bakeTerrain(world: World): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = N * TW + 80;
  canvas.height = N * TH + 200;
  const ctx = canvas.getContext("2d") as Ctx;
  ctx.translate(bakePadding.x, bakePadding.y);
  const at = (x: number, y: number) => tileAt(world, x, y);
  const h = (x: number, y: number) => heightAt(world, x, y);
  const isWet = (t: Tile) => t === "deep" || t === "water" || t === "shallow";

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const tile = at(x, y);
      const p = iso(x, y);
      let color = tileColor[tile];
      if (tile === "water" && exploredAt(world, x, y) > 0 && y > 20 && x > 36 && x < 52) color = "#2c6d8c";
      const slope = (h(x - 1, y) - h(x + 1, y) + h(x, y - 1) - h(x, y + 1)) * 1.5;
      const jitter = (rand2(x, y) - 0.5) * 0.035;
      const lit = isWet(tile) ? jitter * 0.5 : slope + jitter;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 0.6);
      ctx.lineTo(p.x + TW / 2 + 0.6, p.y + TH / 2);
      ctx.lineTo(p.x, p.y + TH + 0.6);
      ctx.lineTo(p.x - TW / 2 - 0.6, p.y + TH / 2);
      ctx.closePath();
      ctx.fillStyle = shade(color, Math.max(-0.3, Math.min(0.25, lit)));
      ctx.fill();
      const cx = p.x;
      const cy = p.y + TH / 2;
      if (tile === "grass" || tile === "meadow" || tile === "forest") {
        ctx.strokeStyle = shade(color, -0.25);
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const gx = cx + (rand2(x, y, i) - 0.5) * 40;
          const gy = cy + (rand2(x, y, i + 9) - 0.5) * 18;
          ctx.beginPath();
          ctx.moveTo(gx - 2, gy);
          ctx.lineTo(gx, gy - 4);
          ctx.lineTo(gx + 2, gy);
          ctx.stroke();
        }
        if (tile === "meadow")
          for (let i = 0; i < 4; i++) {
            ctx.fillStyle = ["#f2e6a0", "#e8a0b8", "#fff", "#c8b0f0"][i] ?? "#fff";
            ctx.fillRect(cx + (rand2(x, y, i + 3) - 0.5) * 36, cy + (rand2(x, y, i + 5) - 0.5) * 14, 2, 2);
          }
      } else if (tile === "farm") {
        ctx.strokeStyle = shade(color, -0.3);
        for (let i = -3; i <= 3; i++) {
          const a = iso(x + 0.5 + i * 0.13, y);
          const b = iso(x + 0.5 + i * 0.13, y + 1);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.fillStyle = "#9bb04a";
          for (let k = 0.15; k < 1; k += 0.2) {
            const q = iso(x + 0.5 + i * 0.13 + 0.06, y + k);
            ctx.fillRect(q.x - 1, q.y - 2, 2, 2);
          }
        }
      } else if (tile === "road" || tile === "plaza") {
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = shade(color, rand2(x, y, i) > 0.5 ? -0.18 : 0.14);
          ctx.fillRect(cx + (rand2(x, y, i + 1) - 0.5) * 36, cy + (rand2(x, y, i + 2) - 0.5) * 14, 2, 1.5);
        }
        if (tile === "plaza") {
          ctx.strokeStyle = shade(color, -0.22);
          ctx.globalAlpha = 0.4;
          const a = iso(x + 0.5, y);
          const b = iso(x + 0.5, y + 1);
          const c = iso(x, y + 0.5);
          const d = iso(x + 1, y + 0.5);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(d.x, d.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else if (tile === "bridge") {
        ctx.strokeStyle = "#4a3219";
        for (let i = 0; i <= 6; i++) {
          const a = iso(x + i / 6, y);
          const b = iso(x + i / 6, y + 1);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      } else if (isWet(tile)) {
        // Shore foam along the edges this tile shares with land.
        const edges: [number, number, { x: number; y: number }, { x: number; y: number }][] = [
          [x, y - 1, iso(x, y), iso(x + 1, y)],
          [x + 1, y, iso(x + 1, y), iso(x + 1, y + 1)],
          [x, y + 1, iso(x + 1, y + 1), iso(x, y + 1)],
          [x - 1, y, iso(x, y + 1), iso(x, y)],
        ];
        for (const [nx, ny, a, b] of edges) {
          const other = at(nx, ny);
          if (isWet(other) || other === "bridge") continue;
          ctx.strokeStyle = "rgba(235,245,240,0.55)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(a.x + (cx - a.x) * 0.12, a.y + (cy - a.y) * 0.12);
          ctx.lineTo(b.x + (cx - b.x) * 0.12, b.y + (cy - b.y) * 0.12);
          ctx.stroke();
          ctx.strokeStyle = "rgba(235,245,240,0.2)";
          ctx.beginPath();
          ctx.moveTo(a.x + (cx - a.x) * 0.3, a.y + (cy - a.y) * 0.3);
          ctx.lineTo(b.x + (cx - b.x) * 0.3, b.y + (cy - b.y) * 0.3);
          ctx.stroke();
        }
      }
    }

  // Decor, painted back to front.
  const decor = [...world.decor].sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const item of decor) {
    const p = iso(item.x, item.y);
    if (item.kind === "tree") tree(ctx, p.x, p.y, item.variant, item.size, rand2(item.x, item.y));
    else if (item.kind === "gold" || item.kind === "stone")
      rocks(ctx, p.x, p.y, item.kind === "gold", item.size);
    else if (item.kind === "berry") {
      for (let i = 0; i < 4; i++) {
        const bx = p.x + (i - 1.5) * 9;
        const by = p.y + (i % 2) * 5;
        ctx.fillStyle = "#2f5a24";
        ctx.beginPath();
        ctx.arc(bx, by - 5, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#c2304a";
        for (let k = 0; k < 4; k++) ctx.fillRect(bx - 4 + k * 2.5, by - 8 + (k % 2) * 4, 2, 2);
      }
    } else if (item.kind === "stake") {
      ctx.fillStyle = "#6b4a2a";
      ctx.fillRect(p.x - 2, p.y - 16, 4, 16);
      ctx.beginPath();
      ctx.moveTo(p.x - 2, p.y - 16);
      ctx.lineTo(p.x, p.y - 21);
      ctx.lineTo(p.x + 2, p.y - 16);
      ctx.fill();
      ctx.fillStyle = "#4a3219";
      ctx.fillRect(p.x + 1, p.y - 16, 1, 16);
    }
  }

  // Fog of war over unexplored land.
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const fog = 1 - exploredAt(world, x, y);
      if (fog <= 0.02) continue;
      const p = iso(x, y);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 1);
      ctx.lineTo(p.x + TW / 2 + 1, p.y + TH / 2);
      ctx.lineTo(p.x, p.y + TH + 1);
      ctx.lineTo(p.x - TW / 2 - 1, p.y + TH / 2);
      ctx.closePath();
      ctx.fillStyle = `rgba(12,9,5,${Math.min(0.82, fog * 0.86)})`;
      ctx.fill();
    }
  return canvas;
}

export function bakeMinimap(world: World, size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 2;
  const ctx = canvas.getContext("2d") as Ctx;
  const scale = size / (N * TW);
  ctx.scale(scale, scale);
  ctx.translate((N * TW) / 2, 0);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const p = iso(x, y);
      const fog = 1 - exploredAt(world, x, y);
      ctx.fillStyle = mix(tileColor[tileAt(world, x, y)], "#0c0905", Math.min(0.8, fog * 0.85));
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 2);
      ctx.lineTo(p.x + TW / 2 + 2, p.y + TH / 2);
      ctx.lineTo(p.x, p.y + TH + 2);
      ctx.lineTo(p.x - TW / 2 - 2, p.y + TH / 2);
      ctx.fill();
    }
  return canvas;
}

export interface BuildingState {
  active: number;
  alert: "needs-you" | "blocked" | "failed" | null;
  selected: boolean;
  hovered: boolean;
}

/** Draws one building at its anchor. Returns the screen y of its roof peak for labels. */
export function drawBuilding(
  ctx: Ctx,
  b: Placed,
  civ: Civ | null,
  banner: string,
  t: number,
  state: BuildingState,
): number {
  const pal = civ?.palette ?? { stone: "#c8bda6", roof: "#6a4a2e", trim: "#eadfc4" };
  const { x, y } = b;
  const s = b.size / 2;
  const lit = state.active > 0;
  if (state.selected || state.hovered) {
    const c = iso(x, y);
    ctx.strokeStyle = state.selected ? "#ffe08a" : "rgba(255,240,200,0.6)";
    ctx.lineWidth = state.selected ? 2.5 : 1.5;
    ctx.setLineDash(state.selected ? [] : [5, 4]);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, (s + 0.9) * TW * 0.72, (s + 0.9) * TH * 0.72, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  groundShadow(ctx, x, y, s, s);
  let peak = iso(x, y).y - 60;
  switch (b.kind) {
    case "towncenter": {
      plaza(ctx, x, y, s + 0.2, s + 0.2, "#a89a7c");
      const base = box(ctx, x, y, s * 0.92, s * 0.92, 26, pal.stone);
      crenels(ctx, x, y, s * 0.92, s * 0.92, base.top, pal.stone);
      box(ctx, x - 0.2, y - 0.2, s * 0.55, s * 0.55, 26, pal.trim, base.top);
      const apex = pyramid(ctx, x - 0.2, y - 0.2, s * 0.62, s * 0.62, base.top + 26, 30, pal.roof);
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        cylinder(ctx, x + dx * s * 0.92, y + dy * s * 0.92, 0.32, 40, pal.stone);
        cone(ctx, x + dx * s * 0.92, y + dy * s * 0.92, 0.38, 40, 18, pal.roof);
      }
      const door = iso(x + s * 0.92, y + s * 0.92);
      ctx.fillStyle = "#2b1c10";
      ctx.beginPath();
      ctx.ellipse(door.x - 16, door.y - 12, 5, 9, 0, Math.PI, 0);
      ctx.fill();
      for (let i = 0; i < 3; i++) windowGlow(ctx, door.x - 34 + i * 7, door.y - 20 - i * 3, true);
      flag(ctx, apex.x, apex.y + 2, banner, t, 1.5);
      peak = apex.y - 34;
      break;
    }
    case "observatory": {
      plaza(ctx, x, y, s + 0.2, s + 0.2, "#aaa39a");
      const base = box(ctx, x, y, s * 0.85, s * 0.85, 20, pal.stone);
      const tower = cylinder(ctx, x - 0.2, y - 0.2, 0.95, 44, pal.trim, base.top);
      const top = dome(ctx, x - 0.2, y - 0.2, 1.0, base.top + 44, "#7b6a9a");
      // telescope
      ctx.strokeStyle = "#caa24a";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(tower.x + 4, tower.y - 16);
      ctx.lineTo(tower.x + 30, tower.y - 40 + Math.sin(t * 0.3) * 4);
      ctx.stroke();
      const glow = 0.5 + Math.sin(t * 2) * 0.25;
      ctx.fillStyle = `rgba(190,140,255,${glow})`;
      ctx.beginPath();
      ctx.arc(top.x, top.y - 4, 5, 0, Math.PI * 2);
      ctx.fill();
      flag(ctx, top.x, top.y - 2, banner, t, 1.4);
      peak = top.y - 34;
      break;
    }
    case "tower": {
      const body = cylinder(ctx, x, y, 0.62, 58, pal.stone);
      box(ctx, x, y, 0.72, 0.72, 8, pal.stone, 58);
      crenels(ctx, x, y, 0.72, 0.72, 66, pal.stone);
      fire(ctx, body.x, body.y - 12, t, 0.7);
      const c = iso(x, y);
      windowGlow(ctx, c.x + 6, c.y - 30, lit);
      peak = body.y - 30;
      break;
    }
    case "stable": {
      const base = box(ctx, x, y, s, s * 0.6, 18, "#8a6a44");
      gable(ctx, x, y, s * 1.05, s * 0.7, base.top, 16, pal.roof);
      for (let i = 0; i < 4; i++) {
        const p = iso(x - s + 0.3 + i * 0.5, y + s * 0.6);
        ctx.fillStyle = "#2b1c10";
        ctx.fillRect(p.x - 3, p.y - 12, 6, 10);
      }
      const hay = iso(x + s + 0.4, y + 0.3);
      ctx.fillStyle = "#e3c25c";
      ctx.beginPath();
      ctx.ellipse(hay.x, hay.y - 5, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      peak = iso(x, y).y - 50;
      break;
    }
    case "council": {
      box(ctx, x, y, s, s, 6, pal.trim);
      const hall = box(ctx, x, y, s * 0.82, s * 0.82, 26, pal.stone, 6);
      const front = [
        iso(x - s * 0.82, y + s * 0.82),
        iso(x + s * 0.82, y + s * 0.82),
        iso(x + s * 0.82, y - s * 0.82),
      ] as const;
      ctx.fillStyle = pal.trim;
      for (let i = 0; i <= 4; i++) {
        const a = {
          x: front[0].x + ((front[1].x - front[0].x) * i) / 4,
          y: front[0].y + ((front[1].y - front[0].y) * i) / 4,
        };
        const b2 = {
          x: front[1].x + ((front[2].x - front[1].x) * i) / 4,
          y: front[1].y + ((front[2].y - front[1].y) * i) / 4,
        };
        ctx.fillRect(a.x - 1.5, a.y - 32, 3, 26);
        ctx.fillRect(b2.x - 1.5, b2.y - 32, 3, 26);
      }
      const top = dome(ctx, x, y, s * 0.9, hall.top, "#c9a24a");
      flag(ctx, top.x, top.y + 2, banner, t);
      peak = top.y - 26;
      break;
    }
    case "library": {
      const base = box(ctx, x, y, s * 0.9, s * 0.8, 30, pal.stone);
      gable(ctx, x, y, s * 0.95, s * 0.85, base.top, 18, pal.roof);
      const c = iso(x + s * 0.9, y);
      for (let i = 0; i < 3; i++) windowGlow(ctx, c.x - 8 + i * 8, c.y - 12 - i * 4, lit, 4, 8);
      const tower = cylinder(ctx, x - s * 0.7, y - s * 0.6, 0.4, 52, pal.trim);
      cone(ctx, x - s * 0.7, y - s * 0.6, 0.48, 52, 22, pal.roof);
      peak = tower.y - 30;
      break;
    }
    case "warroom": {
      const base = box(ctx, x, y, s * 0.9, s * 0.9, 30, pal.stone);
      crenels(ctx, x, y, s * 0.9, s * 0.9, base.top, pal.stone);
      // a campaign tent on the roof
      const c = iso(x - 0.1, y - 0.1);
      ctx.fillStyle = shade(banner, 0.15);
      ctx.beginPath();
      ctx.moveTo(c.x - 16, c.y - base.top + 4);
      ctx.lineTo(c.x, c.y - base.top - 22);
      ctx.lineTo(c.x + 16, c.y - base.top + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(banner, -0.3);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - base.top - 22);
      ctx.lineTo(c.x + 16, c.y - base.top + 4);
      ctx.lineTo(c.x + 3, c.y - base.top + 4);
      ctx.fill();
      flag(ctx, c.x, c.y - base.top - 20, banner, t);
      peak = c.y - base.top - 50;
      break;
    }
    case "workshop": {
      const base = box(ctx, x, y, s * 0.95, s * 0.7, 26, "#8d6b45");
      gable(ctx, x, y, s, s * 0.78, base.top, 22, pal.roof);
      box(ctx, x + s * 0.5, y - s * 0.4, 0.2, 0.2, 60, "#6e645a");
      const chimney = iso(x + s * 0.5, y - s * 0.4);
      smoke(ctx, chimney.x, chimney.y - 60, t, "rgba(80,80,80,", false);
      if (lit) fire(ctx, chimney.x + 16, chimney.y - 6, t, 0.45);
      // crane
      const c = iso(x - s * 0.9, y + s * 0.4);
      ctx.strokeStyle = "#5a3d22";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x, c.y - 70);
      ctx.lineTo(c.x + 36, c.y - 64);
      ctx.stroke();
      ctx.lineWidth = 1;
      const swing = Math.sin(t * 1.2) * 6;
      ctx.beginPath();
      ctx.moveTo(c.x + 30, c.y - 65);
      ctx.lineTo(c.x + 30 + swing, c.y - 34);
      ctx.stroke();
      ctx.fillStyle = "#8a6a44";
      ctx.fillRect(c.x + 25 + swing, c.y - 34, 10, 7);
      peak = c.y - 90;
      break;
    }
    case "monastery": {
      const base = box(ctx, x + 0.2, y + 0.2, s * 0.8, s * 0.7, 24, pal.trim);
      gable(ctx, x + 0.2, y + 0.2, s * 0.85, s * 0.78, base.top, 16, "#7a3a2a");
      const bell = box(ctx, x - s * 0.55, y - s * 0.45, 0.35, 0.35, 58, pal.trim);
      const apex = pyramid(ctx, x - s * 0.55, y - s * 0.45, 0.42, 0.42, bell.top, 24, "#7a3a2a");
      ctx.fillStyle = "#e8c65a";
      ctx.beginPath();
      ctx.arc(apex.x, apex.y - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      const c = iso(x + 0.2 + s * 0.8, y + 0.2);
      windowGlow(ctx, c.x - 6, c.y - 10, lit, 4, 9);
      windowGlow(ctx, c.x + 6, c.y - 16, lit, 4, 9);
      peak = apex.y - 26;
      break;
    }
    case "range": {
      plaza(ctx, x, y, s, s, "#b89f6c");
      box(ctx, x - s * 0.5, y - s * 0.5, 0.55, 0.5, 18, "#8a6a44");
      gable(ctx, x - s * 0.5, y - s * 0.5, 0.6, 0.56, 18, 12, pal.roof);
      for (let i = 0; i < 3; i++) {
        const p = iso(x + s * 0.6, y - s * 0.6 + i * 0.7);
        ctx.fillStyle = "#5a3d22";
        ctx.fillRect(p.x - 1, p.y - 14, 2, 14);
        for (const [r, col] of [
          [7, "#f4efe0"],
          [5, "#c0392b"],
          [3, "#f4efe0"],
          [1.5, "#c0392b"],
        ] as const) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y - 18, r * 0.7, r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      peak = iso(x, y).y - 50;
      break;
    }
    case "keep": {
      const base = box(ctx, x, y, s * 0.72, s * 0.72, 62, pal.stone);
      crenels(ctx, x, y, s * 0.72, s * 0.72, base.top, pal.stone);
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        cylinder(ctx, x + dx * s * 0.72, y + dy * s * 0.72, 0.26, 74, pal.stone);
        cone(ctx, x + dx * s * 0.72, y + dy * s * 0.72, 0.32, 74, 20, pal.roof);
      }
      const c = iso(x, y);
      flag(ctx, c.x, c.y - base.top - 2, banner, t, 1.3);
      const f = iso(x + s * 0.72, y + s * 0.2);
      for (let i = 0; i < 2; i++) windowGlow(ctx, f.x - 4 + i * 10, f.y - 34 - i * 5, lit, 3, 7);
      peak = c.y - base.top - 36;
      break;
    }
    case "harbour": {
      // Quay basin with a moored envoy ship.
      plaza(ctx, x + 0.4, y + 0.4, s * 0.8, s * 0.8, "#2f6f8c");
      const base = box(ctx, x - s * 0.5, y - s * 0.5, 0.6, 0.6, 26, pal.stone);
      pyramid(ctx, x - s * 0.5, y - s * 0.5, 0.66, 0.66, base.top, 18, pal.roof);
      const w = iso(x + 0.5, y + 0.5);
      drawShip(ctx, w.x, w.y + Math.sin(t * 1.5) * 1.5, banner, t, 0.85);
      peak = w.y - 72;
      break;
    }
    case "market": {
      plaza(ctx, x, y, s + 0.3, s + 0.3, "#b8a67f");
      const stalls: [number, number, string][] = [
        [-0.9, -0.9, "#b33b2b"],
        [0.9, -0.9, "#e0b13a"],
        [-0.9, 0.9, "#2f63c4"],
        [0.9, 0.9, "#3c9a4a"],
      ];
      for (const [dx, dy, col] of stalls) {
        box(ctx, x + dx, y + dy, 0.45, 0.45, 12, "#8a6a44");
        pyramid(ctx, x + dx, y + dy, 0.55, 0.55, 12, 12, col);
      }
      const well = cylinder(ctx, x, y, 0.35, 10, "#9a9088");
      ctx.fillStyle = "#3c8ba0";
      ctx.beginPath();
      ctx.ellipse(well.x, well.y, well.rx * 0.7, well.ry * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      flag(ctx, iso(x - 1.6, y - 1.6).x, iso(x - 1.6, y - 1.6).y, "#5e6ad2", t, 1.2);
      peak = iso(x, y).y - 60;
      break;
    }
    case "capital": {
      plaza(ctx, x, y, s * 0.9, s * 0.9, "#9e9587");
      const wall = box(ctx, x, y, s * 0.85, s * 0.85, 22, "#d8d2c6");
      crenels(ctx, x, y, s * 0.85, s * 0.85, wall.top, "#d8d2c6");
      const spire = box(ctx, x - 0.2, y - 0.2, 0.6, 0.6, 70, "#e8e3d8", wall.top);
      const apex = pyramid(ctx, x - 0.2, y - 0.2, 0.7, 0.7, spire.top, 40, "#24292f");
      for (const [dx, dy] of [
        [-1, 1],
        [1, -1],
      ] as const) {
        cylinder(ctx, x + dx * s * 0.6, y + dy * s * 0.6, 0.4, 70, "#d8d2c6");
        dome(ctx, x + dx * s * 0.6, y + dy * s * 0.6, 0.44, 70, "#24292f");
      }
      flag(ctx, apex.x, apex.y + 2, "#24292f", t, 1.8);
      peak = apex.y - 40;
      break;
    }
    case "scope": {
      const c = iso(x, y);
      ctx.fillStyle = shade(banner, 0.25);
      ctx.beginPath();
      ctx.moveTo(c.x - 28, c.y + 4);
      ctx.lineTo(c.x, c.y - 34);
      ctx.lineTo(c.x + 28, c.y + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(banner, -0.25);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 34);
      ctx.lineTo(c.x + 28, c.y + 4);
      ctx.lineTo(c.x + 6, c.y + 6);
      ctx.fill();
      ctx.fillStyle = "#2b1c10";
      ctx.fillRect(c.x - 5, c.y - 10, 10, 14);
      flag(ctx, c.x, c.y - 32, banner, t);
      peak = c.y - 64;
      break;
    }
    case "lodge": {
      const base = box(ctx, x, y, s * 0.8, s * 0.6, 18, "#7a5a36");
      gable(ctx, x, y, s * 0.9, s * 0.7, base.top, 18, "#3f5a2a");
      const c = iso(x, y);
      ctx.strokeStyle = "#caa24a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x + 24, c.y - 36, 7, 0, Math.PI * 2);
      ctx.moveTo(c.x + 24, c.y - 43);
      ctx.lineTo(c.x + 24 + Math.cos(t) * 6, c.y - 36 + Math.sin(t) * 6);
      ctx.stroke();
      peak = c.y - 60;
      break;
    }
    case "mine": {
      const base = box(ctx, x, y, s * 0.7, s * 0.6, 16, "#6e645a");
      gable(ctx, x, y, s * 0.75, s * 0.66, base.top, 14, "#5a3d22");
      const c = iso(x + s * 0.7, y);
      ctx.fillStyle = "#1a120a";
      ctx.beginPath();
      ctx.ellipse(c.x - 10, c.y - 6, 7, 10, 0, Math.PI, 0);
      ctx.fill();
      if (lit) windowGlow(ctx, c.x - 10, c.y - 2, true, 4, 5);
      peak = c.y - 56;
      break;
    }
    case "assay": {
      const base = box(ctx, x, y, s * 0.75, s * 0.75, 24, pal.trim);
      const top = dome(ctx, x, y, s * 0.6, base.top, "#8a7aa8");
      const c = iso(x, y);
      // scales of judgement
      ctx.strokeStyle = "#e8c65a";
      ctx.lineWidth = 1.5;
      const tilt = Math.sin(t * 0.8) * 3;
      ctx.beginPath();
      ctx.moveTo(c.x, top.y - 4);
      ctx.lineTo(c.x, top.y - 20);
      ctx.moveTo(c.x - 10, top.y - 16 + tilt);
      ctx.lineTo(c.x + 10, top.y - 16 - tilt);
      ctx.stroke();
      peak = top.y - 34;
      break;
    }
    case "archive": {
      const base = box(ctx, x, y, s * 0.85, s * 0.7, 28, pal.stone);
      gable(ctx, x, y, s * 0.9, s * 0.76, base.top, 14, "#3a3f4a");
      const c = iso(x + s * 0.85, y);
      for (let i = 0; i < 3; i++) windowGlow(ctx, c.x - 8 + i * 8, c.y - 10 - i * 4, lit, 3, 8);
      peak = c.y - 70;
      break;
    }
    case "review-hall": {
      box(ctx, x, y, s, s, 6, pal.trim);
      const hall = box(ctx, x, y, s * 0.8, s * 0.8, 30, pal.stone, 6);
      const apex = pyramid(ctx, x, y, s * 0.86, s * 0.86, hall.top, 26, "#3b2350");
      flag(ctx, apex.x, apex.y + 2, banner, t);
      peak = apex.y - 26;
      break;
    }
  }
  if (state.alert === "blocked" || state.alert === "failed") {
    const c = iso(x, y);
    smoke(ctx, c.x - 8, c.y - 40, t, "rgba(40,30,30,", true);
    fire(ctx, c.x + 10, c.y - 18, t, 0.8);
  }
  return peak;
}

export function drawShip(ctx: Ctx, x: number, y: number, sail: string, t: number, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 4, 30, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6b4526";
  ctx.beginPath();
  ctx.moveTo(-26, -6);
  ctx.quadraticCurveTo(0, 10, 26, -8);
  ctx.lineTo(18, -12);
  ctx.lineTo(-20, -10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#3b2a1a";
  ctx.stroke();
  ctx.strokeStyle = "#3b2a1a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, -58);
  ctx.stroke();
  const billow = Math.sin(t * 2) * 2;
  ctx.fillStyle = "#f1e8d2";
  ctx.beginPath();
  ctx.moveTo(-16, -52);
  ctx.quadraticCurveTo(-2 + billow, -40, -16, -18);
  ctx.lineTo(16, -18);
  ctx.quadraticCurveTo(24 + billow, -36, 16, -52);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = sail;
  ctx.fillRect(-4, -46, 12, 18);
  flag(ctx, 0, -56, sail, t, 0.6);
  ctx.restore();
}

export type UnitKind = "villager" | "man-at-arms" | "knight" | "paladin" | "scholar" | "monk" | "envoy";
export interface UnitLook {
  kind: UnitKind;
  team: string;
  t: number;
  moving?: boolean;
  working?: boolean;
  facing?: number;
  fallen?: boolean;
  phase?: number;
  scale?: number;
}

export function drawUnit(ctx: Ctx, x: number, y: number, look: UnitLook) {
  const { kind, team, t } = look;
  const phase = look.phase ?? 0;
  const facing = look.facing ?? 1;
  const scale = look.scale ?? 1.7;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * scale, scale);
  ctx.fillStyle = "rgba(10,10,5,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 0, kind === "knight" || kind === "paladin" ? 11 : 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  if (look.fallen) {
    ctx.rotate(Math.PI / 2.2);
    ctx.globalAlpha = 0.75;
  }
  const step = look.moving ? Math.sin(t * 10 + phase) : 0;
  const bob = look.moving ? Math.abs(step) * 1.2 : look.working ? Math.abs(Math.sin(t * 6 + phase)) : 0;
  const mounted = kind === "knight" || kind === "paladin";
  let riderY = 0;
  if (mounted) {
    const horse = kind === "paladin" ? "#e8e2d6" : "#6b4526";
    ctx.strokeStyle = shade(horse, -0.4);
    ctx.lineWidth = 2;
    for (const [lx, sw] of [
      [-6, step],
      [-3, -step],
      [5, -step],
      [8, step],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(lx, -6);
      ctx.lineTo(lx + sw * 2, 0);
      ctx.stroke();
    }
    ctx.fillStyle = horse;
    ctx.beginPath();
    ctx.ellipse(1, -9 - bob, 9, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, -11 - bob);
    ctx.lineTo(13, -18 - bob);
    ctx.lineTo(15, -16 - bob);
    ctx.lineTo(11, -8 - bob);
    ctx.fill();
    ctx.fillStyle = team;
    ctx.fillRect(-5, -13 - bob, 10, 5);
    riderY = -9;
  } else {
    ctx.strokeStyle = "#2b2016";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-1.5, -6);
    ctx.lineTo(-1.5 + step * 2, 0);
    ctx.moveTo(1.5, -6);
    ctx.lineTo(1.5 - step * 2, 0);
    ctx.stroke();
  }
  const by = riderY - bob;
  // body
  const robe = kind === "scholar" || kind === "monk";
  ctx.fillStyle = robe ? (kind === "monk" ? "#8a5a2a" : "#4b3a6a") : kind === "villager" ? "#9a7a4a" : team;
  ctx.beginPath();
  if (robe) {
    ctx.moveTo(-4, by - 4);
    ctx.lineTo(4, by - 4);
    ctx.lineTo(3, by - 15);
    ctx.lineTo(-3, by - 15);
  } else ctx.roundRect(-3.5, by - 15, 7, 10, 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  if (kind === "villager" || robe) {
    ctx.fillStyle = team;
    ctx.fillRect(-3.5, by - 10, 7, 2);
  }
  // head
  ctx.fillStyle = "#e0b48a";
  ctx.beginPath();
  ctx.arc(0, by - 18, 3, 0, Math.PI * 2);
  ctx.fill();
  // headgear
  if (kind === "villager") {
    ctx.fillStyle = "#d9c070";
    ctx.beginPath();
    ctx.ellipse(0, by - 20, 5, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === "man-at-arms" || kind === "knight") {
    ctx.fillStyle = "#9aa0a6";
    ctx.beginPath();
    ctx.arc(0, by - 19, 3.4, Math.PI, 0);
    ctx.fill();
  } else if (kind === "paladin") {
    ctx.fillStyle = "#e3b84a";
    ctx.beginPath();
    ctx.arc(0, by - 19, 3.6, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "#f4efe6";
    ctx.beginPath();
    ctx.moveTo(-3, by - 14);
    ctx.lineTo(-8, by - 5 + Math.sin(t * 5) * 1);
    ctx.lineTo(-2, by - 6);
    ctx.fill();
  } else if (robe) {
    ctx.fillStyle = kind === "monk" ? "#6a4220" : "#3a2a55";
    ctx.beginPath();
    ctx.arc(0, by - 19, 3.8, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
  } else if (kind === "envoy") {
    ctx.fillStyle = team;
    ctx.beginPath();
    ctx.moveTo(-4, by - 20);
    ctx.lineTo(0, by - 26);
    ctx.lineTo(4, by - 20);
    ctx.fill();
  }
  // gear
  ctx.strokeStyle = "#cfd3d6";
  ctx.lineWidth = 1.5;
  const swing = look.working ? Math.sin(t * 8 + phase) * 0.9 : 0;
  ctx.save();
  ctx.translate(3.5, by - 11);
  ctx.rotate(swing);
  ctx.beginPath();
  if (kind === "villager") {
    ctx.strokeStyle = "#6b4526";
    ctx.moveTo(0, 0);
    ctx.lineTo(4, -8);
    ctx.stroke();
    ctx.fillStyle = "#9aa0a6";
    ctx.fillRect(2, -11, 5, 3);
  } else if (kind === "man-at-arms") {
    ctx.moveTo(0, 2);
    ctx.lineTo(0, -12);
    ctx.stroke();
  } else if (kind === "knight" || kind === "paladin") {
    ctx.strokeStyle = "#6b4526";
    ctx.moveTo(-4, 2);
    ctx.lineTo(10, -14);
    ctx.stroke();
    ctx.fillStyle = "#cfd3d6";
    ctx.beginPath();
    ctx.moveTo(10, -14);
    ctx.lineTo(13, -18);
    ctx.lineTo(11, -12);
    ctx.fill();
  } else if (robe) {
    ctx.fillStyle = "#f1e8d2";
    ctx.fillRect(-1, -4, 6, 4);
  } else if (kind === "envoy") {
    ctx.fillStyle = "#f1e8d2";
    ctx.fillRect(0, -6, 3, 8);
  }
  ctx.restore();
  // shield for soldiers, in team colour
  if (kind === "man-at-arms" || kind === "knight" || kind === "paladin") {
    ctx.fillStyle = team;
    ctx.strokeStyle = shade(team, -0.5);
    ctx.beginPath();
    ctx.moveTo(-6, by - 14);
    ctx.lineTo(-2, by - 14);
    ctx.lineTo(-2, by - 8);
    ctx.lineTo(-4, by - 5);
    ctx.lineTo(-6, by - 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCart(ctx: Ctx, x: number, y: number, team: string, t: number, facing: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing * 1.5, 1.5);
  ctx.fillStyle = "rgba(10,10,5,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // ox
  ctx.fillStyle = "#6b5236";
  ctx.beginPath();
  ctx.ellipse(10, -7, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(14, -11, 4, 4);
  // cart
  ctx.fillStyle = "#8a6a44";
  ctx.fillRect(-12, -14, 16, 8);
  ctx.fillStyle = "#f1e8d2";
  ctx.beginPath();
  ctx.ellipse(-4, -15, 9, 6, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = team;
  ctx.fillRect(-6, -18, 4, 4);
  ctx.strokeStyle = "#3b2a1a";
  ctx.lineWidth = 1.5;
  const spin = t * 6;
  for (const wx of [-9, 1]) {
    ctx.beginPath();
    ctx.arc(wx, -4, 3.5, 0, Math.PI * 2);
    ctx.moveTo(wx + Math.cos(spin) * 3.5, -4 + Math.sin(spin) * 3.5);
    ctx.lineTo(wx - Math.cos(spin) * 3.5, -4 - Math.sin(spin) * 3.5);
    ctx.stroke();
  }
  ctx.restore();
}
