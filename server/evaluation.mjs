import { createHash } from "node:crypto";

const GATE_STAGES = ["dev-review", "test", "final-review"];
const TERMINAL_STATUSES = new Set(["awaiting-human-approval", "completed", "closed", "blocked", "failed", "cancelled"]);

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
  return /^\s*(?:PASS\b|(?:#+\s*)?Verdict\s*:?\s*(?:\r?\n)+\s*PASS\b)/i.test(artifact?.content ?? "");
}

function qualityScore(evaluation, kind) {
  if (evaluation?.scores?.[kind]?.score) return evaluation.scores[kind].score;
  return kind === "human" ? evaluation?.score ?? null : null;
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
      ? createHash("sha256").update(Buffer.from(String(attachment.data), "base64")).digest("hex")
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
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("Experiment configuration must be an object.");
  const groupId = String(input.groupId ?? "").trim().slice(0, 120);
  const variantId = String(input.variantId ?? "").trim().slice(0, 120);
  const acceptanceCriteria = cleanStringList(input.acceptanceCriteria, "acceptance criteria");
  const verificationCommands = cleanStringList(input.verificationCommands, "verification commands");
  if (!groupId || !variantId) throw new Error("Controlled experiments require group and variant IDs.");
  if (!/^[a-f0-9]{40,64}$/i.test(frozenBaseSha ?? "")) throw new Error("Controlled experiments require a verified frozen base commit SHA.");
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
    createdAt: new Date().toISOString(),
  };
}

function cleanStringList(value, label) {
  if (!Array.isArray(value) || value.length > 30) throw new Error(`Experiment ${label} must be a list of at most 30 items.`);
  return value.map((item) => String(item ?? "").trim().slice(0, 1_000)).filter(Boolean);
}

export function normalizeEvaluationInput(input, previous = null) {
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error("Evaluation score must be an integer from 1 to 5.");
  const kind = input.kind === "blind" ? "blind" : "human";
  const rubric = normalizeRubric(input.rubric, score);
  const entry = {
    score,
    outcome: ["accepted", "rejected", "mixed"].includes(input.outcome) ? input.outcome : "mixed",
    rubric,
    notes: String(input.notes ?? "").trim().slice(0, 5_000),
    evaluator: String(input.evaluator ?? "").trim().slice(0, 160) || null,
    evaluatedAt: new Date().toISOString(),
  };
  const scores = { ...(previous?.scores ?? {}), [kind]: entry };
  return {
    ...previous,
    ...(kind === "human" ? entry : {}),
    suiteId: String(input.suiteId ?? previous?.suiteId ?? "").trim().slice(0, 120) || null,
    caseId: String(input.caseId ?? previous?.caseId ?? "").trim().slice(0, 120) || null,
    scores,
  };
}

function normalizeRubric(value, fallbackScore) {
  if (value == null) return { overall: fallbackScore };
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Evaluation rubric must be an object of named 1-5 scores.");
  const entries = Object.entries(value).slice(0, 30).map(([key, rawScore]) => {
    const name = String(key).trim().slice(0, 80);
    const score = Number(rawScore);
    if (!name || !Number.isInteger(score) || score < 1 || score > 5) throw new Error("Every rubric score must be an integer from 1 to 5.");
    return [name, score];
  });
  return entries.length ? Object.fromEntries(entries) : { overall: fallbackScore };
}

function observationalSummary(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    for (const artifact of task.artifacts ?? []) {
      if (!String(artifact.model ?? "").startsWith("gpt-")) continue;
      const role = artifact.agentRole ?? artifact.stage;
      const reasoning = artifact.reasoning ?? "not-recorded";
      const key = `${role}|${artifact.model}|${reasoning}`;
      const group = groups.get(key) ?? {
        role,
        model: artifact.model,
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
        if (passesGate(artifact)) group.gatePasses += 1;
        else group.gateRepairs += 1;
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
      averageHumanScore: group.humanScores.length ? round(group.humanScores.reduce((sum, value) => sum + value, 0) / group.humanScores.length, 2) : null,
    }))
    .sort((left, right) => left.role.localeCompare(right.role) || right.runs - left.runs);
}

function experimentTaskMetrics(task) {
  const gateResults = GATE_STAGES.map((stage) => {
    const attempts = (task.artifacts ?? []).filter((artifact) => artifact.stage === stage);
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
  const retryCount = Object.values(task.attemptsByStage ?? {}).reduce((sum, attempts) => sum + Math.max(0, Number(attempts ?? 0) - 1), 0);
  const repairCount = (task.candidates ?? []).reduce(
    (sum, candidate) => sum + (candidate.revisions ?? []).filter((revision) => revision.reason === "repair").length,
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
    for (const [role, duration] of Object.entries(metrics.roleDurations)) group.roleDurations[role] = (group.roleDurations[role] ?? 0) + duration;
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
      averageHumanScore: group.humanScores.length ? round(group.humanScores.reduce((sum, value) => sum + value, 0) / group.humanScores.length, 2) : null,
      averageBlindScore: group.blindScores.length ? round(group.blindScores.reduce((sum, value) => sum + value, 0) / group.blindScores.length, 2) : null,
    }))
    .sort((left, right) => left.groupId.localeCompare(right.groupId) || left.variantId.localeCompare(right.variantId));
}

export function buildEvaluationSummary(tasks) {
  const observations = observationalSummary(tasks);
  const experiments = controlledSummary(tasks);
  return {
    generatedAt: new Date().toISOString(),
    methodology: "Historical observations and controlled experiments are reported separately. Percentages include sample counts and do not imply statistical significance.",
    evaluatedTasks: tasks.filter((task) => task.evaluation).length,
    variants: observations,
    observations: {
      methodology: "Observational stage-run metrics across historical tasks; differences may be confounded by task, context, and policy.",
      evaluatedTasks: tasks.filter((task) => task.evaluation && !task.experiment).length,
      variants: observations,
    },
    experiments: {
      methodology: "Controlled task variants grouped by explicit experiment and variant IDs with frozen briefs, bases, policies, acceptance criteria, and verification commands.",
      taskCount: tasks.filter((task) => task.experiment).length,
      variants: experiments,
    },
  };
}
