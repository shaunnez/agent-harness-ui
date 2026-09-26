// The live map: camera, input, picking and the render loop. What is drawn comes from
// layers.ts; squads appear only where recorded task state (or the labelled replay) puts them.
import type { StageId } from "../../domain.ts";
import { type Campaign, type Kingdom, must } from "../realm.ts";
import type { ReplayController } from "../replay/controller.ts";
import { type Ctx, TH, TW, iso } from "./draw.ts";
import { type Hit, type Selection, buildLayers } from "./layers.ts";
import { type LightMode, beginLights, drawNight, nightLevel, takeLights } from "./lighting.ts";
import { sky, waterGlints } from "./overlays.ts";
import { bakeMinimap, bakePadding, bakeScale, bakeTerrain } from "./terrain.ts";
import { N, type World, buildWorld } from "./world.ts";

export type { Selection } from "./layers.ts";

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
  /** The camera follows this selection until the operator pans. */
  follow: Selection = null;
  replay: ReplayController | null = null;
  replayPoint: { x: number; y: number } | null = null;
  lightMode: LightMode = "auto";
  onSelect: (selection: Selection) => void = () => {};
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
    if (selection.kind === "replay") return this.replayPoint;
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
    if (vx || vy || this.pointer.dragged) this.follow = null;
    this.replay?.tick(dt);
    const target = this.replay?.follow && this.replayPoint ? this.replayPoint : this.anchorOf(this.follow);
    if (target) {
      const p = iso(target.x, target.y);
      const ease = Math.min(1, dt * 3);
      this.camera.x += (p.x - this.camera.x) * ease;
      this.camera.y += (p.y - 30 - this.camera.y) * ease;
    }
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
    const night = nightLevel(this.lightMode, Date.now());
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
    ctx.fillStyle = "#16354f";
    ctx.fillRect(this.camera.x - w / z, this.camera.y - h / z, (2 * w) / z, (2 * h) / z);
    ctx.drawImage(
      this.terrain,
      -bakePadding.x,
      -bakePadding.y,
      this.terrain.width / bakeScale,
      this.terrain.height / bakeScale,
    );
    if (!this.reducedMotion) waterGlints(ctx, this.world, t);
    beginLights();
    const layers = buildLayers({
      world: this.world,
      kingdoms: this.kingdoms,
      campaigns: this.campaigns,
      selection: this.selection,
      hover: this.hover,
      t,
      zoom: z,
      night,
      reducedMotion: this.reducedMotion,
      replay: this.replay ? this.replay.frame() : null,
      squadAnchor: (c) => this.squadAnchor(c),
      stageBuilding: (k, s) => this.stageBuilding(k, s),
    });
    layers.drawables.sort((a, b) => a.depth - b.depth);
    for (const d of layers.drawables) d.draw(ctx);
    this.hits = layers.hits;
    this.replayPoint = layers.replayPoint;
    sky(ctx, t, this.reducedMotion);
    drawNight(ctx, canvas.width, canvas.height, night, takeLights());
    // Warm grade and a vignette.
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
}
