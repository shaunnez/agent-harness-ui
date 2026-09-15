import type { Container, Sprite } from "pixi.js";
import type { StageId } from "../../domain";
import type { TaskSummary } from "../runtime/contracts";
import type { WorldAssets } from "./assets";
import type { WorldEnvironment } from "./environment";

/** Authored scenery and room composition; the scene owns entity/state reconciliation. */
export interface SceneryContext {
  assets: WorldAssets;
  environment: WorldEnvironment;
  container: Container;
  art(id: string, x: number, y: number, scale: number): Sprite | null;
  select(sprite: Sprite | null, kind: "project" | "task", id: string): void;
  shuttle(sprite: Sprite, taskId: string, departing: boolean, scale: number): void;
}

/** Uninhabited landscape carries no project, task or execution identity. */
export function placeCoastalBackdrop(ctx: SceneryContext, x: number, y: number) {
  ctx.art("mf.cinematic.island", x, y, 0.86);
  for (const [dx, dy, scale] of [
    [-100, -70, 0.62],
    [45, -60, 0.68],
    [-230, -5, 0.48],
    [-60, 0, 0.58],
    [140, 5, 0.6],
    [-145, 55, 0.6],
    [15, 75, 0.64],
    [190, 80, 0.48],
    [-65, 130, 0.42],
    [95, 135, 0.4],
  ] as const)
    ctx.art("mf.prop.purple-tree", x + dx, y + dy, scale);
  ctx.art("mf.cinematic.tree", x + 205, y + 25, 0.4);
  ctx.art("mf.prop.rock", x - 105, y + 80, 0.8);
}

export function placeCompound(
  ctx: SceneryContext,
  x: number,
  y: number,
  scale: number,
  roof: boolean,
  id: string,
  cinematic: boolean,
) {
  const room = cinematic && !roof && ctx.assets.has("mf.fidelity.room.floor");
  const prefix = room ? "mf.fidelity.room" : "mf.base.standard";
  ctx.select(ctx.art(`${prefix}.floor`, x, y, scale), "project", id);
  ctx.art(`${prefix}.back`, x, y, scale);
  if (room) {
    const lights = ctx.assets.sprite("mf.fidelity.room.lights", x, y, scale);
    if (lights) {
      lights.eventMode = "none";
      ctx.container.addChild(lights);
      ctx.environment.emission(lights, 0.15, 0.65);
    }
  }
  const variant =
    [...id].reduce((total, letter) => total + letter.charCodeAt(0), 0) % 3 === 0 ? "observatory" : "standard";
  if (roof)
    ctx.select(
      ctx.art(cinematic ? "mf.cinematic.roof" : `mf.base.${variant}.roof`, x, y, scale),
      "project",
      id,
    );
  if (roof && cinematic) {
    const windows = ctx.assets.sprite("mf.living.observatory.lights", x, y, scale);
    if (windows) {
      windows.blendMode = "add";
      windows.eventMode = "none";
      ctx.container.addChild(windows);
      ctx.environment.emission(windows, 0.18, 0.8);
    }
  }
  if (!room) {
    ctx.environment.lamp(ctx.container, x - 145 * scale, y - 75 * scale, scale, 0);
    ctx.environment.lamp(ctx.container, x + 145 * scale, y - 75 * scale, scale, 2);
    ctx.environment.lamp(ctx.container, x, y + 9 * scale, scale, 1);
  }
}

export function placeVegetation(
  art: SceneryContext["art"],
  x: number,
  y: number,
  large: boolean,
  foreground: boolean,
  cinematic = false,
) {
  const trees = foreground
    ? large
      ? [
          [-280, -20, 0.65],
          [310, -35, 0.66],
          [-170, 55, 0.5],
          [230, 20, 0.48],
        ]
      : [
          [-255, -55, 0.4],
          [255, -50, 0.42],
        ]
    : large
      ? [
          [-135, -215, 0.6],
          [-40, -265, 0.55],
          [90, -250, 0.64],
          [210, -175, 0.55],
          [-310, -110, 0.7],
        ]
      : [
          [0, -210, 0.42],
          [-220, -120, 0.35],
          [220, -115, 0.34],
        ];
  trees.forEach(([dx = 0, dy = 0, scale = 1], index) => {
    art(cinematic && index % 3 === 0 ? "mf.cinematic.tree" : "mf.prop.purple-tree", x + dx, y + dy, scale);
  });
  if (foreground) {
    art("mf.prop.rock", x - 150, y + 75, 0.8);
    art("mf.prop.rock", x + 170, y + 35, 0.6);
  }
}

export function placeStation(
  ctx: SceneryContext,
  task: TaskSummary,
  x: number,
  y: number,
  scale: number,
  detail = false,
  stage: StageId = task.currentStage,
) {
  const id =
    stage === task.currentStage && ["generating-designs", "awaiting-design-selection"].includes(task.status)
      ? "projection"
      : {
          triage: "intake",
          scouts: "survey",
          grill: "communications",
          specification: "blueprint",
          plan: "planning",
          implement: "fabrication",
          "dev-review": "inspection",
          test: "diagnostics",
          "final-review": "delivery-inspection",
          approval: "launchpad",
        }[stage];
  if (detail && id === "launchpad") {
    x -= 35 * scale;
    y += 60 * scale;
  }
  ctx.select(ctx.art(`mf.station.${id}`, x + 28 * scale, y - 6 * scale, 0.95 * scale), "task", task.id);
  const socket = ctx.assets.socket(`mf.station.${id}`, "frontToolPort", 0.95 * scale);
  if (id === "launchpad") {
    const dock = ctx.assets.socket("mf.station.launchpad", "shuttleDock", 0.95 * scale);
    const shuttle = ctx.art(
      "mf.vehicle.shuttle",
      x + 28 * scale + dock.x,
      y - 6 * scale + dock.y,
      0.95 * scale * 0.7,
    );
    if (shuttle) {
      const departing = task.status === "completed";
      ctx.shuttle(shuttle, task.id, departing, scale);
    }
  }
  return { x: x + 28 * scale + socket.x, y: y - 6 * scale + socket.y };
}
