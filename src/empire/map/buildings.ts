// Building dispatcher: selection ring, ground shadow, the kind's drawer, and siege smoke.
import type { Civ } from "../realm.ts";
import { deliveryBuildings } from "./buildings-delivery.ts";
import { landmarkBuildings } from "./buildings-landmarks.ts";
import { type Ctx, TH, TW, fire, flag, groundShadow, iso, smoke } from "./draw.ts";
import type { Placed } from "./world.ts";

export interface BuildingKit {
  ctx: Ctx;
  x: number;
  y: number;
  s: number;
  pal: Civ["palette"];
  banner: string;
  t: number;
  lit: boolean;
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
  const kit: BuildingKit = { ctx, x, y, s, pal, banner, t, lit };
  const drawer = deliveryBuildings[b.kind] ?? landmarkBuildings[b.kind];
  const peak = drawer ? drawer(kit) : iso(x, y).y - 60;
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
