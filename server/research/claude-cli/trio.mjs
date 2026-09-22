// Run one objective three times and compare, which is what verification meant in all 90
// recorded runs. Three is not a tuning knob: the recorded baseline is three runs per scenario
// and the agreement thresholds were calibrated against exactly that.
//
// The retry here is narrow on purpose. Only an empty output is retried — a clean exit with no
// result line, which correlated with spawn concurrency and never with the scope. Retrying a
// run that produced a bad band would quietly turn "these three disagree" into "these three
// agree, after I threw away the one that did not", which is the failure the whole three-run
// method exists to detect.

import { agreementForRuns } from "./agreement.mjs";
import { EMPTY_OUTPUT_ERROR_CODE } from "./runtime.mjs";

export const RUNS_PER_OBJECTIVE = 3;
export const DEFAULT_EMPTY_OUTPUT_RETRIES = 2;

/**
 * Run `objective` three times through `runtime` and return the bands plus their agreement.
 *
 * `runtime` owns the concurrency cap, so these three are submitted together and the runtime
 * decides how many actually spawn at once. `request` supplies everything but the id.
 */
export async function runTrio({
  runtime,
  scenarioId,
  objective,
  budget,
  profile = "standard",
  runs = RUNS_PER_OBJECTIVE,
  emptyOutputRetries = DEFAULT_EMPTY_OUTPUT_RETRIES,
  onEvent = null,
}) {
  const results = await Promise.all(
    Array.from({ length: runs }, (_unused, index) =>
      runOnce({
        runtime,
        runId: `${scenarioId}__r${index + 1}`,
        label: `r${index + 1}`,
        objective,
        budget,
        profile,
        retriesLeft: emptyOutputRetries,
        onEvent,
      }),
    ),
  );
  return { scenarioId, runs: results, ...agreementForRuns(results) };
}

async function runOnce({
  runtime,
  runId,
  label,
  objective,
  budget,
  profile,
  retriesLeft,
  onEvent,
  attempt = 1,
}) {
  const id = attempt === 1 ? runId : `${runId}_retry${attempt - 1}`;
  await runtime.start({ id, objective, profile, context: [], budget });
  for await (const event of runtime.events(id)) onEvent?.(id, event);
  const status = await runtime.status(id);
  const costBand = runtime.costBand(id);
  if (status.error?.code === EMPTY_OUTPUT_ERROR_CODE && retriesLeft > 0) {
    return runOnce({
      runtime,
      runId,
      label,
      objective,
      budget,
      profile,
      retriesLeft: retriesLeft - 1,
      onEvent,
      attempt: attempt + 1,
    });
  }
  return {
    run: label,
    runId: id,
    status: status.status,
    band: costBand?.band ?? null,
    resolvedFrom: costBand?.resolvedFrom ?? null,
    confidence: costBand?.confidence ?? null,
    components: costBand?.components ?? [],
    notEstablished: costBand?.notEstablished ?? [],
    costUsd: status.usage?.estimatedCostUsd ?? null,
    turns: status.usage?.modelCalls ?? null,
    ...(status.error ? { error: status.error } : {}),
  };
}
