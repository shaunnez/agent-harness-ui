// Map overlays: name plaques, kingdom ribbons, campaign squads, package yards, water and sky.
import { type Posture, postureStyle } from "../realm.ts";
import { type Ctx, TH, TW, fire, iso, shade } from "./draw.ts";
import { type UnitKind, drawUnit } from "./units.ts";
import { N, type World, tileAt } from "./world.ts";

export function plaque(
  ctx: Ctx,
  x: number,
  y: number,
  text: string,
  accent: string,
  size: number,
  dot = false,
) {
  ctx.font = `700 ${size}px Cinzel, serif`;
  const w = ctx.measureText(text).width + (dot ? 18 : 12);
  const h = size + 8;
  ctx.fillStyle = "rgba(24,16,8,0.82)";
  ctx.strokeStyle = shade(accent.startsWith("#") ? accent : "#c9b98f", -0.1);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h, w, h, 3);
  ctx.fill();
  ctx.stroke();
  if (dot) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(x - w / 2 + 8, y - h / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f3e7c7";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + (dot ? 4 : 0), y - h / 2 + 1);
  ctx.textBaseline = "alphabetic";
}

export function ribbon(ctx: Ctx, x: number, y: number, title: string, color: string, sub: string | null) {
  ctx.font = "900 20px Cinzel, serif";
  const w = Math.max(ctx.measureText(title).width + 56, 180);
  ctx.fillStyle = shade(color, -0.45);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + (side * w) / 2 - side * 6, y - 6);
    ctx.lineTo(x + (side * w) / 2 + side * 18, y - 6);
    ctx.lineTo(x + (side * w) / 2 + side * 8, y + 7);
    ctx.lineTo(x + (side * w) / 2 + side * 18, y + 20);
    ctx.lineTo(x + (side * w) / 2 - side * 6, y + 20);
    ctx.fill();
  }
  const grad = ctx.createLinearGradient(0, y - 12, 0, y + 16);
  grad.addColorStop(0, shade(color, 0.15));
  grad.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = grad;
  ctx.strokeStyle = "#e9cf85";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 12, w, 28, 3);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fff6dc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 3;
  ctx.fillText(title, x, y + 2);
  ctx.shadowBlur = 0;
  if (sub) {
    ctx.font = "italic 500 13px 'EB Garamond', serif";
    ctx.fillStyle = "#f3e7c7";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 3;
    ctx.strokeText(sub, x, y + 30);
    ctx.fillText(sub, x, y + 30);
  }
  ctx.textBaseline = "alphabetic";
}

const yardAccent = (status: string) =>
  status === "failed"
    ? "#e06a5a"
    : status === "running"
      ? "#e8a33a"
      : status === "planned"
        ? "#c9b98f"
        : "#7bc46b";

/** A walled worktree yard for one work package, drawn from its recorded status. */
export function packageYard(
  ctx: Ctx,
  x: number,
  y: number,
  id: string,
  status: string,
  team: string,
  t: number,
  i: number,
) {
  ctx.fillStyle = "#6b4a2a";
  for (const [dx, dy] of [
    [-22, 0],
    [0, -11],
    [22, 0],
    [0, 11],
  ] as const)
    ctx.fillRect(x + dx - 1.5, y + dy - 12, 3, 12);
  if (status === "integrated" || status === "ready_for_integration") {
    ctx.fillStyle = "#b9ad96";
    ctx.fillRect(x - 12, y - 22, 24, 16);
    ctx.fillStyle = "#7a4a2c";
    ctx.beginPath();
    ctx.moveTo(x - 15, y - 22);
    ctx.lineTo(x, y - 34);
    ctx.lineTo(x + 15, y - 22);
    ctx.fill();
    ctx.fillStyle = "#7bc46b";
    ctx.font = "700 12px Cinzel, serif";
    ctx.textAlign = "center";
    ctx.fillText("✓", x, y - 10);
  } else if (status === "running") {
    ctx.strokeStyle = "#8a6a44";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 12, y - 30, 24, 22);
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 19);
    ctx.lineTo(x + 12, y - 19);
    ctx.stroke();
    const built = 0.35 + ((t * 0.02) % 0.3);
    ctx.fillStyle = "#b9ad96";
    ctx.fillRect(x - 11, y - 8 - 20 * built, 22, 20 * built);
    for (let v = 0; v < 2; v++)
      drawUnit(ctx, x - 22 + v * 44, y + 6, {
        kind: "villager",
        team,
        t,
        working: true,
        facing: v ? -1 : 1,
        phase: v * 2 + i,
      });
  } else if (status === "failed") {
    ctx.fillStyle = "#6e645a";
    for (let r = 0; r < 5; r++) ctx.fillRect(x - 12 + r * 5, y - 6 - (r % 2) * 3, 5, 4);
    fire(ctx, x, y - 6, t, 0.6);
    drawUnit(ctx, x + 14, y + 4, { kind: "villager", team, t, fallen: true });
  } else {
    ctx.strokeStyle = "rgba(240,230,200,0.6)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x - 20, y);
    ctx.lineTo(x, y - 10);
    ctx.lineTo(x + 20, y);
    ctx.lineTo(x, y + 10);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  plaque(ctx, x, y - 44, id, yardAccent(status), 10, true);
}

export interface SquadLook {
  id: string;
  posture: Posture;
  running: number;
  leader: UnitKind;
  team: string;
  moving?: boolean;
  facing?: number;
  selected?: boolean;
  hover?: boolean;
  label?: string;
}

/** A campaign squad: its leader, a work crew only while a run is recorded, and a posture sign. */
export function squadFigure(ctx: Ctx, x: number, y: number, look: SquadLook, t: number) {
  const style = postureStyle[look.posture];
  if (look.selected || look.hover) {
    ctx.strokeStyle = look.selected ? "#ffe08a" : "rgba(255,240,200,0.7)";
    ctx.lineWidth = look.selected ? 2 : 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y, 34, 15, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  const fallen = look.posture === "failed" && look.running === 0;
  const working = look.posture === "working" && !look.moving;
  if (working)
    for (let i = 0; i < 2; i++)
      drawUnit(ctx, x - 22 + i * 44, y - 6 + i * 5, {
        kind: "villager",
        team: look.team,
        t,
        working: true,
        facing: i ? -1 : 1,
        phase: i * 1.7,
      });
  if (look.moving)
    drawUnit(ctx, x - 14, y - 6, {
      kind: "villager",
      team: look.team,
      t,
      moving: true,
      facing: look.facing,
      phase: 1.3,
    });
  drawUnit(ctx, x, y + 2, {
    kind: look.leader,
    team: look.team,
    t,
    working,
    fallen,
    moving: look.moving,
    facing: look.facing,
    phase: look.id.length,
  });
  if (look.posture === "needs-you" && !look.moving) {
    const bounce = Math.abs(Math.sin(t * 3)) * 6;
    const beam = ctx.createLinearGradient(x, y - 120, x, y);
    beam.addColorStop(0, "rgba(255,220,120,0)");
    beam.addColorStop(1, "rgba(255,220,120,0.35)");
    ctx.fillStyle = beam;
    ctx.fillRect(x - 8, y - 120, 16, 118);
    ctx.fillStyle = "#f3d36b";
    ctx.strokeStyle = "#5a3d10";
    ctx.lineWidth = 2;
    ctx.font = "900 26px Cinzel, serif";
    ctx.textAlign = "center";
    ctx.strokeText("!", x, y - 64 - bounce);
    ctx.fillText("!", x, y - 64 - bounce);
  } else if (look.posture === "done") {
    ctx.fillStyle = "#7bc46b";
    ctx.font = "700 16px Cinzel, serif";
    ctx.textAlign = "center";
    ctx.fillText("✦", x, y - 64);
  } else if (look.posture === "waiting") {
    ctx.fillStyle = "#c9d3dd";
    ctx.font = "600 13px Cinzel, serif";
    ctx.textAlign = "center";
    ctx.fillText("⧗", x, y - 62);
  }
  plaque(ctx, x, y - 44, look.label ?? look.id, style.color, 12, true);
}

export function waterGlints(ctx: Ctx, world: World, t: number) {
  ctx.strokeStyle = "rgba(220,240,255,0.35)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 180; i++) {
    const x = (i * 37) % N;
    const y = (i * 53) % N;
    const tile = tileAt(world, x, y);
    if (tile !== "deep" && tile !== "water") continue;
    const p = iso(x + 0.5, y + 0.5);
    const phase = (t * 0.5 + i * 0.37) % 1;
    ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.8;
    ctx.beginPath();
    ctx.moveTo(p.x - 8 + phase * 6, p.y);
    ctx.quadraticCurveTo(p.x + phase * 6, p.y - 3, p.x + 8 + phase * 6, p.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function sky(ctx: Ctx, t: number, reducedMotion: boolean) {
  const span = N * TW;
  for (let i = 0; i < 6; i++) {
    const x = ((i * 1370 + t * 12) % (span + 800)) - span / 2 - 400;
    const y = 200 + ((i * 577) % (N * TH - 300));
    ctx.fillStyle = "rgba(20,25,10,0.1)";
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(x + k * 70, y + (k % 2) * 20, 120, 50, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (reducedMotion) return;
  ctx.strokeStyle = "rgba(245,240,230,0.8)";
  ctx.lineWidth = 1.2;
  const home = iso(70, 30);
  for (let i = 0; i < 5; i++) {
    const cx = home.x + Math.cos(t * 0.2 + i) * 180;
    const cy = home.y - 120 + Math.sin(t * 0.25 + i * 2) * 80;
    const flap = Math.sin(t * 8 + i) * 3;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy + flap);
    ctx.quadraticCurveTo(cx - 3, cy - 3, cx, cy);
    ctx.quadraticCurveTo(cx + 3, cy - 3, cx + 6, cy + flap);
    ctx.stroke();
  }
}
