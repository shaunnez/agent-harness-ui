import { type Container, Graphics, type Sprite } from "pixi.js";
import type { TaskSummary } from "../runtime/contracts";
import type { WorldAssets } from "./assets";
import { cinematicWorker } from "./cinematic-catalog";

export interface WorkerMotion {
  light: Graphics;
  tool?: Sprite | null;
  active: boolean;
  offset: number;
  animation?: { sprite: Sprite; frames: readonly string[]; frameDurationMs: number };
}

/** Poses follow runtime execution; selection and attention remain independent of animation. */
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
): WorkerMotion | undefined {
  const art = (id: string, px: number, py: number, size: number) => {
    const sprite = assets.sprite(id, px, py, size);
    if (sprite) container.addChild(sprite);
    return sprite;
  };
  const selectable = (sprite: Sprite | null, kind: "project" | "task", id: string) => {
    if (!sprite) return;
    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", () => pick(kind, id));
  };
  if (!(task.runCount || task.activeRunIds?.length)) return;
  if (cinematic && assets.has("mf.cinematic.worker.idle")) {
    const working = active && contact;
    const id = working ? "mf.cinematic.worker.work.0" : "mf.cinematic.worker.idle";
    const assetScale = 0.4 * scale;
    if (working) {
      const probe = assets.socket(id, "probeTip", assetScale);
      x = contact.x - probe.x;
      y = contact.y - probe.y;
    }
    container.addChild(
      new Graphics().ellipse(x, y, 19 * scale, 8 * scale).fill({ color: 0x121c20, alpha: 0.24 }),
    );
    const ring = new Graphics()
      .ellipse(x, y, 23 * scale, 10 * scale)
      .stroke({ color: selected ? 0x57b0ff : 0x769099, width: selected ? 3 : 1, alpha: selected ? 1 : 0.35 });
    container.addChild(ring);
    const sprite = art(id, x, y, assetScale);
    selectable(sprite, "task", task.id);
    const light = new Graphics().circle(0, 0, 2 * scale).fill(0xffbc64);
    light.position.set(working ? contact.x : x + 24 * scale, working ? contact.y : y - 15 * scale);
    light.visible = active;
    container.addChild(light);
    return {
      light,
      active,
      offset: x,
      animation:
        working && sprite
          ? { sprite, frames: cinematicWorker.frames, frameDurationMs: cinematicWorker.frameDurationMs }
          : undefined,
    };
  }
  const working = active && contact && assets.has("mf.worker.standard.se.working");
  const facing = [...task.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 2 ? "sw" : "se";
  const assetScale = (working || detail ? 0.2 : 0.4) * scale;
  if (working) {
    const probe = assets.socket("mf.worker.standard.se.working", "probeTip", assetScale);
    x = contact.x - probe.x;
    y = contact.y - probe.y;
  }
  // Graphics are operational selection/attention effects, never replacements for object art.
  const ring = new Graphics()
    .ellipse(x, y, 23 * scale, 10 * scale)
    .stroke({ color: selected ? 0x57b0ff : 0x769099, width: selected ? 3 : 1, alpha: selected ? 1 : 0.35 });
  container.addChild(ring);
  let tool: Sprite | null = null;
  if (working) {
    const body = assets.part("mf.worker.standard.se.working", "body", x, y, assetScale);
    tool = assets.part("mf.worker.standard.se.working", "forearm-probe", x, y, assetScale);
    if (body) container.addChild(body);
    if (tool) container.addChild(tool);
    selectable(body, "task", task.id);
    selectable(tool, "task", task.id);
  } else
    selectable(
      art(
        detail ? "mf.worker.standard.detail.neutral" : `mf.worker.standard.${facing}.neutral`,
        x,
        y,
        assetScale,
      ),
      "task",
      task.id,
    );
  const light = new Graphics().circle(0, 0, 2 * scale).fill(0xffbc64);
  light.position.set(working ? contact.x : x + 24 * scale, working ? contact.y : y - 15 * scale);
  light.visible = active;
  container.addChild(light);
  return { light, tool, active, offset: x };
}
