import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildEvaluationSummary, hashTaskBrief, normalizeExperimentInput } from "../../server/evaluation.mjs";

const [campaignRoot] = process.argv.slice(2);
if (!campaignRoot) throw new Error("Usage: report-batch.mjs <campaign-root>");
const freeze = JSON.parse(await readFile(path.join(campaignRoot, "freeze.json"), "utf8"));
if (freeze.mode === "dry-run") {
  console.log(
    JSON.stringify({ status: "preflight-only", scheduledTrials: 0, inferenceTrials: 0, leader: null }),
  );
  process.exit(0);
}
const tasks = [];
const adjudication = await readFile(path.join(campaignRoot, "adjudication.json"), "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
for (const trial of freeze.trials) {
  const directory = path.join(campaignRoot, trial.id);
  try {
    const task = JSON.parse(await readFile(path.join(directory, "task.json"), "utf8"));
    tasks.push({ ...task, id: `${trial.id}/${task.id}` });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const config = JSON.parse(await readFile(path.join(directory, "config.json"), "utf8"));
    const cancelled = adjudication?.notLaunched?.includes(trial.id);
    tasks.push({
      id: `${trial.id}/${cancelled ? "cancelled" : "pending"}`,
      status: cancelled ? "cancelled" : "pending",
      artifacts: [],
      candidates: [],
      runs: [],
      usage: {},
      evaluation: cancelled
        ? { trial: { status: "cancelled", reason: adjudication.reason, evaluator: "campaign-adjudication" } }
        : null,
      experiment: normalizeExperimentInput(config.taskInput.experiment, {
        taskBriefHash: hashTaskBrief(config.taskInput),
        policyMatrix: config.taskInput.rolePolicyOverrides,
        frozenBaseSha: freeze.baseSha,
      }),
    });
  }
}
const summary = buildEvaluationSummary(tasks);
const report = {
  campaign: freeze.version,
  generatedAt: new Date().toISOString(),
  scheduledTrials: freeze.trials.length,
  status: adjudication?.notLaunched?.length
    ? "stopped"
    : summary.experiments.variants.some((variant) => variant.trialOutcomes.pending)
      ? "incomplete"
      : "finalized",
  adjudication,
  summary,
};
await writeFile(path.join(campaignRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    status: report.status,
    variants: summary.experiments.variants.map(
      ({ variantId, sampleCount, acceptedDeliveryRate, trialOutcomes, totalTokens, budgetStatus }) => ({
        variantId,
        sampleCount,
        acceptedDeliveryRate,
        trialOutcomes,
        totalTokens,
        budgetStatus,
      }),
    ),
    decisions: summary.experiments.decisions,
  }),
);
