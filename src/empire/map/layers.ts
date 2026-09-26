// Everything drawn above the terrain, as depth-sorted drawables plus pick boxes.
// Squads, yards, fires and ships come from recorded campaign state (or the labelled replay);
// townsfolk, caravans and door lanterns are scenery.
import { type StageId, stageIds } from "../../domain.ts";
import {
  type Campaign,
  type Kingdom,
  civs,
  makeRoster,
  postureStyle,
  researchQuestions,
  unitKindFor,
} from "../realm.ts";
import type { ReplayFrame } from "../replay/engine.ts";
import { replayCampaign } from "../replay/script.ts";
import { drawBuilding, drawShip } from "./buildings.ts";
import { type Ctx, TH, TW, iso } from "./draw.ts";
import { emitLight, violetLight, warmLight } from "./lighting.ts";
import { marchRoute, placePoint } from "./march.ts";
import { packageYard, plaque, ribbon, squadFigure } from "./overlays.ts";
import { drawCart, drawUnit } from "./units.ts";
import { type World, pointOnPath } from "./world.ts";

export type Selection =
  | { kind: "campaign"; id: string }
  | { kind: "building"; id: string }
  | { kind: "kingdom"; id: string }
  | { kind: "market" }
  | { kind: "capital" }
  | { kind: "replay" }
  | null;
export const sameSelection = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);

export interface Hit {
  sel: Exclude<Selection, null>;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  priority: number;
}
export interface Drawable {
  depth: number;
  draw: (ctx: Ctx) => void;
}
export interface LayerInput {
  world: World;
  kingdoms: Kingdom[];
  campaigns: Campaign[];
  selection: Selection;
  hover: Selection;
  t: number;
  zoom: number;
  night: number;
  reducedMotion: boolean;
  replay: ReplayFrame | null;
  squadAnchor: (c: Campaign) => { x: number; y: number };
  stageBuilding: (kingdomId: string, stage: StageId) => World["buildings"][number] | null;
}

const roster = makeRoster();
const replayLane = -1.5;

export function buildLayers(input: LayerInput) {
  const out = {
    drawables: [] as Drawable[],
    hits: [] as Hit[],
    replayPoint: null as { x: number; y: number } | null,
    /** Next free package yard per kingdom; campaigns take yards in order. */
    nextPlot: new Map<string, number>(),
  };
  buildingLayer(input, out);
  campaignLayer(input, out);
  researchLayer(input, out);
  if (!input.reducedMotion) ambientLayer(input, out);
  if (input.replay) replayLayer(input, input.replay, out);
  return out;
}
type Out = ReturnType<typeof buildLayers>;

function buildingLayer(input: LayerInput, out: Out) {
  const { world, kingdoms, campaigns, t, zoom, night } = input;
  const alertByBuilding = new Map<string, "blocked" | "failed">();
  const activeByBuilding = new Map<string, number>();
  for (const c of campaigns) {
    const b = input.stageBuilding(c.kingdomId, c.stage);
    if (!b) continue;
    if (c.posture === "working") activeByBuilding.set(b.id, (activeByBuilding.get(b.id) ?? 0) + 1);
    if (c.posture === "blocked" || c.posture === "failed") alertByBuilding.set(b.id, c.posture);
  }
  const replay = input.replay;
  const replayKingdom = kingdoms.find((k) => k.id === replayCampaign.kingdomId);
  if (replay && replayKingdom && !replay.moving && replay.at !== "market" && replay.at !== "capital") {
    const b = input.stageBuilding(replayKingdom.id, replay.at);
    if (b && replay.posture === "working") activeByBuilding.set(b.id, (activeByBuilding.get(b.id) ?? 0) + 1);
    if (b && replay.posture === "blocked") alertByBuilding.set(b.id, "blocked");
  }
  const researchRunning = researchQuestions.filter((q) => q.grade === "running").length;
  for (const b of world.buildings) {
    const kingdom = kingdoms.find((k) => k.id === b.kingdomId) ?? null;
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
    out.hits.push({
      sel,
      x0: c.x - reach,
      x1: c.x + reach,
      y0: c.y - 90,
      y1: c.y + b.size * TH * 0.45,
      priority: 1,
    });
    const selected = sameSelection(input.selection, sel);
    const hovered = sameSelection(input.hover, sel);
    const active =
      b.kind === "mine" || b.kind === "lodge" ? researchRunning : (activeByBuilding.get(b.id) ?? 0);
    out.drawables.push({
      depth: b.x + b.y + b.size / 2 - 0.2,
      draw: (ctx) => {
        const peak = drawBuilding(ctx, b, civ, banner, t, {
          active,
          alert: b.stage ? (alertByBuilding.get(b.id) ?? null) : null,
          selected,
          hovered,
        });
        // Door lanterns and hearths are ambient night lighting, not activity.
        if (night > 0.05) {
          const door = iso(b.x + b.size / 2, b.y + b.size / 2);
          emitLight(ctx, door.x, door.y - 10, b.kind === "towncenter" ? 110 : 60, warmLight);
          if (b.kind === "observatory") emitLight(ctx, c.x, c.y - 130, 90, violetLight);
          ctx.fillStyle = "#ffd27a";
          ctx.fillRect(door.x - 1.5, door.y - 14, 3, 4);
        }
        if (hovered || selected || zoom > 1.25)
          plaque(ctx, c.x, peak, b.name, selected ? "#ffe08a" : "#f1e3bf", 11);
      },
    });
  }
  for (const k of kingdoms) {
    const c = iso(k.origin.x + 0.5, k.origin.y + 0.5);
    out.drawables.push({
      depth: k.origin.x + k.origin.y + 3.2,
      draw: (ctx) =>
        ribbon(ctx, c.x, c.y + 64, k.name, k.banner, k.research ? "Research realm · ring-fenced" : null),
    });
  }
  const capital = iso(world.capital.x, world.capital.y);
  const market = iso(world.market.x, world.market.y);
  out.drawables.push({
    depth: 9999,
    draw: (ctx) =>
      ribbon(ctx, capital.x, capital.y - 200, "GitHub Capital", "#24292f", "Where envoys deliver PRs"),
  });
  out.drawables.push({
    depth: 9999,
    draw: (ctx) =>
      ribbon(ctx, market.x, market.y - 110, "Grand Market", "#5e6ad2", "Linear caravans arrive here"),
  });
}

/** Yards appear once a campaign has reached the Workshop; planned packages in the War Room stay on paper. */
const buildsYards = (c: Campaign) => stageIds.indexOf(c.stage) >= stageIds.indexOf("implement");

function campaignLayer(input: LayerInput, out: Out) {
  const { world, kingdoms, campaigns, t } = input;
  for (const c of campaigns) {
    const k = kingdoms.find((item) => item.id === c.kingdomId);
    if (!k) continue;
    if (c.packages.length && buildsYards(c)) {
      const plots = world.plots.filter((p) => p.kingdomId === k.id);
      const first = out.nextPlot.get(k.id) ?? 0;
      out.nextPlot.set(k.id, first + c.packages.length);
      c.packages.forEach((pkg, i) => {
        const plot = plots[first + i];
        if (!plot) return;
        const p = iso(plot.x, plot.y);
        const label = `${c.id} ${pkg.id}`;
        out.drawables.push({
          depth: plot.x + plot.y + 0.4,
          draw: (ctx) => packageYard(ctx, p.x, p.y, label, pkg.status, k.banner, t, i),
        });
        out.hits.push({
          sel: { kind: "campaign", id: c.id },
          x0: p.x - 26,
          x1: p.x + 26,
          y0: p.y - 44,
          y1: p.y + 12,
          priority: 2,
        });
      });
    }
    const a = input.squadAnchor(c);
    const p = iso(a.x, a.y);
    const run = [...(c.task.runs ?? [])].reverse().find((r) => r.stage === c.stage);
    const policy = roster.settings.stagePolicies[c.stage as keyof typeof roster.settings.stagePolicies];
    const sel = { kind: "campaign", id: c.id } as const;
    out.hits.push({ sel, x0: p.x - 34, x1: p.x + 34, y0: p.y - 70, y1: p.y + 12, priority: 3 });
    const look = {
      id: c.id,
      posture: c.posture,
      running: c.running,
      leader: unitKindFor(run?.model ?? policy?.model),
      team: k.banner,
      selected: sameSelection(input.selection, sel),
      hover: sameSelection(input.hover, sel),
    };
    out.drawables.push({ depth: a.x + a.y + 0.1, draw: (ctx) => squadFigure(ctx, p.x, p.y, look, t) });
    if (c.posture === "external") {
      const lane = world.paths.find((item) => item.kind === "sea");
      if (!lane) continue;
      const s = pointOnPath(lane.points, t * 0.012);
      const sp = iso(s.x, s.y);
      out.drawables.push({
        depth: s.x + s.y,
        draw: (ctx) => {
          drawShip(ctx, sp.x, sp.y, k.banner, t, 0.9);
          plaque(ctx, sp.x, sp.y - 70, `${c.id} · envoy at sea`, postureStyle.external.color, 10);
        },
      });
      out.hits.push({ sel, x0: sp.x - 30, x1: sp.x + 30, y0: sp.y - 70, y1: sp.y + 8, priority: 3 });
    }
  }
}

function researchLayer(input: LayerInput, out: Out) {
  const { world, kingdoms, t } = input;
  const research = kingdoms.find((k) => k.research);
  if (!research) return;
  const running = researchQuestions.filter((q) => q.grade === "running").length;
  const mine = world.buildings.find((b) => b.kingdomId === research.id && b.kind === "mine");
  const lodge = world.buildings.find((b) => b.kingdomId === research.id && b.kind === "lodge");
  if (mine) {
    const seam =
      world.decor.find((d) => d.kind === "gold" && Math.hypot(d.x - mine.x, d.y - mine.y) < 3.5) ?? mine;
    for (let i = 0; i < running * 3; i++) {
      const phase = (t * 0.18 + i / 3) % 1;
      const f = phase < 0.5 ? phase * 2 : 2 - phase * 2;
      const x = mine.x + (seam.x - mine.x) * f + (i - 1) * 0.3;
      const y = mine.y + (seam.y - mine.y) * f + 0.8;
      const sp = iso(x, y);
      const atSeam = f > 0.92;
      out.drawables.push({
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
  }
  if (lodge && running) {
    const phase = (t * 0.05) % 1;
    const f = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    const x = lodge.x + Math.cos(-0.6) * f * 10;
    const y = lodge.y + Math.sin(-0.6) * f * 10 + 1;
    const sp = iso(x, y);
    out.drawables.push({
      depth: x + y,
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

function ambientLayer(input: LayerInput, out: Out) {
  const { world, kingdoms, t } = input;
  for (const path of world.paths) {
    const k = kingdoms.find((item) => path.id.endsWith(item.id));
    if (path.kind === "ring") {
      for (let i = 0; i < 3; i++) {
        const dirn = i % 2 ? -1 : 1;
        const q = pointOnPath(path.points, i / 3 + dirn * t * 0.012);
        const sp = iso(q.x, q.y);
        out.drawables.push({
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
      out.drawables.push({
        depth: q.x + q.y,
        draw: (ctx) => drawCart(ctx, sp.x, sp.y, "#5e6ad2", t, phase < 1 ? q.dir : -q.dir),
      });
    }
  }
}

function replayLayer(input: LayerInput, frame: ReplayFrame, out: Out) {
  const { world, kingdoms, t } = input;
  const k = kingdoms.find((item) => item.id === replayCampaign.kingdomId);
  if (!k) return;
  // Package yards for the replay campaign, once it reaches the Workshop.
  const reachedWorkshop = frame.candidate !== null || frame.packages.some((p) => p.status !== "planned");
  if (reachedWorkshop) {
    const plots = world.plots.filter((p) => p.kingdomId === k.id);
    const first = out.nextPlot.get(k.id) ?? 0;
    frame.packages.forEach((pkg, i) => {
      const plot = plots[first + i];
      if (!plot) return;
      const p = iso(plot.x, plot.y);
      const label = `${replayCampaign.id} ${pkg.id}`;
      out.drawables.push({
        depth: plot.x + plot.y + 0.4,
        draw: (ctx) => packageYard(ctx, p.x, p.y, label, pkg.status, k.banner, t, i),
      });
    });
  }
  const workshop = input.stageBuilding(k.id, "implement");
  if (workshop && frame.candidate) {
    const c = iso(workshop.x, workshop.y);
    out.drawables.push({
      depth: 9990,
      draw: (ctx) => plaque(ctx, c.x, c.y - 104, `Candidate r${frame.candidate}`, "#e9cf85", 12),
    });
  }
  for (const stage of frame.stale) {
    const b = input.stageBuilding(k.id, stage);
    if (!b) continue;
    const c = iso(b.x, b.y);
    out.drawables.push({
      depth: 9990,
      draw: (ctx) => plaque(ctx, c.x, c.y - 96, "Verdict stale · rerun", "#e06a5a", 12),
    });
  }
  // Where the squad is now.
  let point = placePoint(world, k, frame.at, replayLane);
  let facing = 1;
  if (frame.moving && frame.step.kind === "march" && frame.from) {
    const route = marchRoute(world, k, frame.from, frame.at, frame.repair, replayLane);
    const q = pointOnPath(route, Math.min(0.999, frame.progress));
    point = q;
    facing = q.dir;
    if (frame.repair) {
      const pts = route.map((r) => iso(r.x, r.y));
      out.drawables.push({
        depth: 0,
        draw: (ctx) => {
          ctx.strokeStyle = "rgba(200,50,40,0.85)";
          ctx.lineWidth = 6;
          ctx.setLineDash([12, 8]);
          ctx.lineDashOffset = -t * 30;
          ctx.beginPath();
          for (const [i, p] of pts.entries()) {
            if (i) ctx.lineTo(p.x, p.y);
            else ctx.moveTo(p.x, p.y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        },
      });
    }
  }
  if (frame.step.kind === "sail") {
    const lane = world.paths.find((item) => item.kind === "sea")?.points.slice(0, 4) ?? [];
    const s = pointOnPath(lane, Math.min(0.999, frame.progress));
    const sp = iso(s.x, s.y);
    out.replayPoint = s;
    out.drawables.push({
      depth: s.x + s.y,
      draw: (ctx) => {
        drawShip(ctx, sp.x, sp.y, k.banner, t, 1);
        plaque(
          ctx,
          sp.x,
          sp.y - 76,
          `${replayCampaign.id} · envoy · replay`,
          postureStyle.external.color,
          12,
          true,
        );
      },
    });
    return;
  }
  out.replayPoint = point;
  const p = iso(point.x, point.y);
  const sel = { kind: "replay" } as const;
  out.hits.push({ sel, x0: p.x - 34, x1: p.x + 34, y0: p.y - 70, y1: p.y + 12, priority: 4 });
  const look = {
    id: replayCampaign.id,
    label: `${replayCampaign.id} · replay`,
    posture: frame.posture,
    running: frame.posture === "working" ? 1 : 0,
    leader: frame.at === "capital" ? ("envoy" as const) : unitKindFor(frame.model),
    team: k.banner,
    moving: frame.moving,
    facing,
    selected: sameSelection(input.selection, sel),
  };
  out.drawables.push({ depth: point.x + point.y + 0.15, draw: (ctx) => squadFigure(ctx, p.x, p.y, look, t) });
  if (frame.step.scouts && !frame.moving) {
    const b = input.stageBuilding(k.id, "scouts");
    if (b) {
      const out_ = Math.atan2(b.y - k.origin.y, b.x - k.origin.x);
      for (let i = 0; i < 2; i++) {
        const f = Math.sin(Math.min(1, frame.progress) * Math.PI);
        const a = out_ + (i ? 0.5 : -0.5);
        const x = b.x + Math.cos(a) * (1.5 + f * 7);
        const y = b.y + Math.sin(a) * (1.5 + f * 7);
        const sp = iso(x, y);
        out.drawables.push({
          depth: x + y,
          draw: (ctx) =>
            drawUnit(ctx, sp.x, sp.y, {
              kind: "knight",
              team: k.banner,
              t,
              moving: true,
              facing: frame.progress < 0.5 ? 1 : -1,
              phase: i,
            }),
        });
      }
    }
  }
}
