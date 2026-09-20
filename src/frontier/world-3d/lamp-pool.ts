import type { Vector3 } from "three";
import type { Point3 } from "./model";

/**
 * Real point lights the scene may run at once. A forward renderer walks every light for every lit
 * fragment, so this is the number that decides what night costs; the station's lamp lenses keep
 * their glow from their own emissive materials whether or not a light is spared for them.
 */
export const lampBudget = 8;
/** Seconds a slot takes to hand its light from one lamp to the next, so neither one pops. */
const lampFade = 0.35;

export interface PooledLamp {
  key: string;
  position: Point3;
  /** Hex colour this lamp throws, or undefined for the station's authored warm white. */
  color?: number;
}
export interface LampSlot {
  key: string | null;
  position: Point3;
  level: number;
  /** Colour of the lamp currently held, carried so the renderer does not re-look it up each frame. */
  color?: number;
}

function toward(level: number, target: number, step: number) {
  return target > level ? Math.min(target, level + step) : Math.max(target, level - step);
}

/**
 * Hands a fixed set of lights to whichever lamps are nearest the viewer. The count never changes,
 * because the light count is a shader define and moving it recompiles every material in the scene;
 * a slot with nothing to light dims instead of switching off.
 */
export class LampPool {
  readonly slots: LampSlot[];
  constructor(budget = lampBudget) {
    this.slots = Array.from({ length: budget }, () => ({
      key: null,
      position: [0, 0, 0] as Point3,
      level: 0,
    }));
  }
  update(lamps: PooledLamp[], viewer: Vector3, delta: number) {
    const near = (lamp: PooledLamp) =>
      (lamp.position[0] - viewer.x) ** 2 +
      (lamp.position[1] - viewer.y) ** 2 +
      (lamp.position[2] - viewer.z) ** 2;
    const ranked = [...lamps].sort((a, b) => near(a) - near(b)).slice(0, this.slots.length);
    const wanted = new Map(ranked.map((lamp) => [lamp.key, lamp] as const));
    const held = new Set<string>();
    for (const slot of this.slots) if (slot.key !== null && wanted.has(slot.key)) held.add(slot.key);
    // What is left is a lamp that has come close enough to light but has no slot yet, so it waits
    // for one to finish dimming rather than cutting in over a lamp that is still lit.
    const waiting = ranked.filter((lamp) => !held.has(lamp.key));
    const step = Math.min(1, delta / lampFade);
    for (const slot of this.slots) {
      if (slot.key !== null && held.has(slot.key)) {
        slot.level = toward(slot.level, 1, step);
        continue;
      }
      slot.level = toward(slot.level, 0, step);
      if (slot.level > 0) continue;
      const next = waiting.pop();
      slot.key = next?.key ?? null;
      if (next) {
        slot.position = next.position;
        slot.color = next.color;
      }
    }
  }
}
