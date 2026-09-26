// Landmarks and the research realm: observatory, market, capital and research stations.
import { box, crenels, cylinder, dome, flag, gable, iso, plaza, pyramid, shade, windowGlow } from "./draw.ts";
import type { BuildingKit } from "./buildings.ts";

export const landmarkBuildings: Record<string, (k: BuildingKit) => number> = {
  observatory(k) {
    const { ctx, x, y, s, pal, banner, t } = k;
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
    return top.y - 34;
  },
  market(k) {
    const { ctx, x, y, s, t } = k;
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
    return iso(x, y).y - 60;
  },
  capital(k) {
    const { ctx, x, y, s, t } = k;
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
    return apex.y - 40;
  },
  scope(k) {
    const { ctx, x, y, banner, t } = k;
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
    return c.y - 64;
  },
  lodge(k) {
    const { ctx, x, y, s, t } = k;
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
    return c.y - 60;
  },
  mine(k) {
    const { ctx, x, y, s, lit } = k;
    const base = box(ctx, x, y, s * 0.7, s * 0.6, 16, "#6e645a");
    gable(ctx, x, y, s * 0.75, s * 0.66, base.top, 14, "#5a3d22");
    const c = iso(x + s * 0.7, y);
    ctx.fillStyle = "#1a120a";
    ctx.beginPath();
    ctx.ellipse(c.x - 10, c.y - 6, 7, 10, 0, Math.PI, 0);
    ctx.fill();
    if (lit) windowGlow(ctx, c.x - 10, c.y - 2, true, 4, 5);
    return c.y - 56;
  },
  assay(k) {
    const { ctx, x, y, s, pal, t } = k;
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
    return top.y - 34;
  },
  archive(k) {
    const { ctx, x, y, s, pal, lit } = k;
    const base = box(ctx, x, y, s * 0.85, s * 0.7, 28, pal.stone);
    gable(ctx, x, y, s * 0.9, s * 0.76, base.top, 14, "#3a3f4a");
    const c = iso(x + s * 0.85, y);
    for (let i = 0; i < 3; i++) windowGlow(ctx, c.x - 8 + i * 8, c.y - 10 - i * 4, lit, 3, 8);
    return c.y - 70;
  },
  "review-hall"(k) {
    const { ctx, x, y, s, pal, banner, t } = k;
    box(ctx, x, y, s, s, 6, pal.trim);
    const hall = box(ctx, x, y, s * 0.8, s * 0.8, 30, pal.stone, 6);
    const apex = pyramid(ctx, x, y, s * 0.86, s * 0.86, hall.top, 26, "#3b2350");
    flag(ctx, apex.x, apex.y + 2, banner, t);
    return apex.y - 26;
  },
};
