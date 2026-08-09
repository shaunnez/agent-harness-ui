const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

export function projectTaskSummary(task) {
  const artifacts = (task.artifacts ?? []).map(projectArtifactMetadata);
  const { events = [], runs = [], ...core } = task;
  return {
    ...core,
    artifacts,
    artifactCount: artifacts.length,
    eventCount: events.length,
    runCount: runs.length,
  };
}

export function projectTaskCore(task) {
  const { events = [], runs = [], artifacts = [], ...core } = task;
  return {
    ...core,
    artifacts: [],
    artifactCount: artifacts.length,
    eventCount: events.length,
    runCount: runs.length,
  };
}

export function projectArtifactMetadata(artifact) {
  const {
    content: _content,
    contextManifest: _contextManifest,
    focusedTest: _focusedTest,
    gateResult: _gateResult,
    freshness: _freshness,
    ...metadata
  } = artifact;
  return metadata;
}

export function paginateTaskEvents(task, searchParams) {
  const filter = normalizeActivityFilter(searchParams.get("filter"));
  const items = filterEvents(task.events ?? [], filter);
  return paginate(items, searchParams, eventSortKey);
}

export function paginateTaskRuns(task, searchParams) {
  const filter = normalizeActivityFilter(searchParams.get("filter"));
  const runs = filter === "test"
    ? (task.runs ?? []).filter((run) => run.stage === "test" || run.kind === "test")
    : filter === "agent"
      ? (task.runs ?? []).filter((run) => run.stage !== "test" && run.kind !== "test")
      : task.runs ?? [];
  return paginate(runs, searchParams, runSortKey);
}

export function paginateTaskArtifacts(task, searchParams) {
  const page = paginate(task.artifacts ?? [], searchParams, artifactSortKey);
  return { ...page, items: page.items.map(projectArtifactMetadata) };
}

export function findTaskArtifact(task, artifactId) {
  if (!task) return null;
  return (task.artifacts ?? []).find((artifact) => artifact.id === artifactId) ?? null;
}

function paginate(items, searchParams, keyFor) {
  const limit = normalizePageLimit(searchParams.get("limit"));
  const cursor = decodePageCursor(searchParams.get("cursor"));
  const sorted = [...items].sort((left, right) => compareKeys(keyFor(right), keyFor(left)));
  const eligible = cursor
    ? sorted.filter((item) => compareKeys(keyFor(item), cursor) < 0)
    : sorted;
  const pageItems = eligible.slice(0, limit);
  const hasMore = eligible.length > pageItems.length;
  return {
    items: pageItems,
    total: sorted.length,
    nextCursor: hasMore && pageItems.length
      ? encodePageCursor(keyFor(pageItems.at(-1)))
      : null,
  };
}

export function normalizePageLimit(value) {
  if (value == null || value === "") return DEFAULT_PAGE_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_LIMIT) {
    const error = new Error(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.`);
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

export function normalizeActivityFilter(value) {
  if (value == null || value === "" || value === "all") return "all";
  if (!["activity", "agent", "test", "decision"].includes(value)) {
    const error = new Error("filter must be all, activity, agent, test, or decision.");
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function filterEvents(events, filter) {
  if (filter === "all") return events;
  if (filter === "decision") {
    return events.filter((event) => event.category === "decision" || event.decisionId || event.approvalId);
  }
  if (filter === "test") {
    return events.filter((event) => event.runKind === "test" || event.role === "test");
  }
  if (filter === "agent") {
    return events.filter((event) => event.category === "agent" && event.runKind !== "test" && event.role !== "test");
  }
  return events.filter((event) => event.category === "activity" || event.category === "artifact");
}

function eventSortKey(event) {
  return [String(event.at ?? ""), String(event.id ?? "")];
}

function runSortKey(run) {
  return [String(run.startedAt ?? run.completedAt ?? ""), String(run.id ?? "")];
}

function artifactSortKey(artifact) {
  return [String(artifact.createdAt ?? ""), String(artifact.id ?? "")];
}

function compareKeys(left, right) {
  const primary = left[0].localeCompare(right[0]);
  return primary || left[1].localeCompare(right[1]);
}

export function encodePageCursor(key) {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

export function decodePageCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((part) => typeof part !== "string")) {
      throw new Error("invalid cursor shape");
    }
    return parsed;
  } catch {
    const error = new Error("cursor is invalid.");
    error.statusCode = 400;
    throw error;
  }
}
