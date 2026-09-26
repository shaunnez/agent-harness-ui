// Pure replay state: what the sample campaign looks like at a given second.
import type { StageId } from "../../domain.ts";
import type { Posture } from "../realm.ts";
import type { ReplayPackage, ReplayPlace, ReplayStep } from "./script.ts";

export interface ReplayFrame {
  t: number;
  index: number;
  step: ReplayStep;
  progress: number;
  at: ReplayPlace;
  from: ReplayPlace | null;
  moving: boolean;
  repair: boolean;
  posture: Posture;
  caption: string;
  model: string;
  packages: ReplayPackage[];
  candidate: number | null;
  completed: StageId[];
  stale: StageId[];
  heralds: string[];
  finished: boolean;
}

export const replayDuration = (script: ReplayStep[]) => script.reduce((sum, step) => sum + step.seconds, 0);

/** Start time of the first step at each stage, for the scrubber's stage marks. */
export function replayMarks(script: ReplayStep[]) {
  const marks: { stage: StageId; t: number }[] = [];
  let t = 0;
  for (const step of script) {
    if (
      step.kind !== "march" &&
      step.at !== "market" &&
      step.at !== "capital" &&
      !marks.some((m) => m.stage === step.at)
    )
      marks.push({ stage: step.at, t });
    t += step.seconds;
  }
  return marks;
}

export function replayFrame(script: ReplayStep[], time: number): ReplayFrame {
  const total = replayDuration(script);
  const t = Math.max(0, Math.min(total, time));
  let start = 0;
  let index = 0;
  let packages: ReplayPackage[] = [];
  let candidate: number | null = null;
  let model = "gpt-6-luna";
  const completed = new Set<StageId>();
  const stale = new Set<StageId>();
  const heralds: string[] = [];
  for (let i = 0; i < script.length; i++) {
    const step = script[i];
    if (!step) break;
    const end = start + step.seconds;
    index = i;
    if (step.packages) packages = step.packages;
    if (step.candidate) candidate = step.candidate;
    if (step.model) model = step.model;
    for (const stage of step.stale ?? []) stale.add(stage);
    for (const stage of step.fresh ?? []) stale.delete(stage);
    if (step.herald) heralds.push(step.herald);
    if (t < end || i === script.length - 1) break;
    for (const stage of step.complete ?? []) {
      completed.add(stage);
      stale.delete(stage);
    }
    start = end;
  }
  const step = script[index] as ReplayStep;
  const progress = step.seconds ? Math.min(1, (t - start) / step.seconds) : 1;
  const finished = t >= total;
  if (finished) for (const stage of step.complete ?? []) completed.add(stage);
  return {
    t,
    index,
    step,
    progress,
    at: step.at,
    from: step.from ?? null,
    moving: (step.kind === "march" || step.kind === "sail") && !finished,
    repair: !!step.repair,
    posture: step.posture,
    caption: step.caption,
    model,
    packages,
    candidate,
    completed: [...completed],
    stale: [...stale],
    heralds,
    finished,
  };
}
