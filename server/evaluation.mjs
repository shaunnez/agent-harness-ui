import { createHash } from "node:crypto";
import {
  buildExperimentDecisions,
  classifyTaskBudget,
  DEFAULT_DECISION_METRIC,
  normalizeDecisionMetric,
  normalizeExperimentBudget,
} from "./experiment-decision.mjs";

const GATE_STAGES = ["dev-review", "test", "final-review"];

/**
 * Only a whole-manifest execution is admissible as a delivery outcome. A focused run
 * declares a subset, so its `passed` says nothing about the commands it never selected.
 */
const FULL_MANIFEST_EXECUTION = "full-manifest";
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

/**
 * Deterministic delivery on the exact final candidate revision.
 *
 * Model-run gate verdicts cannot rank model policies against each other, because
 * `dev-review` and `final-review` are themselves model stages: a laxer reviewer model
 * produces *more* PASSes, so a policy comparison scored on gate verdicts rewards the
 * wrong thing. The repository verification manifest has no such property, so it is the
 * primary outcome a controlled comparison reports, and the model gates become a
 * separate measure of reviewer strictness.
 *
 * States are kept distinct rather than collapsed into pass/fail: `incomplete` means the
 * manifest stopped before every declared command ran, and `unknown` means no admissible
 * evidence exists. Neither is a pass, and neither is evidence of a defect.
 */
function finalCandidateVerification(task) {
  const candidate = (task.candidates ?? []).at(-1);
  if (!candidate) return { status: "unknown", reason: "no-candidate" };
  const admissible = (candidate.verificationRuns ?? []).filter(
    (run) =>
      run?.executionKind === FULL_MANIFEST_EXECUTION &&
      run?.headRevision != null &&
      run.headRevision === candidate.headRevision,
  );
  const newest = admissible.at(-1);
  if (!newest) {
    return {
      status: "unknown",
      reason: "no-full-manifest-execution-at-the-final-candidate-revision",
      candidateId: candidate.id ?? null,
      candidateRevision: candidate.revisionNumber ?? null,
    };
  }
  const declared = newest.declaredCommandIds ?? [];
  const executed = new Set(newest.executedCommandIds ?? []);
  const unexecuted = declared.filter((id) => !executed.has(id));
  const status = newest.status === "passed" ? (unexecuted.length ? "incomplete" : "passed") : "failed";
  return {
    status,
    reason: null,
    candidateId: candidate.id ?? null,
    candidateRevision: candidate.revisionNumber ?? null,
    headRevision: candidate.headRevision ?? null,
    declaredCommandCount: declared.length,
    executedCommandCount: executed.size,
    unexecutedCommandIds: unexecuted,
  };
}

/**
 * Any run whose effective policy diverged from the selected one. The experiment record
 * snapshots the *selected* matrix, so an escalation is invisible there: without this an
 * escalated repair silently changes an arm and the scorecard still reports the arm's
 * nominal policy.
 */
function policyDivergences(task) {
  const divergences = [];
  for (const run of task.runs ?? []) {
    const escalated =
      run?.policyEscalationReason != null ||
      (run?.selectedModel != null &&
        run?.effectiveModel != null &&
        (run.selectedModel !== run.effectiveModel || run.selectedReasoning !== run.effectiveReasoning));
    if (!escalated) continue;
    divergences.push({
      role: run.policyRole ?? run.role ?? run.stage ?? null,
      selected: `${run.selectedModel ?? "unknown"}:${run.selectedReasoning ?? "unknown"}`,
      effective: `${run.effectiveModel ?? run.model ?? "unknown"}:${run.effectiveReasoning ?? run.reasoning ?? "unknown"}`,
      reason: run.policyEscalationReason ?? "selected and effective policy differ with no recorded reason",
      gate: run.policyEscalationGate ?? null,
    });
  }
  return divergences;
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
  const decisionMetric = normalizeDecisionMetric(input.decisionMetric);
  const budget = normalizeExperimentBudget(input.budget);
  if (!groupId || !variantId) throw new Error("Controlled experiments require group and variant IDs.");
  if (!/^[a-f0-9]{40,64}$/i.test(frozenBaseSha ?? ""))
    throw new Error("Controlled experiments require a verified frozen base commit SHA.");
  if (!acceptanceCriteria.length || !verificationCommands.length) {
    throw new Error("Controlled experiments require acceptance criteria and verification commands.");
  }
  return {
    groupId,
    variantId,
    frozenBaseSha: frozenBaseSha.toLowerCase(),
    taskBriefHash,
    policyMatrix: structuredClone(policyMatrix),
    acceptanceCriteria,
    verificationCommands,
    decisionMetric,
    budget,
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

function totalTokensOf(usage = {}) {
  if (usage.totalTokens != null) return Number(usage.totalTokens) || 0;
  const input = Number(usage.inputTokens ?? 0) || 0;
  const output = Number(usage.outputTokens ?? 0) || 0;
  return input + output ? input + output : null;
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
    deterministicVerification: finalCandidateVerification(task),
    policyDivergences: policyDivergences(task),
    humanScore: qualityScore(task.evaluation, "human"),
    blindScore: qualityScore(task.evaluation, "blind"),
  };
}

function experimentBudgetStatus(group) {
  if (group.budgetExceededTaskIds.length) return "exceeded";
  const declared = [...group.budgets.values()].some((budget) => budget != null);
  if (!declared) return "not-declared";
  return group.budgetMeasuredSamples ? "within" : "unmeasured";
}

/**
 * Whether the samples inside one variant describe the same treatment at all.
 *
 * Grouping is `groupId|variantId`, and nothing stops two different briefs or two
 * different bases carrying the same pair. A pooled rate over mixed identity is not a
 * result, so it is labelled rather than presented as one. The recommended naming
 * contract is `variantId = <caseId>__<armId>`, which keeps one brief and one base per
 * variant and makes per-case pairing a string split.
 */
function comparabilityOf(group) {
  const reasons = [];
  if (group.taskBriefHashes.size > 1)
    reasons.push(`${group.taskBriefHashes.size} distinct task briefs are pooled under one variant`);
  if (group.frozenBaseShas.size > 1)
    reasons.push(`${group.frozenBaseShas.size} distinct frozen base commits are pooled under one variant`);
  if (group.policyMatrices.size > 1)
    reasons.push(`${group.policyMatrices.size} distinct policy matrices are pooled under one variant`);
  if (group.acceptanceDefinitions.size > 1)
    reasons.push(
      `${group.acceptanceDefinitions.size} distinct acceptance definitions are pooled under one variant`,
    );
  if (group.verificationDefinitions.size > 1)
    reasons.push(
      `${group.verificationDefinitions.size} distinct verification definitions are pooled under one variant`,
    );
  if (group.policyDivergences.length)
    reasons.push(
      `${group.policyDivergences.length} run${group.policyDivergences.length === 1 ? "" : "s"} executed a policy other than the selected one`,
    );
  return {
    status: reasons.length ? "mixed-identity" : "comparable",
    reasons,
    briefHashCount: group.taskBriefHashes.size,
    baseShaCount: group.frozenBaseShas.size,
    policyMatrixCount: group.policyMatrices.size,
    acceptanceDefinitionCount: group.acceptanceDefinitions.size,
    verificationDefinitionCount: group.verificationDefinitions.size,
  };
}

function controlledSummary(tasks) {
  const groups = new Map();
  for (const task of tasks.filter((item) => item.experiment)) {
    const experiment = task.experiment;
    const key = `${experiment.groupId}|${experiment.variantId}`;
    const group = groups.get(key) ?? {
      groupId: experiment.groupId,
      variantId: experiment.variantId,
      frozenBaseSha: experiment.frozenBaseSha,
      frozenBaseShas: new Set(),
      taskBriefHashes: new Set(),
      policyMatrices: new Map(),
      acceptanceDefinitions: new Set(),
      verificationDefinitions: new Set(),
      decisionMetrics: new Set(),
      budgets: new Map(),
      budgetExceededTaskIds: [],
      budgetMeasuredSamples: 0,
      deterministicOutcomes: { passed: 0, failed: 0, incomplete: 0, unknown: 0 },
      policyDivergences: [],
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
    };
    const metrics = experimentTaskMetrics(task);
    group.taskIds.push(task.id);
    group.frozenBaseShas.add(experiment.frozenBaseSha);
    group.taskBriefHashes.add(experiment.taskBriefHash);
    group.deterministicOutcomes[metrics.deterministicVerification.status] += 1;
    for (const divergence of metrics.policyDivergences)
      group.policyDivergences.push({ taskId: task.id, ...divergence });
    group.policyMatrices.set(JSON.stringify(experiment.policyMatrix), experiment.policyMatrix);
    group.acceptanceDefinitions.add(JSON.stringify(experiment.acceptanceCriteria));
    group.verificationDefinitions.add(JSON.stringify(experiment.verificationCommands));
    group.decisionMetrics.add(experiment.decisionMetric ?? DEFAULT_DECISION_METRIC);
    group.budgets.set(JSON.stringify(experiment.budget ?? null), experiment.budget ?? null);
    const taskBudget = classifyTaskBudget(experiment.budget ?? null, {
      wallTimeMs: metrics.wallTimeMs,
      totalTokens: totalTokensOf(task.usage),
    });
    if (taskBudget.exceeded) group.budgetExceededTaskIds.push(task.id);
    if (taskBudget.status === "within" || taskBudget.status === "exceeded") group.budgetMeasuredSamples += 1;
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
    addUsage(group, task.usage);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      groupId: group.groupId,
      variantId: group.variantId,
      frozenBaseSha: group.frozenBaseSha,
      taskIds: group.taskIds,
      sampleCount: group.taskIds.length,
      frozenBaseShas: [...group.frozenBaseShas],
      taskBriefHashes: [...group.taskBriefHashes],
      policyMatrices: [...group.policyMatrices.values()],
      acceptanceDefinitions: [...group.acceptanceDefinitions].map(JSON.parse),
      verificationDefinitions: [...group.verificationDefinitions].map(JSON.parse),
      decisionMetric: group.decisionMetrics.size === 1 ? [...group.decisionMetrics][0] : null,
      decisionMetricDrift: group.decisionMetrics.size > 1,
      budget: group.budgets.size === 1 ? [...group.budgets.values()][0] : null,
      budgetDrift: group.budgets.size > 1,
      budgetStatus: experimentBudgetStatus(group),
      budgetExceededTaskIds: group.budgetExceededTaskIds,
      comparability: comparabilityOf(group),
      policyDivergences: group.policyDivergences,
      deterministicOutcomes: { ...group.deterministicOutcomes },
      deterministicEvidenceSamples: evidenceSamples(group.deterministicOutcomes),
      deterministicDeliveryRate: deterministicRate(group.deterministicOutcomes),
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
    }))
    .sort(
      (left, right) =>
        left.groupId.localeCompare(right.groupId) || left.variantId.localeCompare(right.variantId),
    );
}

/**
 * Samples carrying admissible manifest evidence. `unknown` stays out of the denominator
 * instead of being counted as a failure: no evidence is not a defect.
 */
function evidenceSamples(outcomes) {
  return outcomes.passed + outcomes.failed + outcomes.incomplete;
}

function deterministicRate(outcomes) {
  const samples = evidenceSamples(outcomes);
  return samples ? outcomes.passed / samples : null;
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
        "Controlled task variants grouped by explicit experiment and variant IDs with frozen briefs, bases, policies, acceptance criteria, and verification commands. Deterministic delivery — the full verification manifest passing on the exact final candidate revision — is the primary outcome; model gate verdicts measure reviewer strictness and cannot rank reviewer policies against each other. Variants whose pooled samples do not share one brief, base, policy and acceptance definition are labelled mixed-identity and are not a result.",
      taskCount: tasks.filter((task) => task.experiment).length,
      variants: experiments,
      decisions: buildExperimentDecisions(experiments),
      decisionMethodology:
        "Each group is ranked on the single decision metric declared before the run. Remaining metrics are diagnostics. A leader is named only when every arm shares the same brief, base, acceptance criteria, verification commands and budget, and no arm exceeded it.",
    },
  };
}
