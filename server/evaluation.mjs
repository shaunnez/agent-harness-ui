import { createHash } from "node:crypto";

const GATE_STAGES = ["dev-review", "test", "final-review"];
const TERMINAL_STATUSES = new Set([
  "awaiting-human-approval",
  "merged-to-target",
  "completed",
  "closed",
  "archived",
  "blocked",
  "failed",
  "cancelled",
]);

function round(value, places = 6) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function safeDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;
  const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(duration) ? Math.max(0, duration) : null;
}

function passesGate(artifact) {
  return artifact?.gateResult?.verdict === "PASS";
}

function qualityScore(evaluation, kind) {
  if (evaluation?.scores?.[kind]?.score) return evaluation.scores[kind].score;
  return kind === "human" ? (evaluation?.score ?? null) : null;
}

function addUsage(target, usage = {}) {
  target.inputTokens += usage.inputTokens ?? 0;
  target.cachedInputTokens += usage.cachedInputTokens ?? 0;
  target.outputTokens += usage.outputTokens ?? 0;
  if (usage.credits != null) {
    target.credits += usage.credits;
    target.creditSamples += 1;
  }
  if (usage.cost != null) {
    target.apiEstimate += usage.cost;
    target.apiEstimateSamples += 1;
  }
}

/**
 * The eight assumption-owners a failed run can be routed back to. Each maps to a distinct
 * rewind target, which is why none of them collapse into another. Phase 4's deterministic
 * router imports this list rather than restating it.
 */
export const FAILURE_CLASSIFICATIONS = Object.freeze([
  "IMPLEMENTATION_DEFECT",
  "PLAN_DEFECT",
  "SPECIFICATION_GAP",
  "INVESTIGATION_GAP",
  "VERIFICATION_GAP",
  "ENVIRONMENT_FAILURE",
  "INTEGRATION_FAILURE",
  "TARGET_DRIFT",
]);

const FAILURE_CLASSIFICATION_SET = new Set(FAILURE_CLASSIFICATIONS);

/**
 * `advance` is the ordinary next stage. `backjump` returns to an earlier stage whose
 * assumption failed. `revise` is a bounded same-stage retry driven by a critic. `challenge`
 * is an independent adversarial pass over a stage's own output.
 */
export const TOPOLOGY_EDGE_KINDS = Object.freeze(["advance", "backjump", "revise", "challenge"]);

export const UNSPECIFIED_TOPOLOGY_ID = "topology-unspecified";

const TOPOLOGY_ID_PATTERN = /^topology-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function cleanIdentifier(value, max = 80) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function boundedList(value, label, max) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`Topology trace ${label} must be a list of at most ${max} entries.`);
  return value;
}

export function emptyTopologyTrace() {
  return { nodesExecuted: [], nodesSkipped: [], edgesTaken: [], routingDecisions: [] };
}

/**
 * Topologies are named by shape and versioned in the id (`topology-bug-localisation-v2`) so
 * experiment output stays readable. An explicit `topologyVersion` is allowed but must agree
 * with the suffix, so the two can never drift apart in the record.
 */
export function normalizeTopologyIdentity(input = {}) {
  const topologyId = cleanIdentifier(input.topologyId, 120).toLowerCase();
  if (!topologyId) return { topologyId: UNSPECIFIED_TOPOLOGY_ID, topologyVersion: null };
  if (!TOPOLOGY_ID_PATTERN.test(topologyId))
    throw new Error('Topology ids must look like "topology-<shape>-v<n>", using lowercase words and digits.');
  const suffix = topologyId.match(/-v(\d+)$/);
  if (input.topologyVersion == null)
    return { topologyId, topologyVersion: suffix ? Number(suffix[1]) : null };
  const topologyVersion = Number(input.topologyVersion);
  if (!Number.isInteger(topologyVersion) || topologyVersion < 0 || topologyVersion > 9_999)
    throw new Error("Topology version must be a non-negative integer.");
  if (suffix && Number(suffix[1]) !== topologyVersion)
    throw new Error("Topology version contradicts the version suffix in the topology id.");
  return { topologyId, topologyVersion };
}

/**
 * The record of which reasoning graph a run actually walked. Written by the orchestrator as
 * stages execute; read here only for reporting. Fail-closed on malformed input so a bad
 * writer is caught at the write site rather than silently producing empty telemetry.
 */
export function normalizeTopologyTrace(value) {
  if (value == null) return emptyTopologyTrace();
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Topology trace must be an object.");
  return {
    nodesExecuted: boundedList(value.nodesExecuted, "nodesExecuted", 200)
      .map((node) => cleanIdentifier(node))
      .filter(Boolean),
    nodesSkipped: boundedList(value.nodesSkipped, "nodesSkipped", 200)
      .map((entry) => ({
        node: cleanIdentifier(entry?.node),
        reason: cleanIdentifier(entry?.reason, 300) || null,
      }))
      .filter((entry) => entry.node),
    edgesTaken: boundedList(value.edgesTaken, "edgesTaken", 400)
      .map((edge) => {
        const kind = cleanIdentifier(edge?.kind).toLowerCase() || "advance";
        if (!TOPOLOGY_EDGE_KINDS.includes(kind))
          throw new Error(`Topology edge kind must be one of: ${TOPOLOGY_EDGE_KINDS.join(", ")}.`);
        return { from: cleanIdentifier(edge?.from), to: cleanIdentifier(edge?.to), kind };
      })
      .filter((edge) => edge.from && edge.to),
    routingDecisions: boundedList(value.routingDecisions, "routingDecisions", 200).map((decision) => {
      const classification = cleanIdentifier(decision?.classification, 60).toUpperCase();
      if (!FAILURE_CLASSIFICATION_SET.has(classification))
        throw new Error(
          `Routing decisions must use a known failure classification: ${FAILURE_CLASSIFICATIONS.join(", ")}.`,
        );
      return {
        at: cleanIdentifier(decision?.at) || null,
        classification,
        rewindTo: cleanIdentifier(decision?.rewindTo) || null,
        rationale: cleanIdentifier(decision?.rationale, 1_000) || null,
      };
    }),
  };
}

/**
 * Reporting must never crash on one badly-written trace, so an invalid trace degrades to
 * empty telemetry and is counted instead. A non-zero `invalid` count in the summary is the
 * signal that a writer is broken.
 */
function topologyTraceMetrics(value) {
  let trace;
  let invalid = false;
  try {
    trace = normalizeTopologyTrace(value);
  } catch {
    trace = emptyTopologyTrace();
    invalid = true;
  }
  const failureClassifications = {};
  for (const decision of trace.routingDecisions) {
    failureClassifications[decision.classification] =
      (failureClassifications[decision.classification] ?? 0) + 1;
  }
  const countKind = (kind) => trace.edgesTaken.filter((edge) => edge.kind === kind).length;
  return {
    invalid,
    nodesExecuted: trace.nodesExecuted,
    nodesSkipped: trace.nodesSkipped.map((entry) => entry.node),
    edgesTaken: trace.edgesTaken.length,
    routingDecisions: trace.routingDecisions.length,
    backjumpCount: countKind("backjump"),
    reviseCount: countKind("revise"),
    challengeCount: countKind("challenge"),
    failureClassifications,
  };
}

export function hashTaskBrief(input) {
  const attachments = (input.attachments ?? []).map((attachment) => ({
    name: String(attachment.name ?? ""),
    type: String(attachment.type ?? ""),
    size: Number(attachment.size ?? 0),
    contentHash: attachment.data
      ? createHash("sha256")
          .update(Buffer.from(String(attachment.data), "base64"))
          .digest("hex")
      : null,
  }));
  const canonical = JSON.stringify({
    title: String(input.title ?? "").trim(),
    description: String(input.description ?? "").trim(),
    workflow: input.workflow,
    priority: input.priority,
    attachments,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function normalizeExperimentInput(input, { taskBriefHash, policyMatrix, frozenBaseSha }) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error("Experiment configuration must be an object.");
  const groupId = String(input.groupId ?? "")
    .trim()
    .slice(0, 120);
  const variantId = String(input.variantId ?? "")
    .trim()
    .slice(0, 120);
  const acceptanceCriteria = cleanStringList(input.acceptanceCriteria, "acceptance criteria");
  const verificationCommands = cleanStringList(input.verificationCommands, "verification commands");
  if (!groupId || !variantId) throw new Error("Controlled experiments require group and variant IDs.");
  if (!/^[a-f0-9]{40,64}$/i.test(frozenBaseSha ?? ""))
    throw new Error("Controlled experiments require a verified frozen base commit SHA.");
  if (!acceptanceCriteria.length || !verificationCommands.length) {
    throw new Error("Controlled experiments require acceptance criteria and verification commands.");
  }
  const { topologyId, topologyVersion } = normalizeTopologyIdentity(input);
  return {
    groupId,
    variantId,
    topologyId,
    topologyVersion,
    frozenBaseSha: frozenBaseSha.toLowerCase(),
    taskBriefHash,
    policyMatrix: structuredClone(policyMatrix),
    acceptanceCriteria,
    verificationCommands,
    createdAt: new Date().toISOString(),
  };
}

function cleanStringList(value, label) {
  if (!Array.isArray(value) || value.length > 30)
    throw new Error(`Experiment ${label} must be a list of at most 30 items.`);
  return value
    .map((item) =>
      String(item ?? "")
        .trim()
        .slice(0, 1_000),
    )
    .filter(Boolean);
}

export function normalizeEvaluationInput(input, previous = null) {
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 1 || score > 5)
    throw new Error("Evaluation score must be an integer from 1 to 5.");
  const kind = input.kind === "blind" ? "blind" : "human";
  const rubric = normalizeRubric(input.rubric, score);
  const entry = {
    score,
    outcome: ["accepted", "rejected", "mixed"].includes(input.outcome) ? input.outcome : "mixed",
    rubric,
    notes: String(input.notes ?? "")
      .trim()
      .slice(0, 5_000),
    evaluator:
      String(input.evaluator ?? "")
        .trim()
        .slice(0, 160) || null,
    evaluatedAt: new Date().toISOString(),
  };
  const scores = { ...(previous?.scores ?? {}), [kind]: entry };
  return {
    ...previous,
    ...(kind === "human" ? entry : {}),
    suiteId:
      String(input.suiteId ?? previous?.suiteId ?? "")
        .trim()
        .slice(0, 120) || null,
    caseId:
      String(input.caseId ?? previous?.caseId ?? "")
        .trim()
        .slice(0, 120) || null,
    scores,
  };
}

function normalizeRubric(value, fallbackScore) {
  if (value == null) return { overall: fallbackScore };
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Evaluation rubric must be an object of named 1-5 scores.");
  const entries = Object.entries(value)
    .slice(0, 30)
    .map(([key, rawScore]) => {
      const name = String(key).trim().slice(0, 80);
      const score = Number(rawScore);
      if (!name || !Number.isInteger(score) || score < 1 || score > 5)
        throw new Error("Every rubric score must be an integer from 1 to 5.");
      return [name, score];
    });
  return entries.length ? Object.fromEntries(entries) : { overall: fallbackScore };
}

function observationalSummary(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    for (const artifact of task.artifacts ?? []) {
      const model = String(artifact.model ?? "");
      const hasRecordedUsage = Number(artifact.usage?.totalTokens ?? 0) > 0;
      if (!model || model === "deterministic-aggregation" || (!artifact.runId && !hasRecordedUsage)) continue;
      const role = artifact.agentRole ?? artifact.stage;
      const reasoning = artifact.reasoning ?? "not-recorded";
      const key = `${role}|${artifact.model}|${reasoning}`;
      const group = groups.get(key) ?? {
        role,
        model,
        reasoning,
        runs: 0,
        taskIds: new Set(),
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        apiEstimate: 0,
        apiEstimateSamples: 0,
        credits: 0,
        creditSamples: 0,
        gatePasses: 0,
        gateRepairs: 0,
        humanScores: [],
      };
      group.runs += 1;
      group.taskIds.add(task.id);
      addUsage(group, artifact.usage);
      if (GATE_STAGES.includes(artifact.stage)) {
        if (artifact.gateResult?.verdict === "PASS") group.gatePasses += 1;
        if (artifact.gateResult?.verdict === "REPAIR") group.gateRepairs += 1;
      }
      const humanScore = qualityScore(task.evaluation, "human");
      if (humanScore) group.humanScores.push(humanScore);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      role: group.role,
      model: group.model,
      reasoning: group.reasoning,
      runs: group.runs,
      tasks: group.taskIds.size,
      inputTokens: group.inputTokens,
      cachedInputTokens: group.cachedInputTokens,
      outputTokens: group.outputTokens,
      cacheRate: group.inputTokens ? group.cachedInputTokens / group.inputTokens : null,
      cost: group.apiEstimateSamples ? round(group.apiEstimate) : null,
      credits: group.creditSamples ? round(group.credits) : null,
      gatePasses: group.gatePasses,
      gateRepairs: group.gateRepairs,
      averageHumanScore: group.humanScores.length
        ? round(group.humanScores.reduce((sum, value) => sum + value, 0) / group.humanScores.length, 2)
        : null,
    }))
    .sort((left, right) => left.role.localeCompare(right.role) || right.runs - left.runs);
}

function experimentTaskMetrics(task) {
  const gateResults = GATE_STAGES.map((stage) => {
    const attempts = (task.artifacts ?? []).filter(
      (artifact) => artifact.stage === stage && artifact.gateResult,
    );
    return {
      stage,
      attempts: attempts.length,
      firstPassSuccess: attempts.length ? passesGate(attempts[0]) : null,
      eventualSuccess: attempts.length ? attempts.some(passesGate) : null,
    };
  }).filter((gate) => gate.attempts);
  const roleDurations = {};
  let contextCharacters = 0;
  let estimatedContextTokens = 0;
  for (const artifact of task.artifacts ?? []) {
    const role = artifact.agentRole ?? artifact.stage;
    if (artifact.durationMs != null) roleDurations[role] = (roleDurations[role] ?? 0) + artifact.durationMs;
    contextCharacters += artifact.contextManifest?.promptCharacters ?? 0;
    estimatedContextTokens += artifact.contextManifest?.estimatedPromptTokens ?? 0;
  }
  const retryCount = Object.values(task.attemptsByStage ?? {}).reduce(
    (sum, attempts) => sum + Math.max(0, Number(attempts ?? 0) - 1),
    0,
  );
  const repairCount = (task.candidates ?? []).reduce(
    (sum, candidate) =>
      sum + (candidate.revisions ?? []).filter((revision) => revision.reason === "repair").length,
    0,
  );
  const end = task.completedAt ?? (TERMINAL_STATUSES.has(task.status) ? task.updatedAt : null);
  return {
    gateResults,
    repairCount,
    retryCount,
    wallTimeMs: safeDuration(task.startedAt, end),
    roleDurations,
    contextCharacters,
    estimatedContextTokens,
    humanScore: qualityScore(task.evaluation, "human"),
    blindScore: qualityScore(task.evaluation, "blind"),
    topology: topologyTraceMetrics(task.topologyTrace),
  };
}

function controlledSummary(tasks) {
  const groups = new Map();
  for (const task of tasks.filter((item) => item.experiment)) {
    const experiment = task.experiment;
    const topologyId = experiment.topologyId ?? UNSPECIFIED_TOPOLOGY_ID;
    const topologyVersion = experiment.topologyVersion ?? null;
    // Topology is an independent variable, so two runs that share a variant label but walked
    // different graphs are reported apart rather than averaged into one misleading row.
    const key = `${experiment.groupId}|${experiment.variantId}|${topologyId}@${topologyVersion}`;
    const group = groups.get(key) ?? {
      groupId: experiment.groupId,
      variantId: experiment.variantId,
      topologyId,
      topologyVersion,
      frozenBaseSha: experiment.frozenBaseSha,
      taskBriefHashes: new Set(),
      policyMatrices: new Map(),
      acceptanceDefinitions: new Set(),
      verificationDefinitions: new Set(),
      taskIds: [],
      gateAttempts: 0,
      firstPassGateSuccesses: 0,
      eventualGateSuccesses: 0,
      repairCount: 0,
      retryCount: 0,
      wallTimeMs: 0,
      wallTimeSamples: 0,
      roleDurations: {},
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      credits: 0,
      creditSamples: 0,
      apiEstimate: 0,
      apiEstimateSamples: 0,
      contextCharacters: 0,
      estimatedContextTokens: 0,
      humanScores: [],
      blindScores: [],
      nodesExecuted: 0,
      nodesSkipped: 0,
      nodeExecutionCounts: {},
      nodeSkipCounts: {},
      edgesTaken: 0,
      routingDecisions: 0,
      backjumpCount: 0,
      reviseCount: 0,
      challengeCount: 0,
      failureClassifications: {},
      invalidTopologyTraces: 0,
    };
    const metrics = experimentTaskMetrics(task);
    group.taskIds.push(task.id);
    group.taskBriefHashes.add(experiment.taskBriefHash);
    group.policyMatrices.set(JSON.stringify(experiment.policyMatrix), experiment.policyMatrix);
    group.acceptanceDefinitions.add(JSON.stringify(experiment.acceptanceCriteria));
    group.verificationDefinitions.add(JSON.stringify(experiment.verificationCommands));
    group.gateAttempts += metrics.gateResults.length;
    group.firstPassGateSuccesses += metrics.gateResults.filter((gate) => gate.firstPassSuccess).length;
    group.eventualGateSuccesses += metrics.gateResults.filter((gate) => gate.eventualSuccess).length;
    group.repairCount += metrics.repairCount;
    group.retryCount += metrics.retryCount;
    if (metrics.wallTimeMs != null) {
      group.wallTimeMs += metrics.wallTimeMs;
      group.wallTimeSamples += 1;
    }
    for (const [role, duration] of Object.entries(metrics.roleDurations))
      group.roleDurations[role] = (group.roleDurations[role] ?? 0) + duration;
    group.contextCharacters += metrics.contextCharacters;
    group.estimatedContextTokens += metrics.estimatedContextTokens;
    if (metrics.humanScore) group.humanScores.push(metrics.humanScore);
    if (metrics.blindScore) group.blindScores.push(metrics.blindScore);
    const topology = metrics.topology;
    group.nodesExecuted += topology.nodesExecuted.length;
    group.nodesSkipped += topology.nodesSkipped.length;
    for (const node of topology.nodesExecuted)
      group.nodeExecutionCounts[node] = (group.nodeExecutionCounts[node] ?? 0) + 1;
    for (const node of topology.nodesSkipped)
      group.nodeSkipCounts[node] = (group.nodeSkipCounts[node] ?? 0) + 1;
    group.edgesTaken += topology.edgesTaken;
    group.routingDecisions += topology.routingDecisions;
    group.backjumpCount += topology.backjumpCount;
    group.reviseCount += topology.reviseCount;
    group.challengeCount += topology.challengeCount;
    for (const [classification, count] of Object.entries(topology.failureClassifications))
      group.failureClassifications[classification] =
        (group.failureClassifications[classification] ?? 0) + count;
    if (topology.invalid) group.invalidTopologyTraces += 1;
    addUsage(group, task.usage);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      groupId: group.groupId,
      variantId: group.variantId,
      topologyId: group.topologyId,
      topologyVersion: group.topologyVersion,
      frozenBaseSha: group.frozenBaseSha,
      taskIds: group.taskIds,
      sampleCount: group.taskIds.length,
      taskBriefHashes: [...group.taskBriefHashes],
      policyMatrices: [...group.policyMatrices.values()],
      acceptanceDefinitions: [...group.acceptanceDefinitions].map(JSON.parse),
      verificationDefinitions: [...group.verificationDefinitions].map(JSON.parse),
      gateAttempts: group.gateAttempts,
      firstPassGateSuccesses: group.firstPassGateSuccesses,
      firstPassGateSuccessRate: group.gateAttempts ? group.firstPassGateSuccesses / group.gateAttempts : null,
      eventualGateSuccesses: group.eventualGateSuccesses,
      eventualGateSuccessRate: group.gateAttempts ? group.eventualGateSuccesses / group.gateAttempts : null,
      repairCount: group.repairCount,
      retryCount: group.retryCount,
      wallTimeMs: group.wallTimeSamples ? group.wallTimeMs : null,
      averageWallTimeMs: group.wallTimeSamples ? Math.round(group.wallTimeMs / group.wallTimeSamples) : null,
      roleDurations: group.roleDurations,
      inputTokens: group.inputTokens,
      cachedInputTokens: group.cachedInputTokens,
      outputTokens: group.outputTokens,
      cacheRate: group.inputTokens ? group.cachedInputTokens / group.inputTokens : null,
      credits: group.creditSamples ? round(group.credits) : null,
      apiEstimate: group.apiEstimateSamples ? round(group.apiEstimate) : null,
      contextCharacters: group.contextCharacters,
      estimatedContextTokens: group.estimatedContextTokens,
      averageHumanScore: group.humanScores.length
        ? round(group.humanScores.reduce((sum, value) => sum + value, 0) / group.humanScores.length, 2)
        : null,
      averageBlindScore: group.blindScores.length
        ? round(group.blindScores.reduce((sum, value) => sum + value, 0) / group.blindScores.length, 2)
        : null,
      nodesExecuted: group.nodesExecuted,
      nodesSkipped: group.nodesSkipped,
      nodeExecutionCounts: group.nodeExecutionCounts,
      nodeSkipCounts: group.nodeSkipCounts,
      edgesTaken: group.edgesTaken,
      routingDecisions: group.routingDecisions,
      backjumpCount: group.backjumpCount,
      reviseCount: group.reviseCount,
      challengeCount: group.challengeCount,
      failureClassifications: group.failureClassifications,
      invalidTopologyTraces: group.invalidTopologyTraces,
    }))
    .sort(
      (left, right) =>
        left.groupId.localeCompare(right.groupId) ||
        left.variantId.localeCompare(right.variantId) ||
        left.topologyId.localeCompare(right.topologyId) ||
        (left.topologyVersion ?? -1) - (right.topologyVersion ?? -1),
    );
}

export function buildEvaluationSummary(tasks) {
  const observations = observationalSummary(tasks);
  const experiments = controlledSummary(tasks);
  return {
    generatedAt: new Date().toISOString(),
    methodology:
      "Historical observations and controlled experiments are reported separately. Percentages include sample counts and do not imply statistical significance.",
    evaluatedTasks: tasks.filter((task) => task.evaluation).length,
    variants: observations,
    observations: {
      methodology:
        "Observational stage-run metrics across historical tasks; differences may be confounded by task, context, and policy.",
      evaluatedTasks: tasks.filter((task) => task.evaluation && !task.experiment).length,
      variants: observations,
    },
    experiments: {
      methodology:
        "Controlled task variants grouped by explicit experiment, variant, and topology IDs with frozen briefs, bases, policies, acceptance criteria, and verification commands. Topology counters describe which reasoning graph each run walked and are zero for runs recorded before topology tracing existed.",
      taskCount: tasks.filter((task) => task.experiment).length,
      variants: experiments,
    },
  };
}
