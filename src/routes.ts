import {
  agentRoleIds,
  type AgentRoleId,
  type AppScreen,
  type StageId,
  workflowStages,
} from "./domain.ts";

export type TaskRouteDetail =
  | { kind: "artifact"; artifactId: string }
  | { kind: "candidate-diff"; candidateId: string; revision: number }
  | { kind: "test-result"; resultId: string };

export type ScreenRoute = { kind: "screen"; screen: AppScreen };
export type SkillRoute = { kind: "skill"; skillId: StageId };
export type AgentRoute = { kind: "agent"; agentId: AgentRoleId };
export type TaskRoute = {
  kind: "task";
  taskId: string;
  stageId?: StageId;
  detail?: TaskRouteDetail;
  returnTo?: "command";
};
export type PrimaryRoute = ScreenRoute | SkillRoute | AgentRoute | TaskRoute;
export type ChangelogRoute = {
  kind: "changelog";
  commitSha?: string;
  filePath?: string;
  returnTo: PrimaryRoute;
};
export type HashRoute = PrimaryRoute | ChangelogRoute;

export type ParsedHashRoute = { route: HashRoute; valid: boolean };

const defaultRoute: ScreenRoute = { kind: "screen", screen: "command" };
const screens = new Set<AppScreen>(["command", "tasks", "skills", "agents", "settings"]);
const stages = new Set<StageId>(workflowStages.map((stage) => stage.id));
const agents = new Set<AgentRoleId>(agentRoleIds);

export function parseHashRoute(hash: string): ParsedHashRoute {
  return parseHashRouteInternal(hash, true);
}

export function serializeHashRoute(route: HashRoute): string {
  if (route.kind === "changelog") {
    const detail = route.filePath
      ? `/commit/${encode(route.commitSha ?? "")}/file/${encode(route.filePath)}`
      : route.commitSha
        ? `/commit/${encode(route.commitSha)}`
        : "";
    const returnPath = serializePrimaryRoute(route.returnTo).replace(/^#\//, "");
    return `#/changelog${detail}?from=${encodeURIComponent(returnPath)}`;
  }
  return serializePrimaryRoute(route);
}

export function appScreenForRoute(route: PrimaryRoute): AppScreen {
  if (route.kind === "screen") return route.screen;
  if (route.kind === "skill") return "skills";
  if (route.kind === "agent") return "agents";
  return "tasks";
}

export function parentTaskRoute(route: TaskRoute): TaskRoute {
  return { ...route, detail: undefined };
}

export function changelogRoute(returnTo: PrimaryRoute, commitSha?: string, filePath?: string): ChangelogRoute {
  return { kind: "changelog", returnTo, commitSha, filePath };
}

function parseHashRouteInternal(hash: string, allowChangelog: boolean): ParsedHashRoute {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?", 2);
  const decoded = decodeSegments(path ?? "");
  if (!decoded) return invalidRoute();
  const [screen, ...parts] = decoded;
  if (!screen) return { route: defaultRoute, valid: true };
  if (screen === "changelog" && allowChangelog) return parseChangelog(parts, query);
  if (!screens.has(screen as AppScreen)) return invalidRoute();
  if (screen === "skills") return parseSkill(parts);
  if (screen === "agents") return parseAgent(parts);
  if (screen === "tasks") return parseTask(parts, query);
  return parts.length === 0 ? { route: { kind: "screen", screen: screen as AppScreen }, valid: true } : invalidRoute();
}

function parseSkill(parts: string[]): ParsedHashRoute {
  if (parts.length === 0) return { route: { kind: "screen", screen: "skills" }, valid: true };
  if (parts.length === 1 && stages.has(parts[0] as StageId)) {
    return { route: { kind: "skill", skillId: parts[0] as StageId }, valid: true };
  }
  return invalidRoute();
}

function parseAgent(parts: string[]): ParsedHashRoute {
  if (parts.length === 0) return { route: { kind: "screen", screen: "agents" }, valid: true };
  if (parts.length === 1 && agents.has(parts[0] as AgentRoleId)) {
    return { route: { kind: "agent", agentId: parts[0] as AgentRoleId }, valid: true };
  }
  return invalidRoute();
}

function parseTask(parts: string[], query: string): ParsedHashRoute {
  if (parts.length === 0) return { route: { kind: "screen", screen: "tasks" }, valid: true };
  const [taskId, stageId, detailKind, detailId, revisionPart, suffix] = parts;
  if (!taskId || (stageId && !stages.has(stageId as StageId))) return invalidRoute();
  const returnTo = readTaskReturnTo(query);
  const route: TaskRoute = {
    kind: "task",
    taskId,
    stageId: stageId as StageId | undefined,
    ...(returnTo ? { returnTo } : {}),
  };
  if (!detailKind) return { route, valid: true };
  if (!stageId) return invalidRoute();
  if (detailKind === "artifacts" && detailId && parts.length === 4) {
    return { route: { ...route, detail: { kind: "artifact", artifactId: detailId } }, valid: true };
  }
  if (detailKind === "candidates" && detailId && /^r\d+$/.test(revisionPart ?? "") && suffix === "diff" && parts.length === 6) {
    return {
      route: {
        ...route,
        detail: { kind: "candidate-diff", candidateId: detailId, revision: Number(revisionPart?.slice(1)) },
      },
      valid: true,
    };
  }
  if (detailKind === "results" && detailId && stageId === "test" && parts.length === 4) {
    return { route: { ...route, detail: { kind: "test-result", resultId: detailId } }, valid: true };
  }
  return invalidRoute();
}

function parseChangelog(parts: string[], query: string): ParsedHashRoute {
  const returnTo = parseReturnTo(query);
  if (parts.length === 0) return { route: changelogRoute(returnTo), valid: true };
  if (parts.length === 2 && parts[0] === "commit" && parts[1]) {
    return { route: changelogRoute(returnTo, parts[1]), valid: true };
  }
  if (parts.length === 4 && parts[0] === "commit" && parts[1] && parts[2] === "file" && parts[3]) {
    return { route: changelogRoute(returnTo, parts[1], parts[3]), valid: true };
  }
  return invalidRoute();
}

function serializePrimaryRoute(route: PrimaryRoute): string {
  if (route.kind === "screen") return `#/${route.screen}`;
  if (route.kind === "skill") return `#/skills/${encode(route.skillId)}`;
  if (route.kind === "agent") return `#/agents/${encode(route.agentId)}`;
  const base = `#/tasks/${encode(route.taskId)}${route.stageId ? `/${encode(route.stageId)}` : ""}`;
  const detail = route.detail?.kind === "artifact"
    ? `/artifacts/${encode(route.detail.artifactId)}`
    : route.detail?.kind === "candidate-diff"
      ? `/candidates/${encode(route.detail.candidateId)}/r${route.detail.revision}/diff`
      : route.detail?.kind === "test-result"
        ? `/results/${encode(route.detail.resultId)}`
        : "";
  return `${base}${detail}${route.returnTo === "command" ? "?from=command" : ""}`;
}

function parseReturnTo(query: string): PrimaryRoute {
  const from = new URLSearchParams(query).get("from");
  if (!from) return defaultRoute;
  const parsed = parseHashRouteInternal(`#/${from.replace(/^#\/?/, "")}`, false);
  return parsed.valid && parsed.route.kind !== "changelog" ? parsed.route : defaultRoute;
}

function readTaskReturnTo(query: string) {
  return new URLSearchParams(query).get("from") === "command" ? "command" : undefined;
}

function decodeSegments(path: string) {
  try {
    return path.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

function encode(value: string) {
  return encodeURIComponent(value);
}

function invalidRoute(): ParsedHashRoute {
  return { route: defaultRoute, valid: false };
}
