import { Container, Graphics, type Sprite } from "pixi.js";
import type { StageId } from "../../domain";
import type { TaskSummary } from "../runtime/contracts";
import { ActivityEffect } from "./activity-effects";
import type { WorldAssets } from "./assets";
import { cinematicWorker } from "./cinematic-catalog";
import type { WorldEnvironment } from "./environment";
import { livingWorker } from "./living-catalog";
import {
  actorSeed,
  type PatrolPoint,
  patrolPose,
  type WorkAction,
  type WorkerBehavior,
  workAction,
  workActions,
} from "./worker-behavior";

export interface WorkerMotion {
  id: string;
  root: Container;
  light: Graphics;
  body: Sprite | null;
  tool?: Sprite | null;
  active: boolean;
  offset: number;
  action: WorkAction;
  effect?: ActivityEffect;
  animation?: { sprite: Sprite; frames: readonly string[]; frameDurationMs: number };
  patrol?: { path: readonly PatrolPoint[]; speed: number; seed: number; spriteScale: number };
  ambient?: boolean;
}
interface WorkerOptions {
  environment: WorldEnvironment;
  behavior: WorkerBehavior;
  stage?: StageId;
  role?: string | null;
}

/** Runtime pose, selection, and environmental animation have independent owners. */
export function createWorker(
  assets: WorldAssets,
  container: Container,
  pick: (kind: "project" | "task", id: string) => void,
  task: TaskSummary,
  x: number,
  y: number,
  scale: number,
  selected: boolean,
  active: boolean,
  detail = false,
  contact?: { x: number; y: number },
  cinematic = false,
  options?: WorkerOptions,
): WorkerMotion | undefined {
  if (!(task.runCount || task.activeRunIds?.length)) return;
  active = options ? options.behavior === "work" : active;
  const action = workAction(options?.stage ?? task.currentStage, options?.role ?? task.activeRunKind);
  const pose = workActions[action].pose;
  const richer = pose !== "work" && assets.has(livingWorker[pose][0] ?? "");
  const frames = richer ? livingWorker[pose as "scan" | "type"] : cinematicWorker.frames;
  const working = active && contact;
  const cinematicBody = cinematic && assets.has("mf.cinematic.worker.idle");
  const facing = actorSeed(task.id) % 2 ? "sw" : "se";
  const id = cinematicBody
    ? working
      ? (frames[0] ?? "mf.cinematic.worker.work.0")
      : "mf.cinematic.worker.idle"
    : working
      ? "mf.worker.standard.se.working"
      : detail
        ? "mf.worker.standard.detail.neutral"
        : `mf.worker.standard.${facing}.neutral`;
  const assetScale = (cinematicBody ? 0.4 : working || detail ? 0.2 : 0.4) * scale;
  if (working) {
    const probe = assets.socket(id, "probeTip", assetScale);
    x = contact.x - probe.x;
    y = contact.y - probe.y;
  }
  const root = new Container();
  root.position.set(x, y);
  container.addChild(root);
  root.addChild(new Graphics().ellipse(0, 1, 18 * scale, 7 * scale).fill({ color: 0x071321, alpha: 0.26 }));
  root.addChild(
    new Graphics()
      .ellipse(0, 0, 23 * scale, 10 * scale)
      .stroke({ color: selected ? 0x57b0ff : 0x769099, width: selected ? 3 : 1, alpha: selected ? 1 : 0.35 }),
  );
  const add = (sprite: Sprite | null) => {
    if (!sprite) return null;
    root.addChild(sprite);
    options?.environment.surface(sprite);
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", () => pick("task", task.id));
    return sprite;
  };
  let body: Sprite | null;
  let tool: Sprite | null = null;
  if (!cinematicBody && working && assets.has(id)) {
    body = add(assets.part(id, "body", 0, 0, assetScale));
    tool = add(assets.part(id, "forearm-probe", 0, 0, assetScale));
  } else body = add(assets.sprite(id, 0, 0, assetScale));
  const light = new Graphics().circle(0, 0, 2 * scale).fill(workActions[action].color);
  light.position.set(working ? contact.x - x : 24 * scale, working ? contact.y - y : -15 * scale);
  light.visible = active;
  root.addChild(light);
  let effect: ActivityEffect | undefined;
  if (working) {
    effect = new ActivityEffect(action, contact.x - x, contact.y - y, scale);
    root.addChild(effect.root);
  }
  const roaming =
    options?.behavior === "roam" && cinematicBody && !detail && assets.has(livingWorker.walk[0] ?? "");
  return {
    id: task.id,
    root,
    body,
    light,
    tool,
    effect,
    action,
    active,
    offset: actorSeed(task.id) % 19000,
    animation:
      cinematicBody && working && body
        ? {
            sprite: body,
            frames,
            frameDurationMs: richer ? livingWorker.frameDurationMs : cinematicWorker.frameDurationMs,
          }
        : undefined,
    patrol:
      roaming && body
        ? {
            path: [
              { x: x - 24, y: y + 27 },
              { x: x + 16, y: y + 47 },
            ],
            speed: 30 * assetScale,
            seed: actorSeed(task.id),
            spriteScale: body.scale.x,
          }
        : undefined,
  };
}

export function createBaseCrew(
  assets: WorldAssets,
  environment: WorldEnvironment,
  container: Container,
  id: string,
  path: readonly PatrolPoint[],
  scale: number,
): WorkerMotion | undefined {
  if (!assets.has(livingWorker.walk[0] ?? "") || !path[0]) return;
  const root = new Container();
  root.eventMode = "none";
  root.position.set(path[0].x, path[0].y);
  container.addChild(root);
  root.addChild(new Graphics().ellipse(0, 1, 16 * scale, 6 * scale).fill({ color: 0x071321, alpha: 0.24 }));
  const body = assets.sprite("mf.cinematic.worker.idle", 0, 0, 0.4 * scale);
  if (!body) return;
  root.addChild(body);
  environment.surface(body);
  const light = new Graphics();
  light.visible = false;
  root.addChild(light);
  // No task ring, task id, status light or clickable execution identity on ambient crew.
  return {
    id,
    root,
    body,
    light,
    active: false,
    ambient: true,
    action: "scan",
    offset: actorSeed(id),
    patrol: { path, speed: 12 * scale, seed: actorSeed(id), spriteScale: body.scale.x },
  };
}

export function tickWorker(item: WorkerMotion, assets: WorldAssets, time: number) {
  if (item.patrol && item.body) {
    const { path, speed, seed, spriteScale } = item.patrol;
    const pose = patrolPose(path, time, seed, speed);
    item.root.position.set(pose.x, pose.y);
    // Flip only the registered sprite around its centred ground anchor.
    item.body.scale.x = spriteScale * pose.facing;
    assets.setFrame(
      item.body,
      pose.walking
        ? (livingWorker.walk[Math.floor(pose.gait / 150) % 8] ?? "mf.cinematic.worker.idle")
        : "mf.cinematic.worker.idle",
    );
  }
  if (!item.active) return;
  item.light.alpha = 0.65 + Math.sin(time * 0.003 + item.offset) * 0.25;
  if (item.tool) item.tool.rotation = (Math.sin(time * 0.0025 + item.offset) * Math.PI) / 45;
  item.effect?.tick(time, item.offset);
  if (item.animation) {
    const { sprite, frames, frameDurationMs } = item.animation;
    assets.setFrame(
      sprite,
      frames[Math.floor((time + item.offset) / frameDurationMs) % frames.length] ?? frames[0] ?? "",
    );
  }
}
