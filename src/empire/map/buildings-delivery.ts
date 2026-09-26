// The ten stage buildings and the town centre, one drawer per kind.
import {
  box,
  cone,
  crenels,
  cylinder,
  dome,
  fire,
  flag,
  gable,
  iso,
  plaza,
  pyramid,
  shade,
  smoke,
  windowGlow,
} from "./draw.ts";
import type { BuildingKit } from "./buildings.ts";
import { drawShip } from "./buildings.ts";

export const deliveryBuildings: Record<string, (k: BuildingKit) => number> = {
  towncenter(k) {
    const { ctx, x, y, s, pal, banner, t } = k;
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
    return apex.y - 34;
  },
  tower(k) {
    const { ctx, x, y, pal, t, lit } = k;
    const body = cylinder(ctx, x, y, 0.62, 58, pal.stone);
    box(ctx, x, y, 0.72, 0.72, 8, pal.stone, 58);
    crenels(ctx, x, y, 0.72, 0.72, 66, pal.stone);
    fire(ctx, body.x, body.y - 12, t, 0.7);
    const c = iso(x, y);
    windowGlow(ctx, c.x + 6, c.y - 30, lit);
    return body.y - 30;
  },
  stable(k) {
    const { ctx, x, y, s, pal } = k;
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
    return iso(x, y).y - 50;
  },
  council(k) {
    const { ctx, x, y, s, pal, banner, t } = k;
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
    return top.y - 26;
  },
  library(k) {
    const { ctx, x, y, s, pal, lit } = k;
    const base = box(ctx, x, y, s * 0.9, s * 0.8, 30, pal.stone);
    gable(ctx, x, y, s * 0.95, s * 0.85, base.top, 18, pal.roof);
    const c = iso(x + s * 0.9, y);
    for (let i = 0; i < 3; i++) windowGlow(ctx, c.x - 8 + i * 8, c.y - 12 - i * 4, lit, 4, 8);
    const tower = cylinder(ctx, x - s * 0.7, y - s * 0.6, 0.4, 52, pal.trim);
    cone(ctx, x - s * 0.7, y - s * 0.6, 0.48, 52, 22, pal.roof);
    return tower.y - 30;
  },
  warroom(k) {
    const { ctx, x, y, s, pal, banner, t } = k;
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
    return c.y - base.top - 50;
  },
  workshop(k) {
    const { ctx, x, y, s, pal, t, lit } = k;
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
    return c.y - 90;
  },
  monastery(k) {
    const { ctx, x, y, s, pal, lit } = k;
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
    return apex.y - 26;
  },
  range(k) {
    const { ctx, x, y, s, pal } = k;
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
    return iso(x, y).y - 50;
  },
  keep(k) {
    const { ctx, x, y, s, pal, banner, t, lit } = k;
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
    return c.y - base.top - 36;
  },
  harbour(k) {
    const { ctx, x, y, s, pal, banner, t } = k;
    // Quay basin with a moored envoy ship.
    plaza(ctx, x + 0.4, y + 0.4, s * 0.8, s * 0.8, "#2f6f8c");
    const base = box(ctx, x - s * 0.5, y - s * 0.5, 0.6, 0.6, 26, pal.stone);
    pyramid(ctx, x - s * 0.5, y - s * 0.5, 0.66, 0.66, base.top, 18, pal.roof);
    const w = iso(x + 0.5, y + 0.5);
    drawShip(ctx, w.x, w.y + Math.sin(t * 1.5) * 1.5, banner, t, 0.85);
    return w.y - 72;
  },
};
