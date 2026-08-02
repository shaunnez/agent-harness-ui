export const TASK_STORE_SCHEMA_VERSION = 2;

export function migrateRunActivityState(state) {
  const incomingVersion = Number.isInteger(state.schemaVersion) ? state.schemaVersion : 1;
  if (incomingVersion > TASK_STORE_SCHEMA_VERSION) {
    throw new Error(
      `Task data schema ${incomingVersion} is newer than this runtime supports (${TASK_STORE_SCHEMA_VERSION}).`,
    );
  }

  let changed = state.schemaVersion !== TASK_STORE_SCHEMA_VERSION;
  for (const task of state.tasks ?? []) {
    if (!Array.isArray(task.runs)) {
      task.runs = [];
      changed = true;
    }
    if (!Array.isArray(task.activeRunIds)) {
      task.activeRunIds = [];
      changed = true;
    }
    if (incomingVersion < 2) changed = migrateArtifactRuns(task) || changed;
  }
  state.schemaVersion = TASK_STORE_SCHEMA_VERSION;
  return changed;
}

export function beginAgentRun(task, input) {
  task.runs ??= [];
  task.activeRunIds ??= [];
  const startedAt = input.startedAt ?? new Date().toISOString();
  const relatedRuns = task.runs.filter((run) => sameRunScope(run, input));
  const retryOfRunId = relatedRuns.at(-1)?.id ?? null;
  const repairOfRunId = input.kind === "repair" ? findRepairSource(task, input) : null;
  const run = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    status: "running",
    stage: input.stage,
    role: input.role ?? null,
    model: input.model ?? null,
    reasoning: input.reasoning ?? null,
    startedAt,
    completedAt: null,
    durationMs: null,
    artifactId: null,
    usage: null,
    credits: null,
    apiEstimate: null,
    candidateId: input.candidateId ?? null,
    candidateRevision: input.candidateRevision ?? null,
    workPackageId: input.workPackageId ?? null,
    attempt: relatedRuns.length + 1,
    retryOfRunId,
    repairOfRunId,
    toolCalls: [],
    test: null,
    gateResult: null,
    error: null,
    source: "codex-jsonl",
  };
  task.runs.push(run);
  task.activeRunIds.push(run.id);
  return run;
}

export function completeAgentRun(task, runId, input) {
  const run = task.runs?.find((item) => item.id === runId);
  if (!run) return null;
  const completedAt = input.completedAt ?? new Date().toISOString();
  run.status = input.status ?? "completed";
  run.completedAt = completedAt;
  run.durationMs = validDuration(input.durationMs)
    ? input.durationMs
    : durationBetween(run.startedAt, completedAt);
  run.usage = input.usage ? structuredClone(input.usage) : null;
  run.credits = finiteOrNull(input.usage?.credits);
  run.apiEstimate = finiteOrNull(input.usage?.cost);
  run.error = input.error ? String(input.error).slice(0, 5_000) : null;
  run.toolCalls = mergeToolCalls(run.toolCalls, input.runtimeEvents);
  task.activeRunIds = (task.activeRunIds ?? []).filter((id) => id !== runId);
  return run;
}

export function attachRunArtifact(task, runId, artifact) {
  if (!runId) return null;
  const run = task.runs?.find((item) => item.id === runId);
  if (!run) return null;
  run.artifactId = artifact.id;
  run.test = summarizeTest(artifact.focusedTest);
  run.gateResult = artifact.gateResult ? structuredClone(artifact.gateResult) : null;
  return run;
}

export function interruptActiveRuns(task, completedAt, error) {
  let changed = false;
  for (const run of task.runs ?? []) {
    if (run.status !== "running") continue;
    run.status = "interrupted";
    run.completedAt = completedAt;
    run.durationMs = durationBetween(run.startedAt, completedAt);
    run.error = error;
    changed = true;
  }
  task.activeRunIds = [];
  return changed;
}

export function runEventMetadata(run, overrides = {}) {
  if (!run) return overrides;
  return {
    runId: run.id,
    runKind: run.kind,
    role: run.role,
    model: run.model,
    reasoning: run.reasoning,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    artifactId: run.artifactId,
    usage: run.usage,
    credits: run.credits,
    apiEstimate: run.apiEstimate,
    retryOfRunId: run.retryOfRunId,
    repairOfRunId: run.repairOfRunId,
    ...overrides,
  };
}

export function runKindFor(stage, role, workPackageId = null) {
  if (role === "repair") return "repair";
  if (String(role ?? "").startsWith("scout-")) return "scout";
  if (stage === "implement" || workPackageId) return "implementation";
  if (stage === "dev-review") return "review";
  if (stage === "test") return "test";
  if (stage === "final-review") return "final-review";
  return "agent";
}

function migrateArtifactRuns(task) {
  let changed = false;
  const knownRunIds = new Set(task.runs.map((run) => run.id));
  for (const artifact of task.artifacts ?? []) {
    if (artifact.runId && knownRunIds.has(artifact.runId)) continue;
    const runId = uniqueLegacyRunId(knownRunIds, artifact.id);
    const usage = artifact.usage ? structuredClone(artifact.usage) : null;
    const run = {
      id: runId,
      kind: "historical-artifact",
      status: "completed",
      stage: artifact.stage,
      role: artifact.agentRole ?? null,
      model: artifact.model ?? null,
      reasoning: artifact.reasoning ?? null,
      startedAt: artifact.startedAt ?? null,
      completedAt: artifact.completedAt ?? artifact.createdAt ?? null,
      durationMs: validDuration(artifact.durationMs)
        ? artifact.durationMs
        : durationBetween(artifact.startedAt, artifact.completedAt ?? artifact.createdAt),
      artifactId: artifact.id,
      usage,
      credits: finiteOrNull(usage?.credits),
      apiEstimate: finiteOrNull(usage?.cost),
      candidateId: artifact.candidateId ?? null,
      candidateRevision: artifact.candidateRevision ?? null,
      workPackageId: artifact.workPackageId ?? null,
      attempt: null,
      retryOfRunId: null,
      repairOfRunId: null,
      toolCalls: [],
      test: summarizeTest(artifact.focusedTest),
      gateResult: artifact.gateResult ? structuredClone(artifact.gateResult) : null,
      error: null,
      source: "artifact-migration",
    };
    task.runs.push(run);
    artifact.runId = runId;
    knownRunIds.add(runId);
    changed = true;
  }
  return changed;
}

function sameRunScope(run, input) {
  return run.stage === input.stage &&
    run.role === (input.role ?? null) &&
    run.workPackageId === (input.workPackageId ?? null) &&
    run.candidateId === (input.candidateId ?? null);
}

function findRepairSource(task, input) {
  return [...(task.runs ?? [])].reverse().find((run) => {
    if (input.candidateId && run.candidateId !== input.candidateId) return false;
    return run.gateResult?.verdict === "REPAIR" || run.status === "failed" || run.status === "interrupted";
  })?.id ?? null;
}

function summarizeTest(evidence) {
  if (!evidence) return null;
  return {
    candidateId: evidence.candidateId,
    candidateRevision: evidence.candidateRevision,
    status: evidence.status,
    command: evidence.command,
    durationMs: evidence.durationMs ?? null,
    rowCount: evidence.rows?.length ?? 0,
    failedRowIds: (evidence.rows ?? []).filter((row) => row.status === "failed").map((row) => row.id),
  };
}

function mergeToolCalls(existing, runtimeEvents) {
  const calls = [...(existing ?? [])];
  for (const event of runtimeEvents ?? []) {
    if (!event.toolCall) continue;
    const next = structuredClone(event.toolCall);
    const index = next.id ? calls.findIndex((call) => call.id === next.id) : -1;
    if (index < 0) calls.push(next);
    else calls[index] = { ...calls[index], ...next, result: next.result ?? calls[index].result ?? null };
  }
  return calls;
}

function uniqueLegacyRunId(known, artifactId) {
  const base = `legacy:${artifactId ?? "artifact"}`;
  let candidate = base;
  let suffix = 2;
  while (known.has(candidate)) {
    candidate = `${base}:${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function finiteOrNull(value) {
  const number = Number(value);
  return value != null && Number.isFinite(number) ? number : null;
}

function validDuration(value) {
  return Number.isFinite(value) && value >= 0;
}

function durationBetween(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(duration) ? Math.max(0, duration) : null;
}
