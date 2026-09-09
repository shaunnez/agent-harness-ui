import type { StageId } from "../../domain.ts";
import type { TaskSummary } from "../runtime/contracts.ts";
import { attentionFor, isOpen } from "../runtime/presentation.ts";

export type WorkAction = "fabricate" | "scan" | "console" | "communicate" | "diagnose" | "inspect";
export const workActions: Record<
  WorkAction,
  { label: string; description: string; color: number; pose: "work" | "scan" | "type"; period: number }
> = {
  fabricate: {
    label: "Fabricating",
    description: "Tool and contact-light loop",
    color: 0xffb662,
    pose: "work",
    period: 1200,
  },
  scan: {
    label: "Surveying",
    description: "Probe sweep and scan field",
    color: 0x65e3ee,
    pose: "scan",
    period: 2400,
  },
  console: {
    label: "At the console",
    description: "Console interaction and projection",
    color: 0xa9a0ff,
    pose: "type",
    period: 1800,
  },
  communicate: {
    label: "Communicating",
    description: "Console interaction and signal pulses",
    color: 0x82d6ff,
    pose: "type",
    period: 2400,
  },
  diagnose: {
    label: "Running diagnostics",
    description: "Probe sweep and diagnostic scan",
    color: 0x6bddd4,
    pose: "scan",
    period: 1600,
  },
  inspect: {
    label: "Inspecting",
    description: "Slow inspection sweep",
    color: 0x9dafff,
    pose: "scan",
    period: 3200,
  },
};
export function workAction(stage: StageId, role?: string | null): WorkAction {
  if (role?.includes("repair") || stage === "implement") return "fabricate";
  if (role?.includes("scout") || stage === "scouts") return "scan";
  if (stage === "test") return "diagnose";
  if (stage === "dev-review" || stage === "final-review" || stage === "approval") return "inspect";
  if (stage === "grill" || stage === "triage") return "communicate";
  return "console";
}
export type WorkerBehavior = "work" | "roam" | "park";
export function workerBehavior(
  task: TaskSummary,
  connected: boolean,
  active: boolean,
  allowRoaming: boolean,
  historical = false,
): WorkerBehavior {
  if (!connected || historical || !isOpen(task)) return "park";
  // An active run is authoritative even when a sibling package is blocked.
  if (active && task.activeRunIds?.length) return "work";
  if (!allowRoaming || task.activeRunIds?.length) return "park";
  return attentionFor(task).kind === "idle" ? "roam" : "park";
}

export interface PatrolPoint {
  x: number;
  y: number;
}
export function actorSeed(id: string) {
  return [...id].reduce((seed, character) => (Math.imul(seed, 31) + character.charCodeAt(0)) >>> 0, 7);
}
/** A bounded authored route, not free random movement or simulated task handoffs. */
export function patrolPose(points: readonly PatrolPoint[], time: number, seed: number, speed: number) {
  if (points.length < 2 || speed <= 0)
    return { ...(points[0] ?? { x: 0, y: 0 }), walking: false, facing: 1, gait: 0 };
  const pause = 1400 + (seed % 1800);
  const legs = points.map((point, index) => {
    const to = points[(index + 1) % points.length] ?? point;
    return { from: point, to, duration: (Math.hypot(to.x - point.x, to.y - point.y) / speed) * 1000 };
  });
  const total = legs.reduce((sum, leg) => sum + pause + leg.duration, 0);
  let elapsed = (((time + (seed % 19000)) % total) + total) % total;
  for (const leg of legs) {
    if (elapsed <= pause + leg.duration) {
      const travel = Math.max(0, elapsed - pause);
      const blend = leg.duration ? travel / leg.duration : 0;
      return {
        x: leg.from.x + (leg.to.x - leg.from.x) * blend,
        y: leg.from.y + (leg.to.y - leg.from.y) * blend,
        walking: travel > 0,
        facing: leg.to.x >= leg.from.x ? 1 : -1,
        gait: travel,
      };
    }
    elapsed -= pause + leg.duration;
  }
  return { ...(points[0] ?? { x: 0, y: 0 }), walking: false, facing: 1, gait: 0 };
}

/** Open forecourt strips are outside the fixed building footprint in each view. */
export function basePatrol(x: number, y: number, index: number, view: "world" | "project") {
  if (view === "project")
    return [
      { x: x - 58, y: y - 49 },
      { x: x - 8, y: y - 24 },
      { x: x + 40, y: y - 48 },
      { x: x - 10, y: y - 73 },
    ];
  const extent = 1;
  const offset = index % 2 === 0 ? -1 : 1;
  return [
    { x: x + (-110 + index * 36) * extent, y: y + (36 + index * 12) * extent },
    { x: x + (-28 + index * 36) * extent, y: y + (72 + index * 12) * extent },
    { x: x + (18 + index * 36) * extent, y: y + (49 + index * 12) * extent },
    { x: x + (-64 + index * 36) * extent, y: y + (14 + index * 12 + offset * 2) * extent },
  ];
}
