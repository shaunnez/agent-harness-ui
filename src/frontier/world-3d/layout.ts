import type { RuntimeProject } from "../../domain.ts";
import type { SceneInput } from "../world/scene.ts";
import { type BaseAppearances, defaultAppearance, projectAppearanceKey } from "./appearance.ts";
import type { Point3, ProofCamera, ProofManifest } from "./model.ts";

export function projectBases(projects: RuntimeProject[], appearances: BaseAppearances = {}) {
  const ordered = projects
    .filter((project) => !project.archivedAt)
    .sort((a, b) => {
      if (a.id === "plancheck") return -1;
      if (b.id === "plancheck") return 1;
      return a.id.localeCompare(b.id);
    });
  return ordered.map((project, index) => {
    // A staggered coastal archipelago in the camera's ground-plane axes.
    const column = index % 3;
    const row = Math.floor(index / 3);
    const horizontal = ([-22, -37, 40][column] ?? -37) + (row % 2) * 20;
    const depth = ([-30, 64, 21][column] ?? -30) + row * 108;
    const position: Point3 = [horizontal * 0.781 - depth * 0.625, 0, -horizontal * 0.625 - depth * 0.781];
    return {
      project,
      position,
      appearance: appearances[projectAppearanceKey(project)] ?? defaultAppearance(project),
    };
  });
}
export type ProjectBase = ReturnType<typeof projectBases>[number];
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
export function viewCamera(
  bases: ProjectBase[],
  manifest: ProofManifest,
  projectId: string | null,
  cutaway: boolean,
): ProofCamera {
  const base = bases.find((entry) => entry.project.id === projectId);
  if (base) {
    const camera = cutaway ? manifest.cameras.cutaway : manifest.cameras.exterior;
    return {
      ...camera,
      position: translated(camera.position, base.position),
      target: translated(camera.target, base.position),
    };
  }
  const center: Point3 = [
    bases.reduce((sum, entry) => sum + entry.position[0], 0) / Math.max(1, bases.length),
    3,
    bases.reduce((sum, entry) => sum + entry.position[2], 0) / Math.max(1, bases.length),
  ];
  return {
    position: translated([140, 122.5, 175], center),
    target: center,
    verticalSpan: bases.length < 2 ? 62 : 137 + Math.max(0, Math.ceil(bases.length / 3) - 1) * 64,
  };
}
