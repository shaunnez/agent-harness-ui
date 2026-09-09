import type { StageId } from "../../domain";

export type Overlay =
  | { kind: "tasks"; projectId?: string }
  | { kind: "projects" | "new-task" | "settings" | "world-settings" | "agents" | "usage" }
  | { kind: "skills"; role?: string }
  | { kind: "project-setup"; projectId?: string }
  | {
      kind: "task" | "grill" | "findings" | "approve" | "task-policies" | "lifecycle";
      taskId: string;
      stage?: StageId;
    }
  | { kind: "artifact"; taskId: string; artifactId: string }
  | { kind: "diff"; taskId: string; candidateId: string; revision: number; headRevision: string };

export function overlayHash(overlay: Overlay) {
  const parts: string[] = [overlay.kind];
  if ("taskId" in overlay) parts.push(overlay.taskId);
  else if ("projectId" in overlay && overlay.projectId) parts.push(overlay.projectId);
  else if ("role" in overlay && overlay.role) parts.push(overlay.role);
  if ("artifactId" in overlay) parts.push(overlay.artifactId);
  else if ("candidateId" in overlay)
    parts.push(overlay.candidateId, String(overlay.revision), overlay.headRevision);
  else if ("stage" in overlay && overlay.stage) parts.push(overlay.stage);
  return parts.map(encodeURIComponent).join("/");
}
export function parseOverlay(hash: string): Overlay | null {
  try {
    const [kind, id, detail, revision, headRevision] = hash
      .replace(/^#\/?/, "")
      .split("/")
      .map(decodeURIComponent);
    if (
      kind === "diff" &&
      id &&
      detail &&
      /^\d+$/.test(revision ?? "") &&
      Number(revision) > 0 &&
      headRevision
    )
      return { kind, taskId: id, candidateId: detail, revision: Number(revision), headRevision };
    if (
      kind === "projects" ||
      kind === "new-task" ||
      kind === "settings" ||
      kind === "world-settings" ||
      kind === "agents" ||
      kind === "usage"
    )
      return { kind };
    if (kind === "skills") return { kind, role: id || undefined };
    if (kind === "tasks" || kind === "project-setup") return { kind, projectId: id || undefined };
    if (kind === "artifact" && id && detail) return { kind, taskId: id, artifactId: detail };
    if (["task", "grill", "findings", "approve", "task-policies", "lifecycle"].includes(kind ?? "") && id) {
      const stage = [
        "triage",
        "scouts",
        "grill",
        "specification",
        "plan",
        "implement",
        "dev-review",
        "test",
        "final-review",
        "approval",
      ].includes(detail ?? "")
        ? (detail as StageId)
        : undefined;
      return {
        kind: kind as "task" | "grill" | "findings" | "approve" | "task-policies" | "lifecycle",
        taskId: id,
        stage,
      };
    }
  } catch {
    /* A malformed hash returns to the world. */
  }
  return null;
}
