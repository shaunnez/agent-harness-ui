import type { RuntimeProject, StageId } from "../../domain";
import type { WorldLocation } from "../app/navigation";
import type { TaskSummary } from "../runtime/contracts";
import type { EnvironmentPreferences } from "./environment-model";

/**
 * Everything the world draws from: the projects and tasks the gateway last handed over, where the
 * operator is, and the local view preferences. `mode` records which gateway that was -- fixture or
 * live -- and nothing branches on it any more.
 */
export interface SceneInput {
  mode: "fixture" | "live";
  placementNamespace?: string;
  projects: RuntimeProject[];
  tasks: TaskSummary[];
  location: WorldLocation;
  selectedId: string | null;
  connected: boolean;
  motion: boolean;
  watchedRunActive: boolean;
  cameraSensitivity?: number;
  idleRoaming?: boolean;
  environment?: EnvironmentPreferences;
  watchedStage?: StageId;
  watchedRole?: string | null;
}
