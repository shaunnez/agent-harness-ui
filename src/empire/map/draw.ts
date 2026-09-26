// Isometric drawing primitives for the Age of Agents map. Pure Canvas 2D, no sprites:
// every building and unit is drawn from boxes, cylinders and roofs so civ palettes and
// banner colours are real material colours rather than tints over an image.
import { emitLight, warmLight } from "./lighting.ts";

export const TW = 64;
export const TH = 32;
export type Ctx = CanvasRenderingContext2D;

export function iso(x: number, y: number) {
  return { x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) };
}

export function shade(hex: string, amount: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  let r = (value >> 16) & 255;
  let g = (value >> 8) & 255;
  let b = value & 255;
  if (amount >= 0) {
    r += (255 - r) * amount;
    g += (255 - g) * amount;
    b += (255 - b) * amount;
  } else {
    r *= 1 + amount;
    g *= 1 + amount;
    b *= 1 + amount;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
export function mix(a: string, b: string, t: number) {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (shift: number) => ((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t;
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${hex(ch(16))}${hex(ch(8))}${hex(ch(0))}`;
}

function poly(ctx: Ctx, points: { x: number; y: number }[], fill: string, stroke?: string) {
  ctx.beginPath();
  points.forEach((point, i) => {
    if (i) ctx.lineTo(point.x, point.y);
    else ctx.moveTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** A box centred on tile (cx, cy) with half extents hx/hy in tiles, raised z px, h px tall. */
export function box(
  ctx: Ctx,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  h: number,
  color: string,
  z = 0,
) {
  const lift = (p: { x: number; y: number }, dz: number) => ({ x: p.x, y: p.y - dz });
  const n = iso(cx - hx, cy - hy);
  const e = iso(cx + hx, cy - hy);
  const s = iso(cx + hx, cy + hy);
  const w = iso(cx - hx, cy + hy);
  const edge = shade(color, -0.55);
  poly(ctx, [lift(w, z), lift(s, z), lift(s, z + h), lift(w, z + h)], shade(color, -0.12), edge);
  poly(ctx, [lift(s, z), lift(e, z), lift(e, z + h), lift(s, z + h)], shade(color, -0.32), edge);
  poly(ctx, [lift(n, z + h), lift(e, z + h), lift(s, z + h), lift(w, z + h)], shade(color, 0.12), edge);
  return { n, e, s, w, top: z + h };
}

export function pyramid(
  ctx: Ctx,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  z: number,
  rise: number,
  color: string,
) {
  const n = iso(cx - hx, cy - hy);
  const e = iso(cx + hx, cy - hy);
  const s = iso(cx + hx, cy + hy);
  const w = iso(cx - hx, cy + hy);
  const c = iso(cx, cy);
  const apex = { x: c.x, y: c.y - z - rise };
  const up = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - z });
  const edge = shade(color, -0.6);
  poly(ctx, [up(n), up(e), apex], shade(color, 0.05), edge);
  poly(ctx, [up(w), up(n), apex], shade(color, 0.18), edge);
  poly(ctx, [up(w), up(s), apex], shade(color, -0.08), edge);
  poly(ctx, [up(s), up(e), apex], shade(color, -0.3), edge);
  return apex;
}

/** Gable roof with the ridge running along the tile x axis. */
export function gable(
  ctx: Ctx,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
  z: number,
  rise: number,
  color: string,
) {
  const up = (p: { x: number; y: number }, dz = 0) => ({ x: p.x, y: p.y - z - dz });
  const n = iso(cx - hx, cy - hy);
  const e = iso(cx + hx, cy - hy);
  const s = iso(cx + hx, cy + hy);
  const w = iso(cx - hx, cy + hy);
  const r1 = iso(cx - hx, cy);
  const r2 = iso(cx + hx, cy);
  const edge = shade(color, -0.6);
  poly(ctx, [up(n), up(e), up(r2, rise), up(r1, rise)], shade(color, 0.1), edge);
  poly(ctx, [up(w), up(n), up(r1, rise)], shade(color, -0.05), edge);
  poly(ctx, [up(w), up(s), up(r2, rise), up(r1, rise)], shade(color, -0.12), edge);
  poly(ctx, [up(s), up(e), up(r2, rise)], shade(color, -0.35), edge);
  // shingle lines on the visible slope
  ctx.strokeStyle = shade(color, -0.4);
  ctx.globalAlpha = 0.45;
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const a = up({ x: w.x + (r1.x - w.x) * t, y: w.y + (r1.y - w.y) * t }, rise * t);
    const b = up({ x: s.x + (r2.x - s.x) * t, y: s.y + (r2.y - s.y) * t }, rise * t);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function cylinder(ctx: Ctx, cx: number, cy: number, r: number, h: number, color: string, z = 0) {
  const c = iso(cx, cy);
  const rx = r * TW * 0.5;
  const ry = rx / 2;
  const grad = ctx.createLinearGradient(c.x - rx, 0, c.x + rx, 0);
  grad.addColorStop(0, shade(color, 0.05));
  grad.addColorStop(0.45, shade(color, -0.05));
  grad.addColorStop(1, shade(color, -0.4));
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - z, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(c.x - rx, c.y - z - h);
  ctx.ellipse(c.x, c.y - z - h, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - z - h, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = shade(color, 0.12);
  ctx.fill();
  ctx.stroke();
  return { x: c.x, y: c.y - z - h, rx, ry };
}

export function cone(ctx: Ctx, cx: number, cy: number, r: number, z: number, rise: number, color: string) {
  const c = iso(cx, cy);
  const rx = r * TW * 0.5;
  const ry = rx / 2;
  const grad = ctx.createLinearGradient(c.x - rx, 0, c.x + rx, 0);
  grad.addColorStop(0, shade(color, 0.15));
  grad.addColorStop(1, shade(color, -0.45));
  ctx.beginPath();
  ctx.moveTo(c.x - rx, c.y - z);
  ctx.ellipse(c.x, c.y - z, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(c.x, c.y - z - rise);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.6);
  ctx.stroke();
  return { x: c.x, y: c.y - z - rise };
}

export function dome(ctx: Ctx, cx: number, cy: number, r: number, z: number, color: string) {
  const c = iso(cx, cy);
  const rx = r * TW * 0.5;
  const grad = ctx.createRadialGradient(c.x - rx * 0.4, c.y - z - rx * 0.6, 1, c.x, c.y - z, rx * 1.2);
  grad.addColorStop(0, shade(color, 0.45));
  grad.addColorStop(1, shade(color, -0.35));
  ctx.beginPath();
  ctx.ellipse(c.x, c.y - z, rx, rx / 2, 0, 0, Math.PI);
  ctx.ellipse(c.x, c.y - z, rx, rx * 0.95, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.6);
  ctx.stroke();
  return { x: c.x, y: c.y - z - rx * 0.95 };
}

export function crenels(ctx: Ctx, cx: number, cy: number, hx: number, hy: number, z: number, color: string) {
  const step = 0.34;
  for (let t = -hx; t <= hx + 0.001; t += step * 2) box(ctx, cx + t, cy + hy - 0.06, 0.08, 0.06, 5, color, z);
  for (let t = -hy; t <= hy + 0.001; t += step * 2) box(ctx, cx + hx - 0.06, cy + t, 0.06, 0.08, 5, color, z);
}

export function flag(ctx: Ctx, x: number, y: number, color: string, time: number, size = 1) {
  ctx.strokeStyle = "#3b2a1a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 22 * size);
  ctx.stroke();
  const wave = Math.sin(time * 4 + x * 0.1) * 2 * size;
  ctx.beginPath();
  ctx.moveTo(x, y - 22 * size);
  ctx.quadraticCurveTo(x + 7 * size, y - 24 * size + wave, x + 14 * size, y - 21 * size + wave);
  ctx.lineTo(x + 14 * size, y - 13 * size + wave);
  ctx.quadraticCurveTo(x + 7 * size, y - 16 * size - wave, x, y - 14 * size);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.5);
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

export function windowGlow(ctx: Ctx, x: number, y: number, lit: boolean, w = 3, h = 5) {
  ctx.fillStyle = lit ? "#ffd27a" : "#2a1d12";
  ctx.fillRect(x - w / 2, y - h, w, h);
  if (lit) {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffb347";
    ctx.beginPath();
    ctx.arc(x, y - h / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    emitLight(ctx, x, y - h / 2, 26, warmLight);
  }
}

export function smoke(ctx: Ctx, x: number, y: number, time: number, color = "rgba(90,90,90,", dark = false) {
  for (let i = 0; i < 5; i++) {
    const t = (time * 0.35 + i / 5) % 1;
    const r = 3 + t * 9;
    ctx.fillStyle = `${color}${(dark ? 0.55 : 0.35) * (1 - t)})`;
    ctx.beginPath();
    ctx.arc(x + Math.sin(t * 5 + i) * 5 + t * 8, y - t * 40, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function fire(ctx: Ctx, x: number, y: number, time: number, scale = 1) {
  emitLight(ctx, x, y - 4 * scale, 70 * scale, warmLight);
  for (let i = 0; i < 4; i++) {
    const flick = Math.sin(time * 12 + i * 2.1) * 1.5;
    ctx.fillStyle = i % 2 ? "rgba(255,190,60,0.9)" : "rgba(230,80,30,0.85)";
    ctx.beginPath();
    ctx.ellipse(x + (i - 1.5) * 3 * scale, y - 4 * scale, 3 * scale, (7 + flick) * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const glow = ctx.createRadialGradient(x, y - 4, 1, x, y - 4, 26 * scale);
  glow.addColorStop(0, "rgba(255,160,60,0.35)");
  glow.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y - 4, 26 * scale, 0, Math.PI * 2);
  ctx.fill();
}

export function groundShadow(ctx: Ctx, cx: number, cy: number, hx: number, hy: number, alpha = 0.28) {
  const n = iso(cx - hx + 0.3, cy - hy + 0.5);
  const e = iso(cx + hx + 0.6, cy - hy + 0.5);
  const s = iso(cx + hx + 0.6, cy + hy + 0.8);
  const w = iso(cx - hx + 0.3, cy + hy + 0.8);
  ctx.globalAlpha = alpha;
  poly(ctx, [n, e, s, w], "#1a1408");
  ctx.globalAlpha = 1;
}

export function plaza(ctx: Ctx, cx: number, cy: number, hx: number, hy: number, color = "#b9a98a") {
  const n = iso(cx - hx, cy - hy);
  const e = iso(cx + hx, cy - hy);
  const s = iso(cx + hx, cy + hy);
  const w = iso(cx - hx, cy + hy);
  poly(ctx, [n, e, s, w], color, shade(color, -0.35));
}

export function tree(ctx: Ctx, x: number, y: number, kind: number, size: number, tint: number) {
  ctx.fillStyle = "rgba(20,30,10,0.3)";
  ctx.beginPath();
  ctx.ellipse(x + 4 * size, y + 1, 9 * size, 4 * size, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a3320";
  ctx.fillRect(x - 1.5 * size, y - 8 * size, 3 * size, 8 * size);
  if (kind === 0) {
    // conifer
    const base = tint > 0.5 ? "#1f4a2a" : "#24522c";
    for (let i = 0; i < 3; i++) {
      const w = (11 - i * 3) * size;
      const top = y - (10 + i * 8) * size;
      ctx.beginPath();
      ctx.moveTo(x - w, top + 10 * size);
      ctx.lineTo(x, top - 8 * size);
      ctx.lineTo(x + w, top + 10 * size);
      ctx.closePath();
      ctx.fillStyle = shade(base, -0.1 + i * 0.08);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, top - 8 * size);
      ctx.lineTo(x + w, top + 10 * size);
      ctx.lineTo(x + w * 0.2, top + 10 * size);
      ctx.closePath();
      ctx.fillStyle = shade(base, -0.35);
      ctx.fill();
    }
  } else {
    const base = kind === 2 ? "#6f7d2a" : tint > 0.5 ? "#3f6b26" : "#4d7a2c";
    const blobs: [number, number, number][] = [
      [0, -18, 10],
      [-6, -13, 7],
      [6, -12, 7],
      [2, -24, 7],
    ];
    for (const [dx, dy, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x + dx * size, y + dy * size, r * size, 0, Math.PI * 2);
      ctx.fillStyle = shade(base, -0.25);
      ctx.fill();
    }
    for (const [dx, dy, r] of blobs) {
      ctx.beginPath();
      ctx.arc(x + dx * size - 1.5 * size, y + dy * size - 1.5 * size, r * size * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = shade(base, 0.08);
      ctx.fill();
    }
  }
}

export function rocks(ctx: Ctx, x: number, y: number, gold: boolean, size = 1) {
  const base = gold ? "#d8a93a" : "#8d8a84";
  const pieces: [number, number, number][] = [
    [-8, 0, 7],
    [4, 2, 8],
    [0, -6, 7],
    [9, -3, 5],
    [-3, 4, 5],
  ];
  ctx.fillStyle = "rgba(20,20,10,0.3)";
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 4, 18 * size, 7 * size, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [dx, dy, r] of pieces) {
    ctx.beginPath();
    ctx.moveTo(x + dx * size - r * size, y + dy * size + 2);
    ctx.lineTo(x + dx * size - r * 0.4 * size, y + dy * size - r * size);
    ctx.lineTo(x + dx * size + r * 0.7 * size, y + dy * size - r * 0.6 * size);
    ctx.lineTo(x + dx * size + r * size, y + dy * size + 2);
    ctx.closePath();
    ctx.fillStyle = shade(gold ? "#6d6558" : base, -0.05);
    ctx.fill();
    ctx.strokeStyle = shade(base, -0.55);
    ctx.stroke();
    if (gold) {
      ctx.fillStyle = "#ffd75e";
      ctx.fillRect(x + dx * size - 1, y + dy * size - r * 0.5 * size, 3, 2);
      ctx.fillRect(x + dx * size + 2, y + dy * size - r * 0.2 * size, 2, 2);
    }
  }
}
