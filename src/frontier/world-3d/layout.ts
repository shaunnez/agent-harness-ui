import type { RuntimeProject } from "../../domain.ts";
import type { SceneInput } from "../world/scene.ts";
import { type BaseAppearances, defaultAppearance, projectAppearanceKey, savedSlots } from "./appearance.ts";
import {
  assignSlots,
  type ColonyCamera,
  colonyCameras,
  fitColonyView,
  fitCutawayView,
  hubSlot,
  type Point3,
  slotPosition,
  type Viewport,
  type WorldFit,
} from "./colony.ts";

/**
 * One base per project on the colony lattice. The slot comes from the persisted appearance record
 * when it has one and from the contract fill rule otherwise, so the same projects always land on
 * the same parcels whatever order they arrive in.
 */
export function projectBases(
  projects: RuntimeProject[],
  appearances: BaseAppearances = {},
  includeArchived = false,
) {
  const listed = projects.filter((project) => includeArchived || !project.archivedAt);
  const slots = assignSlots(listed, savedSlots(appearances));
  return orderedProjects(listed).flatMap((project) => {
    const key = projectAppearanceKey(project);
    const appearance = appearances[key] ?? defaultAppearance(project);
    const slot: string | undefined = slots[key];
    if (!slot) return [];
    return [{ project, position: slotPosition(slot), appearance: { ...appearance, slot }, slot }];
  });
}
function orderedProjects(projects: RuntimeProject[]) {
  return [...projects].sort((a, b) => {
    if (a.id === "plancheck") return -1;
    if (b.id === "plancheck") return 1;
    return a.id.localeCompare(b.id);
  });
}
export type ProjectBase = ReturnType<typeof projectBases>[number];
/** The hub parcel is always rendered at H with an empty landing pad. */
export const hubParcel = { slot: hubSlot.id, position: slotPosition(hubSlot.id) };
/** Colony slots in use. */
export function occupiedSlots(bases: ProjectBase[]) {
  return bases.flatMap((base) => (base.slot ? [base.slot] : []));
}
export function locatedProject(input: SceneInput) {
  if (input.location.projectId) return input.projects.find((p) => p.id === input.location.projectId);
  const task = input.tasks.find((item) => item.id === (input.location.taskId ?? input.selectedId));
  return input.projects.find((p) => p.repositoryPath === task?.repositoryPath);
}
export function visibleBases(bases: ProjectBase[], input: SceneInput) {
  if (input.location.view === "world") return bases;
  const project = locatedProject(input);
  return bases.filter((base) => base.project.id === project?.id);
}
export function translated(point: Point3, offset: Point3): Point3 {
  return [point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]];
}
/**
 * Exterior and cutaway cameras are the contract's, translated to the parcel being looked at; the
 * world camera fits every occupied parcel plus the hub into the HUD-safe box. With a legacy (v2)
 * manifest the cameras are the manifest's and the world camera is the archipelago fit.
 */
export function viewCamera(
  bases: ProjectBase[],
  projectId: string | null,
  cutaway: boolean,
  viewport?: Viewport,
): ColonyCamera & Partial<Pick<WorldFit, "viewOffset">> {
  const base = bases.find((entry) => entry.project.id === projectId);
  if (base && cutaway && viewport) return fitCutawayView(base.position, viewport);
  if (base) {
    const camera = cutaway ? colonyCameras.cutaway : colonyCameras.exterior;
    return {
      ...camera,
      position: translated(camera.position, base.position),
      target: translated(camera.target, base.position),
    };
  }
  return fitColonyView(occupiedSlots(bases), viewport);
}
