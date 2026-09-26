// Units and carts, drawn from primitives so team colours are real.
import type { UnitKindId } from "../realm.ts";
import { type Ctx, shade } from "./draw.ts";

export type UnitKind = UnitKindId;
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
