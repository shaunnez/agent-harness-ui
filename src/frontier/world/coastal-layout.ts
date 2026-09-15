import type { Point } from "./camera";

export interface PositionedProject {
  id: string;
  position: Point;
}
export interface ProjectConnection {
  from: Point;
  to: Point;
  joint: Point;
}

/** Fixed infrastructure uses the same nearest-prior graph as the original world. */
export function projectConnections(projects: ReadonlyArray<{ position: Point }>): ProjectConnection[] {
  return projects.flatMap((project, index) => {
    if (!index) return [];
    const prior = projects
      .slice(0, index)
      .reduce((nearest, candidate) =>
        Math.hypot(candidate.position.x - project.position.x, candidate.position.y - project.position.y) <
        Math.hypot(nearest.position.x - project.position.x, nearest.position.y - project.position.y)
          ? candidate
          : nearest,
      );
    const [upper, lower] = [prior.position, project.position].sort((a, b) => a.y - b.y);
    if (!upper || !lower) return [];
    const from = { x: upper.x, y: upper.y + 10 };
    const to = { x: lower.x, y: lower.y + 10 };
    const dx = to.x - from.x,
      dy = to.y - from.y;
    const se = dy + dx / 2,
      sw = dy - dx / 2;
    const joint = se >= 0 ? { x: from.x + se, y: from.y + se / 2 } : { x: from.x - sw, y: from.y + sw / 2 };
    return [{ from, to, joint }];
  });
}

export interface CoastalSite {
  projectId: string;
  origin: Point;
  entrance: Point;
  join: Point;
}
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.1;

/** A measured art kit replaces only its compatible real crossing, never an invented connection. */
export function coastalSite(
  projects: PositionedProject[],
  featuredId: string | undefined,
): CoastalSite | null {
  const project = projects.find(({ id }) => id === featuredId);
  if (!project) return null;
  const origin = project.position;
  const entrance = { x: origin.x, y: origin.y + 10 };
  const join = { x: origin.x + 520, y: origin.y - 250 };
  const connected = projectConnections(projects).some(
    ({ from, to, joint }) => (near(from, entrance) || near(to, entrance)) && near(joint, join),
  );
  return connected ? { projectId: project.id, origin, entrance, join } : null;
}

export function coastalSegment(from: Point, to: Point, site: CoastalSite | null) {
  if (!site) return false;
  const onApproach = (point: Point) => {
    const dx = point.x - site.entrance.x;
    return dx >= -0.1 && dx <= 520.1 && Math.abs(point.y - site.entrance.y + dx / 2) < 0.1;
  };
  return onApproach(from) && onApproach(to);
}
export function coastalJoint(point: Point, site: CoastalSite | null) {
  return Boolean(site && near(point, site.join));
}
