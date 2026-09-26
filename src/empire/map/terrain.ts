// Terrain and minimap baking for the Age of Agents map.
import { type Ctx, TH, TW, iso, mix, rocks, shade, tree } from "./draw.ts";
import { N, type Tile, type World, exploredAt, heightAt, tileAt } from "./world.ts";

export const bakePadding = { x: N * (TW / 2) + 40, y: 120 };
/** The terrain is baked below full resolution to keep the cached image near 30 MB instead of 57 MB. */
export const bakeScale = 0.75;

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
  canvas.width = Math.ceil((N * TW + 80) * bakeScale);
  canvas.height = Math.ceil((N * TH + 200) * bakeScale);
  const ctx = canvas.getContext("2d") as Ctx;
  ctx.scale(bakeScale, bakeScale);
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
