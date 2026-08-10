export const TASK_STORE_SCHEMA_VERSION = 9;

/**
 * Execution provider identity for persisted runs and stage-run reservations.
 *
 * `provider` was introduced in schema 6. Workflow profiles were added in schema 7,
 * and schema 8 adds the snapshotted Grill interaction policy and provenance.
 * An absent provider means the default provider, and
 * that is enforced twice on purpose: the schema-6 migration backfills it onto
 * every persisted run and reservation, and every read goes through
 * {@link readExecutionProvider}. Without the read-time coalesce a record the
 * migration has not touched yet would compare `undefined` against `"codex"` and
 * strand an otherwise fresh gate.
 */
export const DEFAULT_EXECUTION_PROVIDER = "codex";

export const EXECUTION_PROVIDER_IDS = Object.freeze(["codex", "claude"]);

/** Read a record's execution provider, coalescing absent to the default. */
export function readExecutionProvider(record) {
  const provider = record?.provider;
  return provider == null ? DEFAULT_EXECUTION_PROVIDER : provider;
}

/**
 * The provider a stage's evidence must have been produced by, or `null` when the
 * stage has no reservation to bind against. Gate evidence from another provider
 * is never accepted as a fallback: cross-provider reuse is a mismatch, not a
 * degraded pass.
 */
export function expectedStageProvider(task, stage) {
  const reservation = task?.stageRunReservations?.[stage];
  return reservation ? readExecutionProvider(reservation) : null;
}

export const CANONICAL_RUN_STAGES = Object.freeze([
  "triage",
  "scouts",
  "grill",
  "specification",
  "plan",
  "implement",
  "dev-review",
  "test",
  "final-review",
]);

export const DEFAULT_STAGE_RUN_LIMIT = 3;
export const RUN_ACTIVITY_EVENT_LIMIT = 2_000;
export const HIGH_VOLUME_EVENT_CATEGORIES = Object.freeze(["activity", "agent", "tool", "artifact"]);

const HIGH_VOLUME_EVENT_CATEGORY_SET = new Set(HIGH_VOLUME_EVENT_CATEGORIES);

export const CANDIDATE_GATE_STAGES = Object.freeze(["dev-review", "test", "final-review"]);

export const RUNTIME_FRESHNESS_REASONS = Object.freeze({
  fresh: "The latest terminal run is authoritative for the active candidate.",
  missing_binding: "Candidate evidence is missing explicit candidateId and candidateRevision fields.",
  malformed_binding: "Candidate evidence has malformed explicit candidate identity fields.",
  mixed_evidence: "Candidate evidence contains more than one candidate identity.",
  candidate_mismatch: "Candidate evidence does not match the active candidate.",
  revision_change: "Candidate evidence belongs to a previous candidate revision.",
  provider_mismatch: "Candidate evidence was produced by a different execution provider than the stage reservation.",
  missing_authoritative_summary: "No authoritative persisted terminal run summary is available for this gate.",
  contradictory_evidence: "Candidate evidence contains contradictory result fields.",
  repair_required: "The terminal run requires candidate repair before this gate can be fresh.",
  command_failure: "A candidate-scope command failed, so the gate requires rerun.",
  review_tooling_failure: "A reviewer diagnostic command failed, so the same candidate requires one bounded review retry.",
  failed_execution: "The terminal run failed, so its evidence is not fresh.",
  timeout: "The terminal run timed out, so its evidence requires rerun.",
  run_in_progress: "The run is still in progress; authoritative evidence is not available yet.",
  superseded_attempt: "A later terminal attempt superseded this historical evidence.",
  malformed_attempt: "Candidate evidence has a malformed or missing terminal attempt number.",
  ambiguous_attempt: "Candidate evidence records more than one terminal run at the same attempt number.",
  ambiguous_candidate: "Persisted candidate revisions are out of order, so the active candidate is ambiguous.",
});

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted", "timed-out", "timed_out", "timeout"]);

export function migrateRunActivityState(state) {
  const incomingVersion = Number.isInteger(state.schemaVersion) ? state.schemaVersion : 1;
  if (incomingVersion > TASK_STORE_SCHEMA_VERSION) {
    throw new Error(
      `Task data schema ${incomingVersion} is newer than this runtime supports (${TASK_STORE_SCHEMA_VERSION}).`,
    );
  }

  let changed = state.schemaVersion !== TASK_STORE_SCHEMA_VERSION;
  for (const task of state.tasks ?? []) {
    changed = migrateStageRunLimits(task) || changed;
    if (!task.stageRunReservations || typeof task.stageRunReservations !== "object" || Array.isArray(task.stageRunReservations)) {
      task.stageRunReservations = {};
      changed = true;
    }
    const retainedEvents = retainRunActivityEvents(task.events);
    if (retainedEvents !== task.events) {
      task.events = retainedEvents;
      changed = true;
    }
    if (!Array.isArray(task.runs)) {
      task.runs = [];
      changed = true;
    }
    if (!Array.isArray(task.activeRunIds)) {
      task.activeRunIds = [];
      changed = true;
    }
    if (incomingVersion < 2) changed = migrateArtifactRuns(task) || changed;
    changed = backfillRunAttempts(task) || changed;
    changed = backfillExecutionProviders(task) || changed;
    const before = JSON.stringify({
      gateFreshness: task.gateFreshness,
      runs: task.runs.map((run) => run.freshness ?? null),
      artifacts: (task.artifacts ?? []).map((artifact) => artifact.freshness ?? null),
      events: (task.events ?? []).map((event) => ({
        runId: event.runId ?? null,
        freshness: event.freshness ?? null,
      })),
    });
    refreshGateFreshness(task);
    changed = reconcileAdvancedCandidateGateState(task) || changed;
    changed = before !== JSON.stringify({
      gateFreshness: task.gateFreshness,
      runs: task.runs.map((run) => run.freshness ?? null),
      artifacts: (task.artifacts ?? []).map((artifact) => artifact.freshness ?? null),
      events: (task.events ?? []).map((event) => ({
        runId: event.runId ?? null,
        freshness: event.freshness ?? null,
      })),
    }) || changed;
  }
  state.schemaVersion = TASK_STORE_SCHEMA_VERSION;
  return changed;
}

/**
 * Return the authoritative retry allowance for a canonical run stage.
 * `stageRunLimit` is retained only for legacy compatibility and migration.
 */
export function stageRunLimitFor(task, stage) {
  const limit = task?.stageRunLimits?.[stage];
  return isValidStageRunLimit(limit) ? limit : DEFAULT_STAGE_RUN_LIMIT;
}

/**
 * Keep every decision and non-telemetry event, while bounding the aggregate
 * high-volume event categories to the newest retained window.
 */
export function retainRunActivityEvents(events) {
  if (!Array.isArray(events)) return events;
  const highVolumeIndexes = [];
  for (const [index, event] of events.entries()) {
    if (HIGH_VOLUME_EVENT_CATEGORY_SET.has(event?.category)) highVolumeIndexes.push(index);
  }
  if (highVolumeIndexes.length <= RUN_ACTIVITY_EVENT_LIMIT) return events;

  const firstRetainedIndex = highVolumeIndexes[highVolumeIndexes.length - RUN_ACTIVITY_EVENT_LIMIT];
  return events.filter((event, index) => (
    !HIGH_VOLUME_EVENT_CATEGORY_SET.has(event?.category) || index >= firstRetainedIndex
  ));
}

function migrateStageRunLimits(task) {
  const legacyLimit = isValidStageRunLimit(task.stageRunLimit)
    ? task.stageRunLimit
    : DEFAULT_STAGE_RUN_LIMIT;
  const existing = task.stageRunLimits && typeof task.stageRunLimits === "object" && !Array.isArray(task.stageRunLimits)
    ? task.stageRunLimits
    : {};
  let changed = task.stageRunLimits !== existing;
  const migrated = { ...existing };
  for (const stage of CANONICAL_RUN_STAGES) {
    if (!isValidStageRunLimit(existing[stage])) {
      migrated[stage] = legacyLimit;
      changed = true;
    }
  }
  if (changed) task.stageRunLimits = migrated;
  return changed;
}

/**
 * Schema 6: stamp the default execution provider onto every persisted run and
 * stage-run reservation that predates provider identity. Unconditional and
 * idempotent, so it also repairs a record written by an older runtime after the
 * store was already migrated.
 */
function backfillExecutionProviders(task) {
  let changed = false;
  for (const run of task.runs ?? []) {
    if (run && run.provider == null) {
      run.provider = DEFAULT_EXECUTION_PROVIDER;
      changed = true;
    }
  }
  for (const reservation of Object.values(task.stageRunReservations ?? {})) {
    if (reservation && reservation.provider == null) {
      reservation.provider = DEFAULT_EXECUTION_PROVIDER;
      changed = true;
    }
  }
  return changed;
}

function isValidStageRunLimit(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Read only the schema-owned candidate identity fields. A candidate record's
 * `id` and `revisionNumber` are intentionally not accepted here.
 */
export function readExplicitCandidateBinding(value) {
  const object = value && typeof value === "object" ? value : {};
  const hasCandidateId = Object.prototype.hasOwnProperty.call(object, "candidateId");
  const hasCandidateRevision = Object.prototype.hasOwnProperty.call(object, "candidateRevision");
  if (!hasCandidateId && !hasCandidateRevision) return invalidBinding("missing_binding");
  if (!hasCandidateId || !hasCandidateRevision) return invalidBinding("malformed_binding");
  if (object.candidateId == null && object.candidateRevision == null) return invalidBinding("missing_binding");
  if (typeof object.candidateId !== "string" || !object.candidateId.trim()) return invalidBinding("malformed_binding");
  if (!Number.isInteger(object.candidateRevision) || object.candidateRevision < 1) return invalidBinding("malformed_binding");
  return {
    valid: true,
    candidateId: object.candidateId.trim(),
    candidateRevision: object.candidateRevision,
    code: "fresh",
    copy: RUNTIME_FRESHNESS_REASONS.fresh,
  };
}

export function beginAgentRun(task, input) {
  task.runs ??= [];
  task.activeRunIds ??= [];
  const startedAt = input.startedAt ?? new Date().toISOString();
  const relatedRuns = task.runs.filter((run) => sameRunScope(run, input));
  const retryOfRunId = findRetrySource(task, input);
  const repairOfRunId = input.kind === "repair" ? findRepairSource(task, input) : null;
  const run = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    provider: readExecutionProvider(input),
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
    candidateHeadRevision: input.candidateHeadRevision ?? null,
    workPackageId: input.workPackageId ?? null,
    workflowAttempt: input.workflowAttempt ?? null,
    workflowReservationId: input.workflowReservationId ?? null,
    attempt: relatedRuns.length + 1,
    retryOfRunId,
    repairOfRunId,
    toolCalls: [],
    test: null,
    gateResult: null,
    evidenceError: null,
    freshness: null,
    error: null,
    source: "codex-jsonl",
  };
  task.runs.push(run);
  task.activeRunIds.push(run.id);
  refreshGateFreshness(task);
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
  refreshGateFreshness(task);
  return run;
}

export function attachRunArtifact(task, runId, artifact) {
  if (!runId) return null;
  const run = task.runs?.find((item) => item.id === runId);
  if (!run) return null;
  run.artifactId = artifact.id ?? null;
  run.test = summarizeTest(artifact.focusedTest);
  run.gateResult = artifact.gateResult ? structuredClone(artifact.gateResult) : null;
  run.evidenceError = artifact.evidenceError != null
    ? structuredClone(artifact.evidenceError)
    : attachmentEvidenceError(run, artifact);
  // Attachment is only persistence. Freshness is recomputed from the complete
  // terminal run summary and never inferred from the artifact itself.
  refreshGateFreshness(task);
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
  if (changed) refreshGateFreshness(task);
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
    freshness: run.freshness ? structuredClone(run.freshness) : null,
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

export function resolveGateFreshness(task, stage) {
  if (!CANDIDATE_GATE_STAGES.includes(stage)) return null;
  const targetResult = activeCandidateBinding(task);
  const target = targetResult.valid ? targetResult : null;
  if (!target) {
    return createFreshness(stage, null, null, null, targetResult.code, null);
  }
  const stageRuns = terminalStageRuns(task, stage);
  const expectedProvider = expectedStageProvider(task, stage);
  const selection = selectAuthoritativeRun(candidateRelevantRuns(task, stageRuns, target, stage));
  if (selection.reasonCode) {
    return createFreshness(stage, target, null, null, selection.reasonCode, null);
  }
  const selected = selection.run;
  if (!selected) {
    const diagnostic = selectAuthoritativeRun(stageRuns);
    if (diagnostic.reasonCode) {
      return createFreshness(stage, target, null, null, diagnostic.reasonCode, null);
    }
    if (!diagnostic.run) {
      return createFreshness(stage, target, null, null, "missing_authoritative_summary", null);
    }
    return evaluateRunFreshness(
      diagnostic.run,
      findRunArtifact(task, diagnostic.run),
      target,
      stage,
      expectedProvider,
    );
  }
  const artifact = findRunArtifact(task, selected);
  return evaluateRunFreshness(selected, artifact, target, stage, expectedProvider);
}

export function resolvePersistedRunFreshness(run, artifact, target, stage, expectedProvider = null) {
  if (!CANDIDATE_GATE_STAGES.includes(stage)) return null;
  return evaluateRunFreshness(run, artifact, target, stage, expectedProvider);
}

/** Recompute the authoritative task projection and every gate run's audit state. */
export function refreshGateFreshness(task) {
  const projection = {};
  for (const stage of CANDIDATE_GATE_STAGES) {
    const targetResult = activeCandidateBinding(task);
    const target = targetResult.valid ? targetResult : null;
    const selected = target
      ? selectAuthoritativeRun(candidateRelevantRuns(task, terminalStageRuns(task, stage), target, stage)).run
      : null;
    const expectedProvider = expectedStageProvider(task, stage);
    projection[stage] = resolveGateFreshness(task, stage);
    for (const run of task.runs ?? []) {
      if (run.stage !== stage) continue;
      const artifact = findRunArtifact(task, run);
      const runFreshness = evaluateRunFreshness(run, artifact, target, stage, expectedProvider);
      run.freshness = runFreshness;
      if (selected?.id === run.id && runFreshness.fresh) continue;
      if (selected?.id !== run.id && runFreshness.fresh) {
        run.freshness = createFreshness(stage, target, run.id, run.artifactId ?? null, "superseded_attempt", null);
      }
    }
  }
  task.gateFreshness = projection;
  const runsById = new Map((task.runs ?? []).map((run) => [run.id, run]));
  const runsByArtifactId = new Map(
    (task.runs ?? [])
      .filter((run) => run.artifactId)
      .map((run) => [run.artifactId, run]),
  );
  const artifactsById = new Map((task.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
  const artifactTargetResult = activeCandidateBinding(task);
  const artifactTarget = artifactTargetResult.valid ? artifactTargetResult : null;
  for (const artifact of task.artifacts ?? []) {
    if (!CANDIDATE_GATE_STAGES.includes(artifact.stage)) continue;
    const run = (artifact.runId ? runsById.get(artifact.runId) : null) ?? runsByArtifactId.get(artifact.id);
    artifact.freshness = run?.freshness
      ? structuredClone(run.freshness)
      : createFreshness(
          artifact.stage,
          artifactTarget,
          null,
          artifact.id ?? null,
          "missing_authoritative_summary",
          null,
        );
  }
  for (const event of task.events ?? []) {
    const directRun = event.runId ? runsById.get(event.runId) : null;
    const linkedArtifact = event.artifactId ? artifactsById.get(event.artifactId) : null;
    const artifactRun = linkedArtifact
      ? (linkedArtifact.runId ? runsById.get(linkedArtifact.runId) : null)
        ?? runsByArtifactId.get(linkedArtifact.id)
      : null;
    const run = directRun ?? artifactRun;
    if (run?.freshness && CANDIDATE_GATE_STAGES.includes(run.stage) && run.stage === event.stage) {
      event.freshness = structuredClone(run.freshness);
      continue;
    }
    if (!isLegacyCandidateGateEvent(event)) continue;
    event.freshness = createFreshness(
      event.stage,
      artifactTarget,
      null,
      null,
      "missing_binding",
      null,
    );
  }
  return projection;
}

function isLegacyCandidateGateEvent(event) {
  if (!event || event.category !== "decision" || !CANDIDATE_GATE_STAGES.includes(event.stage)) return false;
  const title = String(event.title ?? "").trim().toLowerCase();
  if (title === "candidate requires repair") return true;
  return {
    "dev-review": "development review passed",
    test: "focused test passed",
    "final-review": "final review passed",
  }[event.stage] === title;
}

function evaluateRunFreshness(run, artifact, target, stage, expectedProvider = null) {
  const sourceRunId = run?.id ?? null;
  const sourceArtifactId = run?.artifactId ?? artifact?.id ?? null;
  if (!target) {
    return createFreshness(stage, null, sourceRunId, sourceArtifactId, "missing_binding", null);
  }
  if (!run || typeof run !== "object") {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "missing_authoritative_summary", null);
  }

  const identityResolution = persistedEvidenceIdentityResolution(run, artifact, stage);
  if (identityResolution.reasonCode) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, identityResolution.reasonCode, null);
  }
  const identityReason = compareCandidateBinding(identityResolution.binding, target);
  if (identityReason) return createFreshness(stage, target, sourceRunId, sourceArtifactId, identityReason, null);
  // Provider identity binds exactly like candidate identity: evidence produced by
  // a provider other than the one the stage reserved is stale, never a fallback.
  if (expectedProvider != null && readExecutionProvider(run) !== expectedProvider) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "provider_mismatch", null);
  }
  if (artifact && artifact.stage !== stage) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }

  // Focused Test is different from model-authored review: the harness executed and
  // validated the manifest before the interpretation agent ran. An exact failed Test
  // result is therefore authoritative candidate-repair evidence even when that later
  // read-only interpreter also emitted failed command telemetry. Preserve the telemetry,
  // but do not let it downgrade a concrete failed Test into a same-revision rerun loop.
  let testEvaluation = null;
  if (stage === "test" && run.status === "completed") {
    testEvaluation = evaluateTestRun(run, artifact, target, sourceRunId, sourceArtifactId);
    if (testEvaluation.reasonCode === "repair_required" && testEvaluation.focusedTest?.status === "failed") {
      return testEvaluation;
    }
  }

  const evidenceErrorReason = persistedEvidenceErrorReason(run.evidenceError);
  if (evidenceErrorReason) {
    return createFreshness(
      stage,
      target,
      sourceRunId,
      sourceArtifactId,
      evidenceErrorReason,
      testEvaluation?.focusedTest ?? null,
    );
  }
  if (run.status === "running") return createFreshness(stage, target, sourceRunId, sourceArtifactId, "run_in_progress", null);
  if (isTimeoutRun(run)) return createFreshness(stage, target, sourceRunId, sourceArtifactId, "timeout", null);
  if (run.status !== "completed") return createFreshness(stage, target, sourceRunId, sourceArtifactId, "failed_execution", null);
  if (persistedCandidateVerificationCommandFailed(run.toolCalls)) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "command_failure", null);
  }

  if (stage === "test") return testEvaluation ?? evaluateTestRun(run, artifact, target, sourceRunId, sourceArtifactId);
  return evaluateGateRun(run, target, stage, sourceRunId, sourceArtifactId);
}

function evaluateGateRun(run, target, stage, sourceRunId, sourceArtifactId) {
  const summary = run.gateResult;
  if (!summary || typeof summary !== "object") {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "missing_authoritative_summary", null);
  }
  const summaryBinding = readExplicitCandidateBinding(summary);
  if (!summaryBinding.valid) return createFreshness(stage, target, sourceRunId, sourceArtifactId, summaryBinding.code, null);
  const identityReason = compareCandidateBinding(summaryBinding, target);
  if (identityReason) return createFreshness(stage, target, sourceRunId, sourceArtifactId, identityReason, null);
  if (
    !["PASS", "REPAIR"].includes(summary.verdict) ||
    !["PASS", "REPAIR"].includes(summary.reportedVerdict) ||
    !Array.isArray(summary.blockingReasons) ||
    !Array.isArray(summary.findings)
  ) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }
  const findingBindings = summary.findings.map((finding) => ({
    binding: readExplicitCandidateBinding(finding),
    explicit: finding?.bindingExplicit !== false && hasExplicitCandidateFields(finding),
  }));
  const findingIdentities = new Set([
    `${summaryBinding.candidateId}:${summaryBinding.candidateRevision}`,
    ...findingBindings
      .filter(({ binding }) => binding.valid)
      .map(({ binding }) => `${binding.candidateId}:${binding.candidateRevision}`),
  ]);
  if (findingIdentities.size > 1) return createFreshness(stage, target, sourceRunId, sourceArtifactId, "mixed_evidence", null);
  if (findingBindings.some(({ explicit }) => !explicit)) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "missing_binding", null);
  }
  const invalidFinding = findingBindings.find(({ binding }) => !binding.valid);
  if (invalidFinding) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, invalidFinding.binding.code, null);
  }
  if (findingBindings.some(({ binding }) => compareCandidateBinding(binding, target))) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "candidate_mismatch", null);
  }
  if (summary.findings.some((finding) => !isValidPersistedGateFinding(finding))) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }
  if (!isValidPersistedGateSummaryEnvelope(summary, stage)) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }
  if (summary.reportedVerdict !== summary.verdict) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }
  const hasBlockingReasons = summary.blockingReasons.length > 0;
  const blockingFindings = summary.findings.some((finding) => finding?.blocking === true);
  if (summary.verdict === "PASS" && (hasBlockingReasons || blockingFindings)) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }
  if (summary.verdict !== "PASS" || hasBlockingReasons || blockingFindings) {
    return createFreshness(stage, target, sourceRunId, sourceArtifactId, "repair_required", null);
  }
  return createFreshness(stage, target, sourceRunId, sourceArtifactId, "fresh", null);
}

function evaluateTestRun(run, artifact, target, sourceRunId, sourceArtifactId) {
  const summary = run.test;
  if (!summary || typeof summary !== "object") {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "missing_authoritative_summary", null);
  }
  const summaryBindingMarkerReason = persistedBindingMarkerReason(summary);
  if (summaryBindingMarkerReason) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, summaryBindingMarkerReason, null);
  }
  const summaryBinding = readExplicitCandidateBinding(summary);
  if (!summaryBinding.valid) return createFreshness("test", target, sourceRunId, sourceArtifactId, summaryBinding.code, null);
  const identityReason = compareCandidateBinding(summaryBinding, target);
  if (identityReason) return createFreshness("test", target, sourceRunId, sourceArtifactId, identityReason, null);
  if (!Array.isArray(summary.rows) || !summary.rows.length || summary.rowCount !== summary.rows.length) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "missing_authoritative_summary", null);
  }
  const identities = new Set([
    `${summaryBinding.candidateId}:${summaryBinding.candidateRevision}`,
  ]);
  const rowBindings = [];
  for (const row of summary.rows) {
    const rowBindingMarkerReason = persistedBindingMarkerReason(row);
    if (rowBindingMarkerReason) {
      return createFreshness("test", target, sourceRunId, sourceArtifactId, rowBindingMarkerReason, null);
    }
    const rowBinding = readExplicitCandidateBinding(row);
    if (!rowBinding.valid) return createFreshness("test", target, sourceRunId, sourceArtifactId, rowBinding.code, null);
    identities.add(`${rowBinding.candidateId}:${rowBinding.candidateRevision}`);
    rowBindings.push(rowBinding);
    if (!["passed", "failed"].includes(row.status)) {
      return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
    }
    if (!isValidPersistedTestRow(row)) {
      return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
    }
  }
  if (identities.size > 1) return createFreshness("test", target, sourceRunId, sourceArtifactId, "mixed_evidence", null);
  const rowReason = compareCandidateBinding(rowBindings[0], target);
  if (rowReason) return createFreshness("test", target, sourceRunId, sourceArtifactId, rowReason, null);
  const focusedTest = focusedTestFromRunSummary(summary, artifact?.focusedTest ?? null);
  if (
    typeof summary.command !== "string" ||
    !summary.command.trim() ||
    !["passed", "failed"].includes(summary.status) ||
    (summary.startedAt != null && !isCanonicalIsoTimestamp(summary.startedAt)) ||
    (summary.completedAt != null && !isCanonicalIsoTimestamp(summary.completedAt)) ||
    (summary.durationMs != null && (!Number.isFinite(summary.durationMs) || summary.durationMs < 0))
  ) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", focusedTest);
  }
  const failedRows = summary.rows.filter((row) => row.status === "failed");
  const recordedFailedRows = summary.failedRowIds;
  if (!hasExactFailedRowIds(recordedFailedRows, failedRows, summary.rows)) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", focusedTest);
  }
  const derivedStatus = failedRows.length > 0 ? "failed" : "passed";
  if (summary.status !== derivedStatus) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", focusedTest);
  }
  const testFailed = summary.status === "failed";
  const gateFailure = evaluateTestGateResult(run.gateResult, target, sourceRunId, sourceArtifactId);
  if (testFailed) {
    if (gateFailure?.reasonCode === "repair_required") {
      return createFreshness("test", target, sourceRunId, sourceArtifactId, "repair_required", focusedTest);
    }
    return gateFailure ?? createFreshness(
      "test",
      target,
      sourceRunId,
      sourceArtifactId,
      "contradictory_evidence",
      focusedTest,
    );
  }
  if (gateFailure) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, gateFailure.reasonCode, focusedTest);
  }
  return createFreshness("test", target, sourceRunId, sourceArtifactId, "fresh", focusedTest);
}

function evaluateTestGateResult(summary, target, sourceRunId, sourceArtifactId) {
  if (!summary || typeof summary !== "object") {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "missing_authoritative_summary", null);
  }
  const summaryBinding = readExplicitCandidateBinding(summary);
  if (!summaryBinding.valid) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, summaryBinding.code, null);
  }
  const identityReason = compareCandidateBinding(summaryBinding, target);
  if (identityReason) return createFreshness("test", target, sourceRunId, sourceArtifactId, identityReason, null);
  if (!["PASS", "REPAIR"].includes(summary.verdict)) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }
  if (!Array.isArray(summary.blockingReasons) || !Array.isArray(summary.findings)) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }

  const findingBindings = summary.findings.map((finding) => ({
    binding: readExplicitCandidateBinding(finding),
    explicit: finding?.bindingExplicit !== false && hasExplicitCandidateFields(finding),
  }));
  const identities = new Set([
    `${summaryBinding.candidateId}:${summaryBinding.candidateRevision}`,
    ...findingBindings
      .filter(({ binding }) => binding.valid)
      .map(({ binding }) => `${binding.candidateId}:${binding.candidateRevision}`),
  ]);
  if (identities.size > 1) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "mixed_evidence", null);
  }
  if (findingBindings.some(({ explicit }) => !explicit)) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "missing_binding", null);
  }
  const invalidFinding = findingBindings.find(({ binding }) => !binding.valid);
  if (invalidFinding) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, invalidFinding.binding.code, null);
  }
  if (summary.findings.some((finding) => !isValidPersistedGateFinding(finding))) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }
  if (!isValidPersistedGateSummaryEnvelope(summary, "test")) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }

  const blockingFindings = summary.findings.some((finding) => finding?.blocking === true);
  const hasBlockingReasons = summary.blockingReasons.length > 0;
  const verdictsDisagree = summary.reportedVerdict != null && summary.reportedVerdict !== summary.verdict;
  if (verdictsDisagree || (summary.reportedVerdict === "PASS" && (hasBlockingReasons || blockingFindings))) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "contradictory_evidence", null);
  }
  if (summary.verdict !== "PASS" || hasBlockingReasons || blockingFindings) {
    return createFreshness("test", target, sourceRunId, sourceArtifactId, "repair_required", null);
  }
  return null;
}

function focusedTestFromRunSummary(summary, artifactEvidence) {
  const rows = structuredClone(summary.rows);
  return {
    candidateId: summary.candidateId,
    candidateRevision: summary.candidateRevision,
    bindingExplicit: true,
    command: typeof summary.command === "string" ? summary.command : "",
    status: ["passed", "failed"].includes(summary.status)
      ? summary.status
      : (rows.every((row) => row.status === "passed") ? "passed" : "failed"),
    startedAt: canonicalTimestampOrNull(summary.startedAt, artifactEvidence?.startedAt),
    completedAt: canonicalTimestampOrNull(summary.completedAt, artifactEvidence?.completedAt),
    durationMs: validDuration(summary.durationMs) ? summary.durationMs : null,
    rows,
  };
}

function canonicalTimestampOrNull(value, fallback) {
  if (isCanonicalIsoTimestamp(value)) return value;
  return isCanonicalIsoTimestamp(fallback) ? fallback : null;
}

function createFreshness(stage, target, sourceRunId, sourceArtifactId, code, focusedTest) {
  const reasonCode = RUNTIME_FRESHNESS_REASONS[code] ? code : "malformed_binding";
  const fresh = reasonCode === "fresh";
  const reasonCopy = RUNTIME_FRESHNESS_REASONS[reasonCode];
  const reason = { code: reasonCode, copy: reasonCopy };
  return {
    stage,
    candidateId: target?.candidateId ?? null,
    candidateRevision: target?.candidateRevision ?? null,
    target: target ? { candidateId: target.candidateId, candidateRevision: target.candidateRevision } : null,
    state: fresh ? "fresh" : "stale",
    fresh,
    sourceRunId,
    sourceArtifactId,
    reasonCode,
    reasonCopy,
    reason,
    staleReasonCode: fresh ? null : reasonCode,
    staleReasonCopy: fresh ? null : reasonCopy,
    staleReason: fresh ? null : reason,
    focusedTest: focusedTest ? structuredClone(focusedTest) : null,
    focusedTestRows: focusedTest ? structuredClone(focusedTest.rows) : [],
  };
}

function activeCandidateBinding(task) {
  const candidates = Array.isArray(task.candidates) ? task.candidates : [];
  const candidate = candidates.at(-1);
  if (!candidate) return readExplicitCandidateBinding(null);
  const revision = candidate.revisionNumber;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return invalidBinding("malformed_binding");
  if (!Number.isInteger(revision) || revision < 1) return invalidBinding("malformed_binding");
  // The trailing entry is authoritative only when no earlier entry for the same
  // candidate records a higher validated revision. Out-of-order persistence fails
  // closed instead of binding every gate to a superseded revision.
  const superseding = candidates.some((entry) =>
    entry !== candidate &&
    entry?.id === candidate.id &&
    Number.isInteger(entry.revisionNumber) &&
    entry.revisionNumber > revision);
  if (superseding) return invalidBinding("ambiguous_candidate");
  return readExplicitCandidateBinding({
    candidateId: candidate.id,
    candidateRevision: revision,
  });
}

function terminalStageRuns(task, stage) {
  return (task.runs ?? [])
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run?.stage === stage && isTerminalRun(run));
}

/**
 * Resolve every persisted candidate identity a run carries before deciding whether
 * the run is relevant to the target. A run whose run-level binding names another
 * candidate but whose summaries bind the target is unresolvable, not unrelated, so
 * it must remain in precedence and fail closed rather than yield to an older PASS.
 */
function candidateRelevantRuns(task, entries, target, stage) {
  return entries.filter(({ run }) => {
    // A run's own `candidateId`/`candidateRevision` are set once, from the workflow
    // reservation, at the moment the run started — reliable, when well-formed,
    // regardless of whether its *embedded* gate evidence later turns out ambiguous or
    // malformed. Checking this first (but only when it validates cleanly — a malformed
    // top-level field must still fall through to the embedded-evidence path below, so
    // a genuinely malformed run keeps surfacing as authoritative-but-`malformed_binding`
    // rather than being silently dropped) means a run genuinely superseded by a later
    // candidate revision (e.g. the dev-review run from before a repair bumped the
    // revision) is excluded outright, rather than getting fail-open "kept in" treatment
    // merely because that same superseded evidence also trips the marker check.
    // Recorded live: a repair whose newest failing gate was only a non-blocking,
    // implicitly-bound finding left its pre-repair dev-review run permanently
    // "relevant" by that fail-open path, colliding on attempt number with the
    // post-repair run and misclassifying every subsequent review as `ambiguous_attempt`.
    const runBinding = readExplicitCandidateBinding(run);
    if (runBinding.valid) {
      return compareCandidateBinding(runBinding, target) == null;
    }
    const resolution = persistedEvidenceIdentityResolution(run, findRunArtifact(task, run), stage);
    if (resolution.reasonCode || !resolution.binding) return true;
    return compareCandidateBinding(resolution.binding, target) == null;
  });
}

function validatedAttempt(run) {
  const attempt = run?.attempt;
  return Number.isInteger(attempt) && attempt >= 1 ? attempt : null;
}

/**
 * Select the authoritative terminal run by validated attempt number. Persisted array
 * order is never consulted, so a lower-attempt PASS stored after a higher-attempt
 * REPAIR cannot win. Missing, malformed, or tied attempt evidence fails closed.
 */
function selectAuthoritativeRun(entries) {
  if (!entries.length) return { run: null, reasonCode: null };
  const ordered = [...entries].sort((left, right) => left.index - right.index);
  let previousAttempt = 0;
  for (const entry of ordered) {
    const attempt = validatedAttempt(entry.run);
    if (attempt == null) return { run: null, reasonCode: "malformed_attempt" };
    // Attempts are assigned monotonically as runs are appended, so validated attempt
    // order and persisted order must agree. A repeated or decreasing attempt means the
    // two disagree and no run can be proven authoritative, so the gate fails closed
    // instead of letting either signal silently win.
    if (attempt <= previousAttempt) return { run: null, reasonCode: "ambiguous_attempt" };
    previousAttempt = attempt;
  }
  return { run: ordered.at(-1).run, reasonCode: null };
}

function isTerminalRun(run) {
  return run && run.status !== "running" && (TERMINAL_STATUSES.has(run.status) || run.completedAt != null || run.status == null);
}

function findRunArtifact(task, run) {
  if (!run?.artifactId) return null;
  return (task.artifacts ?? []).find((artifact) => artifact.id === run.artifactId) ?? null;
}

function attachmentEvidenceError(run, artifact) {
  if (!CANDIDATE_GATE_STAGES.includes(run.stage)) return null;
  const identityResolution = persistedEvidenceIdentityResolution(run, artifact, run.stage);
  return identityResolution.reasonCode ? reasonRecord(identityResolution.reasonCode) : null;
}

function persistedEvidenceIdentityResolution(run, artifact, stage) {
  const evidence = [];
  const addEvidence = (value, validateMarker = false) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      evidence.push({ value, validateMarker });
    }
  };
  const addGateSummary = (summary) => {
    addEvidence(summary);
    if (Array.isArray(summary?.findings)) {
      for (const finding of summary.findings) addEvidence(finding, true);
    }
  };
  const addTestSummary = (summary) => {
    addEvidence(summary, true);
    if (Array.isArray(summary?.rows)) {
      for (const row of summary.rows) addEvidence(row, true);
    }
  };

  addEvidence(run);
  addEvidence(artifact);
  addGateSummary(run?.gateResult);
  addGateSummary(artifact?.gateResult);
  if (stage === "test") {
    addTestSummary(run?.test);
    addTestSummary(artifact?.focusedTest);
  }

  const identities = new Map();
  let invalidReason = null;
  for (const { value, validateMarker } of evidence) {
    const markerReason = validateMarker ? persistedBindingMarkerReason(value) : null;
    if (markerReason) invalidReason ??= markerReason;
    const binding = readExplicitCandidateBinding(value);
    if (!binding.valid) {
      invalidReason ??= binding.code;
      continue;
    }
    identities.set(`${binding.candidateId}:${binding.candidateRevision}`, binding);
  }

  if (identities.size > 1) return { binding: null, reasonCode: "mixed_evidence" };
  if (invalidReason) return { binding: null, reasonCode: invalidReason };
  return { binding: identities.values().next().value ?? null, reasonCode: null };
}

function reasonRecord(code) {
  return { code, copy: RUNTIME_FRESHNESS_REASONS[code] ?? RUNTIME_FRESHNESS_REASONS.malformed_binding };
}

function persistedEvidenceErrorReason(evidenceError) {
  if (evidenceError == null) return null;
  if (!evidenceError || typeof evidenceError !== "object" || Array.isArray(evidenceError)) {
    return "malformed_binding";
  }
  const { code, copy } = evidenceError;
  if (
    typeof code !== "string" ||
    code === "fresh" ||
    !RUNTIME_FRESHNESS_REASONS[code] ||
    typeof copy !== "string" ||
    copy !== RUNTIME_FRESHNESS_REASONS[code]
  ) {
    return "malformed_binding";
  }
  return code;
}

function compareCandidateBinding(binding, target) {
  if (binding.candidateId !== target.candidateId) return "candidate_mismatch";
  if (binding.candidateRevision !== target.candidateRevision) return "revision_change";
  return null;
}

function invalidBinding(code) {
  return { valid: false, candidateId: null, candidateRevision: null, code, copy: RUNTIME_FRESHNESS_REASONS[code] };
}

function hasExplicitCandidateFields(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, "candidateId") &&
      Object.prototype.hasOwnProperty.call(value, "candidateRevision"),
  );
}

function persistedBindingMarkerReason(value) {
  if (!value || typeof value !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(value, "bindingExplicit")) return null;
  if (value.bindingExplicit === false) return "missing_binding";
  if (value.bindingExplicit !== true) return "contradictory_evidence";
  return null;
}

function isValidPersistedGateFinding(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) return false;
  if (finding.kind != null && !["candidate-defect", "verification-gap"].includes(finding.kind)) return false;
  if (!["P0", "P1", "P2", "P3"].includes(finding.severity)) return false;
  if (typeof finding.title !== "string" || !finding.title.trim()) return false;
  if (typeof finding.detail !== "string" || !finding.detail.trim()) return false;
  if (finding.file != null && typeof finding.file !== "string") return false;
  if (finding.line != null && (!Number.isInteger(finding.line) || finding.line < 1)) return false;
  if (finding.bindingExplicit != null && typeof finding.bindingExplicit !== "boolean") return false;
  return true;
}

export function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isValidPersistedGateSummaryEnvelope(summary, stage) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
  if (summary.schemaVersion !== 1 || summary.stage !== stage) return false;
  return isCanonicalIsoTimestamp(summary.evaluatedAt);
}

function isValidPersistedTestRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  if (typeof row.id !== "string" || !row.id.trim()) return false;
  if (typeof row.command !== "string" || !row.command.trim()) return false;
  if (!["passed", "failed"].includes(row.status)) return false;
  if (row.durationMs != null && (!Number.isFinite(row.durationMs) || row.durationMs < 0)) return false;
  if (typeof row.title !== "string" || !row.title.trim()) return false;
  if (!Array.isArray(row.artifactReferences) || !row.artifactReferences.every((reference) => (
    reference &&
    typeof reference === "object" &&
    !Array.isArray(reference) &&
    typeof reference.name === "string" &&
    typeof reference.kind === "string" &&
    (reference.path == null || typeof reference.path === "string")
  ))) return false;
  if (!Array.isArray(row.assertions) || !row.assertions.every((assertion) => (
    assertion &&
    typeof assertion === "object" &&
    !Array.isArray(assertion) &&
    typeof assertion.label === "string" &&
    typeof assertion.actual === "string" &&
    (assertion.expected == null || typeof assertion.expected === "string")
  ))) return false;
  if (row.failureDetails != null && typeof row.failureDetails !== "string") return false;
  if (
    Object.prototype.hasOwnProperty.call(row, "bindingExplicit") &&
    typeof row.bindingExplicit !== "boolean"
  ) return false;
  return true;
}

function hasExactFailedRowIds(recordedFailedRowIds, failedRows, rows) {
  if (!Array.isArray(recordedFailedRowIds)) return false;
  if (!recordedFailedRowIds.every((id) => typeof id === "string" && id.trim())) return false;

  const rowIds = rows.map((row) => row.id);
  const recordedIds = new Set(recordedFailedRowIds);
  const expectedIds = new Set(failedRows.map((row) => row.id));
  if (new Set(rowIds).size !== rowIds.length || recordedIds.size !== recordedFailedRowIds.length) return false;
  if (recordedIds.size !== expectedIds.size) return false;
  return [...expectedIds].every((id) => recordedIds.has(id));
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
      evidenceError: artifact.evidenceError != null ? structuredClone(artifact.evidenceError) : null,
      freshness: null,
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

/**
 * Terminal-run selection requires a validated attempt number on every gate run.
 * Historical and migrated runs were persisted without one; position within the run
 * scope is the only evidence available for them, so it is recorded once here as an
 * explicit typed field rather than being re-derived at selection time.
 */
function backfillRunAttempts(task) {
  let changed = false;
  const counters = new Map();
  for (const run of task.runs ?? []) {
    if (!run || typeof run !== "object") continue;
    const scope = JSON.stringify([
      run.stage ?? null,
      run.role ?? null,
      run.workPackageId ?? null,
      run.candidateId ?? null,
      run.candidateRevision ?? null,
    ]);
    const next = (counters.get(scope) ?? 0) + 1;
    counters.set(scope, next);
    if (validatedAttempt(run) == null) {
      run.attempt = next;
      changed = true;
    }
  }
  return changed;
}

function sameRunScope(run, input) {
  return run.stage === input.stage &&
    run.role === (input.role ?? null) &&
    run.workPackageId === (input.workPackageId ?? null) &&
    run.candidateId === (input.candidateId ?? null) &&
    run.candidateRevision === (input.candidateRevision ?? null);
}

function findRepairSource(task, input) {
  return [...(task.runs ?? [])].reverse().find((run) => {
    if (input.candidateId && run.candidateId !== input.candidateId) return false;
    return run.gateResult?.verdict === "REPAIR" || run.status === "failed" || run.status === "interrupted";
  })?.id ?? null;
}

function findRetrySource(task, input) {
  return [...(task.runs ?? [])].reverse().find((run) =>
    run.stage === input.stage &&
    run.role === (input.role ?? null) &&
    run.workPackageId === (input.workPackageId ?? null) &&
    run.candidateId === (input.candidateId ?? null),
  )?.id ?? null;
}

function summarizeTest(evidence) {
  if (!evidence || typeof evidence !== "object") return null;
  const rows = Array.isArray(evidence.rows) ? structuredClone(evidence.rows) : [];
  return {
    candidateId: evidence.candidateId ?? null,
    candidateRevision: evidence.candidateRevision ?? null,
    command: evidence.command ?? "",
    status: evidence.status ?? null,
    startedAt: evidence.startedAt ?? null,
    completedAt: evidence.completedAt ?? null,
    durationMs: evidence.durationMs ?? null,
    rowCount: evidence.rowCount ?? rows.length,
    failedRowIds: Array.isArray(evidence.failedRowIds)
      ? [...evidence.failedRowIds]
      : rows.filter((row) => row.status === "failed").map((row) => row.id),
    rows,
  };
}

function mergeToolCalls(existing, runtimeEvents) {
  const calls = [...(existing ?? [])];
  for (const event of runtimeEvents ?? []) {
    if (!event.toolCall) continue;
    const next = structuredClone(event.toolCall);
    if (event.commandFailed != null) next.commandFailed = event.commandFailed === true;
    if (event.runtimeScope != null) next.runtimeScope = event.runtimeScope;
    const index = next.id ? calls.findIndex((call) => call.id === next.id) : -1;
    if (index < 0) calls.push(next);
    else calls[index] = { ...calls[index], ...next, result: next.result ?? calls[index].result ?? null };
  }
  return calls;
}

function persistedCandidateVerificationCommandFailed(toolCalls = []) {
  return toolCalls.some((call) => {
    if (call?.phase !== "completed" || call?.category !== "repository-command") return false;
    if (call.runtimeScope === "context-preflight") return false;
    if (call.commandFailed === true) return true;
    const exitCode = /^Exit code\s+(-?\d+)\b/.exec(String(call.result ?? ""));
    return exitCode ? Number(exitCode[1]) !== 0 : /^(Shell could not start|Command timed out)\b/i.test(String(call.result ?? ""));
  });
}

function reconcileAdvancedCandidateGateState(task) {
  if (task.activeRunKind || task.activeRunReservationId || (task.activeRunIds?.length ?? 0) > 0) return false;
  const candidate = task.candidates?.at(-1);
  if (!candidate) return false;
  const testFreshness = task.gateFreshness?.test ?? null;
  const recoverablePassedTestRerun =
    task.status === "repair-required" &&
    task.currentStage === "test" &&
    candidate.status === "repair_required" &&
    testFreshness?.fresh === false &&
    testFreshness?.reasonCode !== "repair_required" &&
    testFreshness?.focusedTest?.status === "passed";
  if (recoverablePassedTestRerun) {
    task.status = "ready-for-test";
    candidate.status = "ready_for_test";
    task.error = testFreshness.reasonCopy;
    task.events ??= [];
    const sourceRunId = testFreshness.sourceRunId ?? null;
    if (!task.events.some((event) => event.title === "Persisted Test rerun state recovered" && event.runId === sourceRunId)) {
      task.events.push({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        category: "decision",
        tone: "warning",
        stage: "test",
        title: "Persisted Test rerun state recovered",
        detail: `The exact full manifest passed. ${testFreshness.reasonCopy}`,
        runId: sourceRunId,
        artifactId: testFreshness.sourceArtifactId ?? null,
        freshness: structuredClone(testFreshness),
      });
    }
    return true;
  }
  const requiredCompletedGates = {
    "ready-for-test": ["dev-review"],
    "ready-for-final-review": ["dev-review", "test"],
    "awaiting-human-approval": ["dev-review", "test", "final-review"],
  }[task.status];
  if (!requiredCompletedGates) return false;
  let stage = requiredCompletedGates.find((gate) => task.gateFreshness?.[gate]?.fresh !== true);
  // A failed Test used to be projected back to ready-for-test whenever the interpretation
  // agent also had command failure telemetry. After freshness correctly recognizes the
  // harness-observed failed Test as repair-required, recover that persisted stalled shape
  // on restart instead of requiring an operator to rewrite task state.
  if (
    !stage &&
    task.status === "ready-for-test" &&
    task.currentStage === "test" &&
    task.gateFreshness?.test?.reasonCode === "repair_required"
  ) {
    stage = "test";
  }
  if (!stage) return false;
  const freshness = task.gateFreshness?.[stage] ?? null;
  const repairRequired = freshness?.reasonCode === "repair_required";
  const recovery = repairRequired
    ? { taskStatus: "repair-required", candidateStatus: "repair_required" }
    : {
        "dev-review": { taskStatus: "ready-for-review", candidateStatus: "ready_for_review" },
        test: { taskStatus: "ready-for-test", candidateStatus: "ready_for_test" },
        "final-review": { taskStatus: "ready-for-final-review", candidateStatus: "ready_for_final_review" },
      }[stage];
  task.status = recovery.taskStatus;
  task.currentStage = stage;
  candidate.status = recovery.candidateStatus;
  task.error = freshness?.reasonCopy ?? RUNTIME_FRESHNESS_REASONS.missing_authoritative_summary;
  task.events ??= [];
  const sourceRunId = freshness?.sourceRunId ?? null;
  if (!task.events.some((event) => event.title === "Persisted gate evidence invalidated" && event.runId === sourceRunId)) {
    task.events.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      category: "decision",
      tone: "warning",
      stage,
      title: "Persisted gate evidence invalidated",
      detail: `${stage} cannot remain advanced. ${task.error}`,
      runId: sourceRunId,
      artifactId: freshness?.sourceArtifactId ?? null,
      freshness: freshness ? structuredClone(freshness) : null,
    });
  }
  return true;
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

function isTimeoutRun(run) {
  return ["timed-out", "timed_out", "timeout"].includes(run.status);
}
