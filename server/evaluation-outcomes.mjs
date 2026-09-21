import { formatArgv, parseVerificationManifest } from "./verification.mjs";

const FINISHED = new Set([
  "awaiting-human-approval",
  "awaiting-pr-merge",
  "merged-to-target",
  "completed",
  "failed",
]);

export function candidateBinding(task) {
  const candidate = task.candidates?.at(-1);
  return candidate
    ? {
        candidateId: candidate.id,
        candidateRevision: candidate.revisionNumber,
        headRevision: candidate.headRevision,
      }
    : null;
}

export function matchesCandidate(binding, task) {
  const candidate = candidateBinding(task);
  return (
    candidate != null &&
    Object.entries(candidate).every(([key, value]) => value != null && binding?.[key] === value)
  );
}

// Diagnostic only: passing repository checks is necessary, not independent acceptance.
export function finalCandidateVerification(task) {
  const candidate = task.candidates?.at(-1);
  if (!candidate) return { status: "unknown", reason: "no-candidate" };
  const run = candidate.verificationRuns
    ?.filter((entry) => entry.executionKind === "full-manifest" && matchesCandidate(entry, task))
    .at(-1);
  if (!run) return { status: "unknown", reason: "no-bound-full-manifest" };
  if (run.status === "failed") return { status: "failed", reason: "command-failed" };
  const rows = run.rows ?? [];
  const declared = run.declaredCommandIds ?? [];
  const executed = new Set(run.executedCommandIds ?? []);
  const expected = task.experiment?.verificationCommands ?? [];
  if (
    !declared.length ||
    !expected.length ||
    declared.some((id) => !executed.has(id)) ||
    expected.some(
      (command) =>
        !rows.some((row) => row.command === command && row.status === "passed" && row.exitCode === 0),
    )
  ) {
    return { status: "incomplete", reason: "frozen-commands-not-proven" };
  }
  const frozen = task.experiment?.verificationManifest;
  if (
    frozen &&
    JSON.stringify(commandDefinitions(frozen.commands)) !==
      JSON.stringify(commandDefinitions(run.declaredCommands ?? []))
  ) {
    return { status: "incomplete", reason: "verification-definitions-changed" };
  }
  if (rows.some((row) => row.status !== "passed" || row.exitCode !== 0))
    return { status: "failed", reason: "command-failed" };
  return { status: run.status === "passed" ? "passed" : "incomplete", ...candidateBinding(task) };
}

export function commandDefinitions(commands) {
  return commands.map(({ id, command, timeoutMs, report }) => ({ id, command, timeoutMs, report }));
}

export function normalizeFrozenManifest(value, verificationCommands) {
  if (value == null) return null;
  const manifest = parseVerificationManifest(JSON.stringify(value));
  if (
    JSON.stringify(manifest.commands.map((entry) => formatArgv(entry.command))) !==
    JSON.stringify(verificationCommands)
  ) {
    throw new Error("Frozen verification commands must match the complete manifest argv definitions.");
  }
  return manifest;
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000)
    throw new Error(`${label} is required (at most 1000 characters).`);
  return value.trim();
}

export function normalizeEvaluationContract(value) {
  if (value == null) return null;
  const contract = Object.fromEntries(
    [
      "caseId",
      "caseVersion",
      "graderVersion",
      "rubricVersion",
      "harnessVersion",
      "environmentVersion",
      "executionVersion",
    ].map((key) => [key, requiredText(value[key], `Evaluation ${key}`)]),
  );
  if (!Array.isArray(value.checkIds) || !value.checkIds.length || value.checkIds.length > 100)
    throw new Error("Evaluation requires 1-100 independent check IDs.");
  contract.checkIds = value.checkIds.map((id) => requiredText(id, "Check ID"));
  if (new Set(contract.checkIds).size !== contract.checkIds.length)
    throw new Error("Evaluation check IDs must be unique.");
  return contract;
}

// Written by the external evaluator through the operator boundary, never by a workflow model.
export function normalizeTrialReceipt(input, task) {
  if (!task?.experiment?.evaluationContract)
    throw new Error("Independent trial receipts require a frozen evaluation contract.");
  if (task.activeRunIds?.length || task.status === "running")
    throw new Error("Stop the trial before finalizing its receipt.");
  if (!["completed", "invalid", "cancelled"].includes(input?.status))
    throw new Error("Trial status must be completed, invalid or cancelled.");
  const receipt = {
    status: input.status,
    reason: requiredText(input.reason, "Trial reason"),
    evaluator: requiredText(input.evaluator, "Trial evaluator"),
    evidence: requiredText(input.evidence, "Trial evidence location"),
    completedAt: new Date().toISOString(),
    humanRescue: input.humanRescue === true,
    acceptance: null,
  };
  if (input.deliveryEndedAt != null) {
    const end = Date.parse(input.deliveryEndedAt);
    if (!Number.isFinite(end) || end < Date.parse(task.startedAt) || end > Date.now())
      throw new Error("Delivery end time must be within the recorded trial interval.");
    receipt.deliveryEndedAt = new Date(end).toISOString();
  }
  if (input.providerInvocations != null) {
    if (!Array.isArray(input.providerInvocations) || input.providerInvocations.length > 1000)
      throw new Error("Provider invocations must be a bounded list.");
    const ids = new Set();
    receipt.providerInvocations = input.providerInvocations.map((entry) => {
      const id = requiredText(entry.id, "Invocation ID");
      if (ids.has(id)) throw new Error("Provider invocation IDs must be unique.");
      ids.add(id);
      const usage = entry.usage == null ? null : {};
      if (usage) {
        for (const key of [
          "inputTokens",
          "cachedInputTokens",
          "cacheWriteTokens",
          "outputTokens",
          "totalTokens",
          "cost",
          "credits",
        ]) {
          const value = entry.usage[key];
          if (value == null) {
            usage[key] = null;
            continue;
          }
          if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid provider usage ${key}.`);
          usage[key] = value;
        }
      }
      return {
        id,
        provider: requiredText(entry.provider, "Provider"),
        model: requiredText(entry.model, "Model"),
        usage,
      };
    });
  }
  if (input.status === "invalid") {
    if (input.failureClass !== "apparatus")
      throw new Error("Only adjudicated apparatus failures may be invalidated.");
    receipt.failureClass = "apparatus";
  }
  if (input.acceptance != null) {
    const grade = input.acceptance;
    if (input.status !== "completed" || !matchesCandidate(grade, task))
      throw new Error("Acceptance must bind the final candidate ID, revision and SHA.");
    const contract = task.experiment.evaluationContract;
    for (const key of ["caseVersion", "graderVersion", "rubricVersion"]) {
      if (grade[key] !== contract[key])
        throw new Error(`Acceptance ${key} differs from the frozen evaluation contract.`);
    }
    if (!["accepted", "rejected"].includes(grade.outcome) || typeof grade.rubricPassed !== "boolean")
      throw new Error("Acceptance requires an outcome and a rubric verdict.");
    if (
      !Array.isArray(grade.checks) ||
      grade.checks.length !== contract.checkIds.length ||
      new Set(grade.checks.map((check) => check.id)).size !== contract.checkIds.length ||
      grade.checks.some((check) => !contract.checkIds.includes(check.id) || typeof check.passed !== "boolean")
    ) {
      throw new Error("Acceptance must report every frozen independent check exactly once.");
    }
    receipt.acceptance = {
      ...candidateBinding(task),
      caseVersion: grade.caseVersion,
      graderVersion: grade.graderVersion,
      rubricVersion: grade.rubricVersion,
      outcome: grade.outcome,
      rubricPassed: grade.rubricPassed,
      checks: grade.checks.map(({ id, passed }) => ({ id, passed })),
    };
  }
  return receipt;
}

export function trialOutcome(task, verification, budget) {
  const receipt = task.evaluation?.trial;
  if (receipt?.status === "invalid") return "invalid";
  if (receipt?.status === "cancelled" || (!receipt && task.status === "cancelled")) return "cancelled";
  if (receipt?.status !== "completed" && (task.experiment?.evaluationContract || !FINISHED.has(task.status)))
    return "pending";
  if (verification.status !== "passed" || receipt?.humanRescue || budget.exceeded) return "failed";
  const grade = receipt?.acceptance;
  if (!grade || !matchesCandidate(grade, task)) return "ungraded";
  const contract = task.experiment?.evaluationContract;
  if (
    !contract ||
    ["caseVersion", "graderVersion", "rubricVersion"].some((key) => grade[key] !== contract[key]) ||
    contract.checkIds.some((id) => !grade.checks?.some((check) => check.id === id && check.passed === true))
  )
    return "failed";
  return grade.outcome === "accepted" && grade.rubricPassed === true && budget.status === "within"
    ? "accepted"
    : "failed";
}

export function policyDivergences(task) {
  const divergences = [];
  for (const run of task.runs ?? []) {
    const role = run.policyRole ?? run.role ?? run.stage;
    const expected = task.experiment?.policyMatrix?.[role];
    const effectiveModel = run.effectiveModel ?? run.model;
    const effectiveReasoning = run.effectiveReasoning ?? run.reasoning;
    const selectedModel = expected?.model ?? run.selectedModel;
    const selectedReasoning = expected?.reasoning ?? run.selectedReasoning;
    if (
      !run.policyEscalationReason &&
      (!selectedModel || (selectedModel === effectiveModel && selectedReasoning === effectiveReasoning))
    )
      continue;
    divergences.push({
      role,
      selected: `${selectedModel ?? "unknown"}:${selectedReasoning ?? "unknown"}`,
      effective: `${effectiveModel ?? "unknown"}:${effectiveReasoning ?? "unknown"}`,
      reason: run.policyEscalationReason ?? "effective policy differs from frozen selection",
    });
  }
  return divergences;
}

// Sum recorded attempts, including failed runs without artifacts. A partial aggregate is not a price.
export function trialResources(task) {
  const invocations = task.evaluation?.trial?.providerInvocations;
  const runs = (task.runs ?? []).filter((run) => run.model && run.provider !== "deterministic");
  const entries = invocations?.length
    ? invocations.map((entry) => entry.usage)
    : runs.length
      ? runs.map((run) => run.usage)
      : (task.artifacts ?? []).filter((artifact) => artifact.runId).map((artifact) => artifact.usage);
  if (!entries.length) entries.push(task.usage);
  const complete = (field) =>
    entries.every(
      (usage) => typeof usage?.[field] === "number" && Number.isFinite(usage[field]) && usage[field] >= 0,
    );
  const sum = (field) =>
    entries.reduce((total, usage) => total + (Number.isFinite(usage?.[field]) ? usage[field] : 0), 0);
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    totalTokens: complete("totalTokens") ? sum("totalTokens") : null,
    cost: complete("cost") ? sum("cost") : null,
    knownCost: sum("cost"),
    credits: complete("credits") ? sum("credits") : null,
    attempts: entries.length,
    pricedAttempts: entries.filter((usage) => typeof usage?.cost === "number" && Number.isFinite(usage.cost))
      .length,
  };
}
