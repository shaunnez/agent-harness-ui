// Opt-in controlled evaluation limits. Ordinary tasks and historical experiments are unchanged.
export function evaluationAllowance(task, nowMs = Date.now()) {
  const limits = task.experiment?.evaluationLimits;
  if (!limits) return null;
  const budget = task.experiment.budget;
  const started = Date.parse(task.startedAt);
  if (!Number.isFinite(started)) throw new Error("Evaluation allowance requires a recorded start time.");
  const remainingMs = budget.maxWallTimeMs - Math.max(0, nowMs - started);
  const attempts = (task.runs ?? []).filter((run) => run.model && run.provider !== "deterministic");
  let tokens = 0;
  for (const run of attempts.filter((entry) => entry.completedAt)) {
    if (!Number.isFinite(run.usage?.totalTokens))
      throw new Error("Evaluation allowance cannot admit another run with missing prior usage.");
    tokens += run.usage.totalTokens;
  }
  if (remainingMs <= 0 || tokens >= budget.maxTotalTokens || attempts.length >= limits.maxAgentRuns) {
    const error = new Error(
      `Evaluation allowance exhausted: ${attempts.length}/${limits.maxAgentRuns} agent runs, ${tokens}/${budget.maxTotalTokens} tokens, ${Math.max(0, remainingMs)}ms remaining.`,
    );
    error.code = "EVALUATION_ALLOWANCE";
    throw error;
  }
  return { remainingMs, tokens, attempts: attempts.length };
}

export function normalizeEvaluationLimits(value, budget) {
  if (value == null) return null;
  if (!Number.isInteger(value.maxAgentRuns) || value.maxAgentRuns < 1 || value.maxAgentRuns > 100)
    throw new Error("Evaluation maxAgentRuns must be between 1 and 100.");
  if (!budget?.maxWallTimeMs || !budget?.maxTotalTokens)
    throw new Error("Evaluation limits require both wall-time and token ceilings.");
  if (
    value.maxProviderInvocations != null &&
    (!Number.isInteger(value.maxProviderInvocations) ||
      value.maxProviderInvocations < 1 ||
      value.maxProviderInvocations > 1000)
  )
    throw new Error("Evaluation maxProviderInvocations must be between 1 and 1000.");
  return {
    maxAgentRuns: value.maxAgentRuns,
    ...(value.maxProviderInvocations != null ? { maxProviderInvocations: value.maxProviderInvocations } : {}),
  };
}
