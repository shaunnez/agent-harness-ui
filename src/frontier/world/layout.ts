import type { RuntimeProject } from "../../domain";
import type { TaskSummary } from "../runtime/contracts";
import type { Point } from "./camera";

interface PlacementStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
function localPlacementStorage(): PlacementStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
export class ProjectPlacement {
  private positions = new Map<string, Point>();
  private storage: PlacementStorage | undefined;
  private placementKey: string;
  constructor(storage: PlacementStorage | undefined = localPlacementStorage(), namespace = "live") {
    this.storage = storage;
    this.placementKey = `mission-frontier:placements:v3:${namespace}`;
    try {
      const saved: unknown = JSON.parse(storage?.getItem(this.placementKey) ?? "[]");
      if (Array.isArray(saved))
        for (const item of saved.slice(0, 10000)) {
          if (
            Array.isArray(item) &&
            typeof item[0] === "string" &&
            item[1] &&
            Number.isFinite(item[1].x) &&
            Number.isFinite(item[1].y)
          )
            this.positions.set(item[0], item[1]);
        }
    } catch {
      /* A corrupt display preference falls back to deterministic placement. */
    }
  }
  locate(projects: RuntimeProject[]) {
    let changed = false;
    for (const project of [...projects].sort(
      (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id),
    )) {
      if (!this.positions.has(project.id)) {
        this.positions.set(project.id, projectPosition(this.positions.size));
        changed = true;
      }
    }
    if (changed)
      try {
        this.storage?.setItem(this.placementKey, JSON.stringify([...this.positions]));
      } catch {
        /* The session still keeps stable allocation when storage is unavailable. */
      }
    return projects.map((project) => ({
      ...project,
      position: this.positions.get(project.id) ?? { x: 0, y: 0 },
    }));
  }
}
function projectPosition(index: number): Point {
  // The first three landmarks form the authored opening; later bases extend the world.
  const first = [
    { x: 280, y: 610 },
    { x: 340, y: 120 },
    { x: 1090, y: 560 },
  ];
  if (first[index]) return first[index];
  const offset = index - 3;
  return { x: 400 + (offset % 5) * 610, y: 1150 + Math.floor(offset / 5) * 500 };
}
export function taskSite(index: number): Point {
  const cells = [
    [-1, 0],
    [0, -1],
    [0, 0],
    [-1, -1],
  ];
  for (let radius = 1; cells.length <= index; radius++) {
    for (let i = -radius; i <= radius; i++)
      for (let j = -radius; j <= radius; j++)
        if (Math.max(Math.abs(i), Math.abs(j)) === radius && !cells.some(([x, y]) => x === i && y === j))
          cells.push([i, j]);
  }
  const [i = 0, j = 0] = cells[index] ?? [];
  return { x: (i - j) * 211.2, y: (i + j) * 105.6 };
}
export function tasksInProject(tasks: TaskSummary[], project: RuntimeProject) {
  const path = project.repositoryPath.replace(/\/+$/, "");
  return tasks.filter((task) => task.repositoryPath.replace(/\/+$/, "") === path);
}

export class TransitionTracker {
  private records = new Map<string, { stage: string; version: string; completed: boolean }>();
  private seeded = false;
  reset() {
    this.seeded = false;
  }
  reconcile(tasks: TaskSummary[], connected: boolean) {
    if (!connected) {
      this.seeded = false;
      return [];
    }
    const transitions: string[] = [];
    for (const task of tasks) {
      const previous = this.records.get(task.id);
      const version = task.pollVersion ?? task.updatedAt;
      const completed = task.status === "completed";
      if (
        this.seeded &&
        previous &&
        previous.version !== version &&
        (previous.stage !== task.currentStage || (!previous.completed && completed))
      )
        transitions.push(task.id);
      this.records.set(task.id, { stage: task.currentStage, version, completed });
    }
    this.seeded = true;
    return transitions;
  }
}
