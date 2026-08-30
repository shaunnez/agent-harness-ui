const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const SUMMARY_ARTIFACT_LIMIT = 10;

export function projectTaskSummary(task, retainedCounts = {}) {
  const retainedArtifacts = task.artifacts ?? [];
  const artifacts = projectSummaryArtifacts(retainedArtifacts);
  const events = task.events ?? [];
  const runs = task.runs ?? [];
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    repositoryPath: task.repositoryPath,
    workflow: task.workflow,
    continuedFromTaskId: task.continuedFromTaskId ?? null,
    continuedByTaskId: task.continuedByTaskId ?? null,
    priority: task.priority,
    status: task.status,
    closure: task.closure ?? null,
    archive: task.archive ?? null,
    blocker: task.blocker ?? null,
    repositoryAuthority: task.repositoryAuthority ?? null,
    repositoryAuthorityStatus: task.repositoryAuthorityStatus ?? null,
    planResult: task.planResult ?? null,
    currentStage: task.currentStage,
    completedStages: task.completedStages ?? [],
    stageDispositions: task.stageDispositions ?? {},
    stageRun: task.stageRun,
    stageRunLimit: task.stageRunLimit,
    stageRunLimits: task.stageRunLimits ?? null,
    attemptsByStage: task.attemptsByStage ?? {},
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
    error: task.error ?? null,
    activeRunKind: task.activeRunKind ?? null,
    activeRunIds: task.activeRunIds ?? [],
    models: task.models ?? [],
    agentConfig: task.agentConfig
      ? { model: task.agentConfig.model, reasoning: task.agentConfig.reasoning }
      : undefined,
    usage: task.usage,
    scoutDispatch: task.scoutDispatch ?? null,
    workPackages: (task.workPackages ?? []).map(projectWorkPackageSummary),
    candidates: (task.candidates ?? []).map(projectCandidateSummary),
    gateFreshness: projectGateFreshness(task.gateFreshness),
    artifacts,
    artifactCount: retainedCounts.artifactCount ?? retainedArtifacts.length,
    eventCount: retainedCounts.eventCount ?? events.length,
    runCount: retainedCounts.runCount ?? runs.length,
    pollVersion: String(retainedCounts.pollVersion ?? task.pollVersion ?? task.updatedAt ?? ""),
  };
}

export function projectTaskPollState(task, pollVersion = task.pollVersion ?? task.updatedAt) {
  return {
    id: task.id,
    pollVersion: String(pollVersion ?? ""),
  };
}

function projectSummaryArtifacts(artifacts) {
  const latestByStage = new Map();
  for (const artifact of artifacts) {
    const current = latestByStage.get(artifact.stage);
    if (!current || compareKeys(artifactSortKey(artifact), artifactSortKey(current)) > 0) {
      latestByStage.set(artifact.stage, artifact);
    }
  }
  return [...latestByStage.values()]
    .sort((left, right) => compareKeys(artifactSortKey(left), artifactSortKey(right)))
    .slice(-SUMMARY_ARTIFACT_LIMIT)
    .map(projectArtifactMetadata);
}

function projectWorkPackageSummary(workPackage) {
  const {
    verificationRuns: _verificationRuns,
    retainedContinuation: _retainedContinuation,
    ...summary
  } = workPackage;
  return summary;
}

function projectCandidateSummary(candidate) {
  return {
    id: candidate.id,
    revisionNumber: candidate.revisionNumber,
    baseRevision: candidate.baseRevision,
    baseBranch: candidate.baseBranch,
    baseRef: candidate.baseRef ?? null,
    headRevision: candidate.headRevision ?? null,
    branch: candidate.branch,
    repositoryRoot: candidate.repositoryRoot,
    worktreePath: candidate.worktreePath,
    status: candidate.status,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    sourceWorkflowAttempt: candidate.sourceWorkflowAttempt ?? null,
    sourceWorkflowReservationId: candidate.sourceWorkflowReservationId ?? null,
    revisions: [],
  };
}

function projectGateFreshness(gateFreshness) {
  if (!gateFreshness) return null;
  return Object.fromEntries(
    Object.entries(gateFreshness).map(([stage, freshness]) => {
      if (!freshness) return [stage, freshness];
      const { focusedTest: _focusedTest, focusedTestRows: _focusedTestRows, ...summary } = freshness;
      return [stage, { ...summary, focusedTest: null, focusedTestRows: [] }];
    }),
  );
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
  const runs =
    filter === "test"
      ? (task.runs ?? []).filter((run) => run.stage === "test" || run.kind === "test")
      : filter === "agent"
        ? (task.runs ?? []).filter((run) => run.stage !== "test" && run.kind !== "test")
        : (task.runs ?? []);
  return paginate(runs, searchParams, runSortKey);
}

export function paginateTaskArtifacts(task, searchParams) {
  const page = paginate(task.artifacts ?? [], searchParams, artifactSortKey);
  return searchParams.get("include") === "content"
    ? page
    : { ...page, items: page.items.map(projectArtifactMetadata) };
}

export function findTaskArtifact(task, artifactId) {
  if (!task) return null;
  return (task.artifacts ?? []).find((artifact) => artifact.id === artifactId) ?? null;
}

function paginate(items, searchParams, keyFor) {
  const limit = normalizePageLimit(searchParams.get("limit"));
  const cursor = decodePageCursor(searchParams.get("cursor"));
  const sorted = [...items].sort((left, right) => compareKeys(keyFor(right), keyFor(left)));
  const eligible = cursor ? sorted.filter((item) => compareKeys(keyFor(item), cursor) < 0) : sorted;
  const pageItems = eligible.slice(0, limit);
  const hasMore = eligible.length > pageItems.length;
  return {
    items: pageItems,
    total: sorted.length,
    nextCursor: hasMore && pageItems.length ? encodePageCursor(keyFor(pageItems.at(-1))) : null,
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
    return events.filter(
      (event) => event.category === "agent" && event.runKind !== "test" && event.role !== "test",
    );
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
