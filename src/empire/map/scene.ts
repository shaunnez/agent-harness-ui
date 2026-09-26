// The live map: camera, render loop, picking. Squads are drawn only where recorded task
// state puts them; townsfolk, caravans and clouds are ambient scenery and never count as work.
import type { StageId } from "../../domain.ts";
import {
  type Campaign,
  type Kingdom,
  civs,
  makeRoster,
  must,
  postureStyle,
  researchQuestions,
  unitFor,
} from "../realm.ts";
import { type Ctx, TH, TW, fire, iso, shade } from "./draw.ts";
import {
  bakeMinimap,
  bakePadding,
  bakeTerrain,
  drawBuilding,
  drawCart,
  drawShip,
  drawUnit,
  type UnitKind,
} from "./paint.ts";
import { N, type World, buildWorld, pointOnPath } from "./world.ts";

export type Selection =
  | { kind: "campaign"; id: string }
  | { kind: "building"; id: string }
  | { kind: "kingdom"; id: string }
  | { kind: "market" }
  | { kind: "capital" }
  | null;

interface Hit {
  sel: Exclude<Selection, null>;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  priority: number;
}
interface Drawable {
  depth: number;
  draw: (ctx: Ctx) => void;
}

const roster = makeRoster();
const unitKind = (model: string | null | undefined): UnitKind => {
  const unit = unitFor(model);
  return unit.unit === "Knight"
    ? "knight"
    : unit.unit === "Paladin"
      ? "paladin"
      : unit.unit === "Scholar"
        ? "scholar"
        : "man-at-arms";
};

export class RealmScene {
  world: World;
  terrain: HTMLCanvasElement | null = null;
  minimap: HTMLCanvasElement | null = null;
  camera = { x: 0, y: 0, zoom: 0.8 };
  view = { w: 1, h: 1 };
  kingdoms: Kingdom[];
  campaigns: Campaign[] = [];
  selection: Selection = null;
  hover: Selection = null;
  onSelect: (selection: Selection) => void = () => {};
  onHover: (label: string | null) => void = () => {};
  private hits: Hit[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private frame = 0;
  private keys = new Set<string>();
  private pointer = { x: -1, y: -1, inside: false, down: false, dragged: false, sx: 0, sy: 0, cx: 0, cy: 0 };
  private last = 0;
  private time = 0;
  reducedMotion = false;
  edgeScroll = true;

  constructor(kingdoms: Kingdom[]) {
    this.kingdoms = kingdoms;
    this.world = buildWorld(kingdoms);
    const home = must(kingdoms[0]);
    const start = iso(home.origin.x + 6, home.origin.y + 8);
    this.camera.x = start.x;
    this.camera.y = start.y;
  }

  bake() {
    if (!this.terrain) this.terrain = bakeTerrain(this.world);
    if (!this.minimap) this.minimap = bakeMinimap(this.world, 440);
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.bake();
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
      this.last = now;
      this.time += this.reducedMotion ? dt * 0.15 : dt;
      this.update(dt);
      this.render();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
    canvas.addEventListener("pointerdown", this.down);
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointerleave", this.leave);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
  }
  detach() {
    cancelAnimationFrame(this.frame);
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.removeEventListener("pointerdown", this.down);
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.up);
    canvas.removeEventListener("pointerleave", this.leave);
    canvas.removeEventListener("wheel", this.wheel);
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
    this.canvas = null;
  }

  focusTile(x: number, y: number) {
    const p = iso(x, y);
    this.camera.x = p.x;
    this.camera.y = p.y;
  }
  focusSelection(selection: Selection) {
    const target = this.anchorOf(selection);
    if (target) this.focusTile(target.x, target.y);
  }
  anchorOf(selection: Selection): { x: number; y: number } | null {
    if (!selection) return null;
    if (selection.kind === "market") return this.world.market;
    if (selection.kind === "capital") return this.world.capital;
    if (selection.kind === "kingdom") {
      const k = this.kingdoms.find((item) => item.id === selection.id);
      return k ? { x: k.origin.x + 0.5, y: k.origin.y + 0.5 } : null;
    }
    if (selection.kind === "building") return this.world.buildings.find((b) => b.id === selection.id) ?? null;
    const campaign = this.campaigns.find((item) => item.id === selection.id);
    return campaign ? this.squadAnchor(campaign) : null;
  }

  stageBuilding(kingdomId: string, stage: StageId) {
    return this.world.buildings.find((b) => b.kingdomId === kingdomId && b.stage === stage) ?? null;
  }
  squadAnchor(campaign: Campaign) {
    const b = this.stageBuilding(campaign.kingdomId, campaign.stage);
    const k = this.kingdoms.find((item) => item.id === campaign.kingdomId);
    if (!b || !k) return { x: 0, y: 0 };
    const peers = this.campaigns.filter(
      (c) => c.kingdomId === campaign.kingdomId && c.stage === campaign.stage,
    );
    const index = peers.findIndex((c) => c.id === campaign.id);
    const ox = k.origin.x + 0.5;
    const oy = k.origin.y + 0.5;
    const a = Math.atan2(b.y - oy, b.x - ox);
    const inward = b.size / 2 + 1.1;
    const spread = (index - (peers.length - 1) / 2) * 1.35;
    return {
      x: b.x - Math.cos(a) * inward - Math.sin(a) * spread,
      y: b.y - Math.sin(a) * inward + Math.cos(a) * spread,
    };
  }

  private toWorld(sx: number, sy: number) {
    return {
      x: (sx - this.view.w / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.view.h / 2) / this.camera.zoom + this.camera.y,
    };
  }
  private pick(sx: number, sy: number): Selection {
    const p = this.toWorld(sx, sy);
    const found = this.hits
      .filter((h) => p.x >= h.x0 && p.x <= h.x1 && p.y >= h.y0 && p.y <= h.y1)
      .sort((a, b) => b.priority - a.priority);
    return found[0]?.sel ?? null;
  }
  private down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return;
    Object.assign(this.pointer, {
      down: true,
      dragged: false,
      sx: event.clientX,
      sy: event.clientY,
      cx: this.camera.x,
      cy: this.camera.y,
    });
  };
  private move = (event: PointerEvent) => {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return;
    this.pointer.x = event.clientX - rect.left;
    this.pointer.y = event.clientY - rect.top;
    this.pointer.inside =
      event.target === this.canvas &&
      this.pointer.x >= 0 &&
      this.pointer.y >= 0 &&
      this.pointer.x <= rect.width &&
      this.pointer.y <= rect.height;
    if (this.pointer.down) {
      const dx = event.clientX - this.pointer.sx;
      const dy = event.clientY - this.pointer.sy;
      if (Math.hypot(dx, dy) > 5) this.pointer.dragged = true;
      if (this.pointer.dragged) {
        this.camera.x = this.pointer.cx - dx / this.camera.zoom;
        this.camera.y = this.pointer.cy - dy / this.camera.zoom;
      }
    } else if (this.pointer.inside) {
      const hovered = this.pick(this.pointer.x, this.pointer.y);
      this.hover = hovered;
      if (this.canvas) this.canvas.style.cursor = hovered ? "pointer" : "default";
    }
  };
  private up = () => {
    if (this.pointer.down && !this.pointer.dragged && this.pointer.inside) {
      this.selection = this.pick(this.pointer.x, this.pointer.y);
      this.onSelect(this.selection);
    }
    this.pointer.down = false;
  };
  private leave = () => {
    this.pointer.inside = false;
    this.hover = null;
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return;
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const before = this.toWorld(sx, sy);
    this.camera.zoom = Math.max(0.35, Math.min(1.8, this.camera.zoom * Math.exp(-event.deltaY * 0.0012)));
    const after = this.toWorld(sx, sy);
    this.camera.x += before.x - after.x;
    this.camera.y += before.y - after.y;
  };
  private keydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    this.keys.add(event.key.toLowerCase());
  };
  private keyup = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());

  private update(dt: number) {
    const speed = 900 / this.camera.zoom;
    let vx = 0;
    let vy = 0;
    if (this.keys.has("arrowleft") || this.keys.has("a")) vx -= 1;
    if (this.keys.has("arrowright") || this.keys.has("d")) vx += 1;
    if (this.keys.has("arrowup") || this.keys.has("w")) vy -= 1;
    if (this.keys.has("arrowdown") || this.keys.has("s")) vy += 1;
    if (this.edgeScroll && this.pointer.inside && !this.pointer.down) {
      const m = 10;
      if (this.pointer.x < m) vx -= 1;
      if (this.pointer.x > this.view.w - m) vx += 1;
      if (this.pointer.y < m) vy -= 1;
      if (this.pointer.y > this.view.h - m) vy += 1;
    }
    this.camera.x += vx * speed * dt;
    this.camera.y += vy * speed * dt;
    const half = (N * TW) / 2;
    this.camera.x = Math.max(-half, Math.min(half, this.camera.x));
    this.camera.y = Math.max(0, Math.min(N * TH, this.camera.y));
  }

  render() {
    const canvas = this.canvas;
    if (!canvas || !this.terrain) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    this.view = { w, h };
    const ctx = canvas.getContext("2d") as Ctx;
    const t = this.time;
    const z = this.camera.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0c1822";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      dpr * z,
      0,
      0,
      dpr * z,
      dpr * (w / 2 - this.camera.x * z),
      dpr * (h / 2 - this.camera.y * z),
    );
    // open sea beyond the map
    ctx.fillStyle = "#16354f";
    ctx.fillRect(this.camera.x - w / z, this.camera.y - h / z, (2 * w) / z, (2 * h) / z);
    ctx.drawImage(this.terrain, -bakePadding.x, -bakePadding.y);
    this.drawWaterGlints(ctx, t);

    const hits: Hit[] = [];
    const drawables: Drawable[] = [];
    const alertByBuilding = new Map<string, "needs-you" | "blocked" | "failed">();
    const activeByBuilding = new Map<string, number>();
    for (const c of this.campaigns) {
      const b = this.stageBuilding(c.kingdomId, c.stage);
      if (!b) continue;
      if (c.posture === "working") activeByBuilding.set(b.id, (activeByBuilding.get(b.id) ?? 0) + 1);
      if (c.posture === "blocked" || c.posture === "failed") alertByBuilding.set(b.id, c.posture);
    }
    const researchRunning = researchQuestions.filter((q) => q.grade === "running").length;

    for (const b of this.world.buildings) {
      const kingdom = this.kingdoms.find((k) => k.id === b.kingdomId) ?? null;
      const civ = kingdom ? (civs.find((c) => c.id === kingdom.civ) ?? null) : null;
      const banner = kingdom?.banner ?? "#5e6ad2";
      const sel: Exclude<Selection, null> =
        b.kind === "market"
          ? { kind: "market" }
          : b.kind === "capital"
            ? { kind: "capital" }
            : b.kind === "towncenter" || b.kind === "observatory"
              ? { kind: "kingdom", id: b.kingdomId ?? "" }
              : { kind: "building", id: b.id };
      const c = iso(b.x, b.y);
      const reach = b.size * TW * 0.42;
      hits.push({
        sel,
        x0: c.x - reach,
        x1: c.x + reach,
        y0: c.y - 90,
        y1: c.y + b.size * TH * 0.45,
        priority: 1,
      });
      const isSel = JSON.stringify(this.selection) === JSON.stringify(sel);
      const isHover = !!this.hover && JSON.stringify(this.hover) === JSON.stringify(sel);
      const active =
        b.kind === "mine" || b.kind === "lodge" ? researchRunning : (activeByBuilding.get(b.id) ?? 0);
      drawables.push({
        depth: b.x + b.y + b.size / 2 - 0.2,
        draw: (ctx) => {
          const peak = drawBuilding(ctx, b, civ, banner, t, {
            active,
            alert: b.stage
              ? alertByBuilding.get(b.id) === "needs-you"
                ? null
                : (alertByBuilding.get(b.id) ?? null)
              : null,
            selected: isSel,
            hovered: isHover,
          });
          if (isHover || isSel || z > 1.25)
            this.plaque(ctx, c.x, peak, b.name, isSel ? "#ffe08a" : "#f1e3bf", 11);
        },
      });
    }

    // Kingdom banners above each town.
    for (const k of this.kingdoms) {
      const c = iso(k.origin.x + 0.5, k.origin.y + 0.5);
      drawables.push({
        depth: k.origin.x + k.origin.y + 3.2,
        draw: (ctx) =>
          this.ribbon(
            ctx,
            c.x,
            c.y + 64,
            k.name,
            k.banner,
            k.research ? "Research realm · ring-fenced" : null,
          ),
      });
    }
    drawables.push({
      depth: 9999,
      draw: (ctx) => {
        const c = iso(this.world.capital.x, this.world.capital.y);
        this.ribbon(ctx, c.x, c.y - 200, "GitHub Capital", "#24292f", "Where envoys deliver PRs");
      },
    });
    drawables.push({
      depth: 9999,
      draw: (ctx) => {
        const c = iso(this.world.market.x, this.world.market.y);
        this.ribbon(ctx, c.x, c.y - 110, "Grand Market", "#5e6ad2", "Linear caravans arrive here");
      },
    });

    // Package yards: one per recorded work package.
    for (const c of this.campaigns) {
      if (!c.packages.length) continue;
      const k = this.kingdoms.find((item) => item.id === c.kingdomId);
      if (!k) continue;
      const plots = this.world.plots.filter((p) => p.kingdomId === k.id);
      c.packages.forEach((pkg, i) => {
        const plot = plots[i];
        if (!plot) return;
        const p = iso(plot.x, plot.y);
        drawables.push({
          depth: plot.x + plot.y + 0.4,
          draw: (ctx) => this.packageYard(ctx, p.x, p.y, pkg.id, pkg.status, k.banner, t, i),
        });
        hits.push({
          sel: { kind: "campaign", id: c.id },
          x0: p.x - 26,
          x1: p.x + 26,
          y0: p.y - 44,
          y1: p.y + 12,
          priority: 2,
        });
      });
    }

    // Campaign squads.
    for (const c of this.campaigns) {
      const k = this.kingdoms.find((item) => item.id === c.kingdomId);
      if (!k) continue;
      const a = this.squadAnchor(c);
      const p = iso(a.x, a.y);
      const run = [...(c.task.runs ?? [])].reverse().find((r) => r.stage === c.stage);
      const policy = roster.settings.stagePolicies[c.stage as keyof typeof roster.settings.stagePolicies];
      const leader = unitKind(run?.model ?? policy?.model);
      const isSel = this.selection?.kind === "campaign" && this.selection.id === c.id;
      const isHover = this.hover?.kind === "campaign" && this.hover.id === c.id;
      hits.push({
        sel: { kind: "campaign", id: c.id },
        x0: p.x - 34,
        x1: p.x + 34,
        y0: p.y - 70,
        y1: p.y + 12,
        priority: 3,
      });
      drawables.push({
        depth: a.x + a.y + 0.1,
        draw: (ctx) => this.squad(ctx, p.x, p.y, c, leader, k.banner, t, isSel, isHover),
      });
      if (c.posture === "external") {
        const lane = this.world.paths.find((item) => item.kind === "sea");
        if (lane) {
          const s = pointOnPath(lane.points, t * 0.012);
          const sp = iso(s.x, s.y);
          drawables.push({
            depth: s.x + s.y,
            draw: (ctx) => {
              drawShip(ctx, sp.x, sp.y, k.banner, t, 0.9);
              this.plaque(ctx, sp.x, sp.y - 70, `${c.id} · envoy at sea`, postureStyle.external.color, 10);
            },
          });
          hits.push({
            sel: { kind: "campaign", id: c.id },
            x0: sp.x - 30,
            x1: sp.x + 30,
            y0: sp.y - 70,
            y1: sp.y + 8,
            priority: 3,
          });
        }
      }
    }

    // Research realm: scholars mine the rate library while a sample question runs.
    const research = this.kingdoms.find((k) => k.research);
    if (research) {
      const mine = this.world.buildings.find((b) => b.kingdomId === research.id && b.kind === "mine");
      const lodge = this.world.buildings.find((b) => b.kingdomId === research.id && b.kind === "lodge");
      if (mine)
        for (let i = 0; i < researchRunning * 3; i++) {
          const phase = (t * 0.18 + i / 3) % 1;
          const gold = this.world.decor.find(
            (d) => d.kind === "gold" && Math.hypot(d.x - mine.x, d.y - mine.y) < 3.5,
          );
          const target = gold ?? mine;
          const f = phase < 0.5 ? phase * 2 : 2 - phase * 2;
          const x = mine.x + (target.x - mine.x) * f + (i - 1) * 0.3;
          const y = mine.y + (target.y - mine.y) * f + 0.8;
          const sp = iso(x, y);
          const atSeam = f > 0.92;
          drawables.push({
            depth: x + y,
            draw: (ctx) =>
              drawUnit(ctx, sp.x, sp.y, {
                kind: "scholar",
                team: research.banner,
                t,
                moving: !atSeam,
                working: atSeam,
                facing: phase < 0.5 ? 1 : -1,
                phase: i,
              }),
          });
        }
      if (lodge && researchRunning) {
        const phase = (t * 0.05) % 1;
        const f = phase < 0.5 ? phase * 2 : 2 - phase * 2;
        const ox = lodge.x + Math.cos(-0.6) * f * 10;
        const oy = lodge.y + Math.sin(-0.6) * f * 10 + 1;
        const sp = iso(ox, oy);
        drawables.push({
          depth: ox + oy,
          draw: (ctx) =>
            drawUnit(ctx, sp.x, sp.y, {
              kind: "knight",
              team: research.banner,
              t,
              moving: true,
              facing: phase < 0.5 ? 1 : -1,
            }),
        });
      }
    }

    // Ambient townsfolk on ring roads and caravans on trade roads (scenery, not work).
    if (!this.reducedMotion) {
      for (const path of this.world.paths) {
        const k = this.kingdoms.find((item) => path.id.endsWith(item.id));
        if (path.kind === "ring") {
          for (let i = 0; i < 3; i++) {
            const dirn = i % 2 ? -1 : 1;
            const q = pointOnPath(path.points, i / 3 + dirn * t * 0.012);
            const sp = iso(q.x, q.y);
            drawables.push({
              depth: q.x + q.y,
              draw: (ctx) =>
                drawUnit(ctx, sp.x, sp.y, {
                  kind: k?.research ? "monk" : "villager",
                  team: k?.banner ?? "#999",
                  t,
                  moving: true,
                  facing: q.dir * dirn,
                  phase: i,
                  scale: 1.4,
                }),
            });
          }
        } else if (path.kind === "trade") {
          const phase = (t * 0.02 + (k?.origin.x ?? 0) * 0.07) % 2;
          const f = phase < 1 ? phase : 2 - phase;
          const q = pointOnPath(path.points, f * 0.999);
          const sp = iso(q.x, q.y);
          drawables.push({
            depth: q.x + q.y,
            draw: (ctx) => drawCart(ctx, sp.x, sp.y, "#5e6ad2", t, phase < 1 ? q.dir : -q.dir),
          });
        }
      }
    }

    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) d.draw(ctx);
    this.hits = hits;
    this.drawClouds(ctx, t);

    // Warm late-afternoon grade and a vignette.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const grade = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height / 2,
      canvas.height * 0.3,
      canvas.width / 2,
      canvas.height / 2,
      canvas.width * 0.75,
    );
    grade.addColorStop(0, "rgba(255,200,120,0.0)");
    grade.addColorStop(1, "rgba(30,15,5,0.55)");
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private drawWaterGlints(ctx: Ctx, t: number) {
    if (this.reducedMotion) return;
    ctx.strokeStyle = "rgba(220,240,255,0.35)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 180; i++) {
      const x = (i * 37) % N;
      const y = (i * 53) % N;
      const tile = this.world.tiles[y * N + x];
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

  private drawClouds(ctx: Ctx, t: number) {
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
    // gulls over the sea
    if (this.reducedMotion) return;
    ctx.strokeStyle = "rgba(245,240,230,0.8)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) {
      const cx = iso(70, 30).x + Math.cos(t * 0.2 + i) * 180;
      const cy = iso(70, 30).y - 120 + Math.sin(t * 0.25 + i * 2) * 80;
      const flap = Math.sin(t * 8 + i) * 3;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy + flap);
      ctx.quadraticCurveTo(cx - 3, cy - 3, cx, cy);
      ctx.quadraticCurveTo(cx + 3, cy - 3, cx + 6, cy + flap);
      ctx.stroke();
    }
  }

  private packageYard(
    ctx: Ctx,
    x: number,
    y: number,
    id: string,
    status: string,
    team: string,
    t: number,
    i: number,
  ) {
    // Palisade corners of the isolated worktree yard.
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
    this.plaque(
      ctx,
      x,
      y - 44,
      `${id} · ${status.replaceAll("_", " ")}`,
      status === "failed"
        ? "#e06a5a"
        : status === "running"
          ? "#e8a33a"
          : status === "planned"
            ? "#c9b98f"
            : "#7bc46b",
      11,
    );
  }

  private squad(
    ctx: Ctx,
    x: number,
    y: number,
    c: Campaign,
    leader: UnitKind,
    team: string,
    t: number,
    selected: boolean,
    hover: boolean,
  ) {
    const style = postureStyle[c.posture];
    if (selected || hover) {
      ctx.strokeStyle = selected ? "#ffe08a" : "rgba(255,240,200,0.7)";
      ctx.lineWidth = selected ? 2 : 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y, 34, 15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const fallen = c.posture === "failed" && c.running === 0;
    const working = c.posture === "working";
    if (working)
      for (let i = 0; i < 2; i++)
        drawUnit(ctx, x - 22 + i * 44, y - 6 + i * 5, {
          kind: "villager",
          team,
          t,
          working: true,
          facing: i ? -1 : 1,
          phase: i * 1.7,
        });
    drawUnit(ctx, x, y + 2, { kind: leader, team, t, working, fallen, phase: c.id.length });
    if (c.posture === "needs-you") {
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
    } else if (c.posture === "done") {
      ctx.fillStyle = "#7bc46b";
      ctx.font = "700 16px Cinzel, serif";
      ctx.textAlign = "center";
      ctx.fillText("✦", x, y - 64);
    } else if (c.posture === "waiting") {
      ctx.fillStyle = "#c9d3dd";
      ctx.font = "600 13px Cinzel, serif";
      ctx.textAlign = "center";
      ctx.fillText("⧗", x, y - 62);
    }
    this.plaque(ctx, x, y - 44, c.id, style.color, 12, true);
  }

  private plaque(ctx: Ctx, x: number, y: number, text: string, accent: string, size: number, dot = false) {
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

  private ribbon(ctx: Ctx, x: number, y: number, title: string, color: string, sub: string | null) {
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
}
