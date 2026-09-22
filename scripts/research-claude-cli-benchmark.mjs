// Phase 1 exit test: the 30 pinned scopes through the harness's `claude-cli` runtime, three
// runs each, compared with the 90 recorded runs in `17a-top30-results.json`.
//
//   RESEARCH_QV_INDEX=/path/to/indexed-items.jsonl \
//   RUN_CLAUDE_CLI_BENCHMARK=1 node scripts/research-claude-cli-benchmark.mjs
//
// This spends real plan usage: roughly $5 per scenario, about $150 for the full set. The
// opt-in variable exists so that no one runs it by reflex. `--scopes` and `--limit` cut it
// down for a smoke test; a partial run reports the comparison and explicitly declines to
// return an exit-test verdict, because the exit test is defined over all thirty.
//
// If the counts do not reproduce, the port is wrong. Do not proceed to phase 2 and do not tune
// the thresholds to fit.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ClaudeCliResearchRuntime } from "../server/research/claude-cli/runtime.mjs";
import { resolveResearchBudget } from "../src/research-budget-policy.ts";
import {
  compareWithBaseline,
  evaluateExitTest,
  loadPinnedScopes,
  RECORDED_BASELINE,
  runBenchmark,
} from "./research-claude-cli/benchmark.mjs";

if (process.env.RUN_CLAUDE_CLI_BENCHMARK !== "1")
  throw new Error(
    "Set RUN_CLAUDE_CLI_BENCHMARK=1 to confirm live runs on the Claude subscription. " +
      `The full set is ${RECORDED_BASELINE.scenarios} scenarios x 3 runs, around $${RECORDED_BASELINE.planUsdPerScenario} of plan usage each.`,
  );

const options = readOptions(process.argv.slice(2));
const scopes = (await loadPinnedScopes({ only: options.scopes })).slice(0, options.limit ?? undefined);
if (!scopes.length) throw new Error("No pinned scopes matched the selection.");

// `--merge` carries the completed scenarios of an earlier report forward, so a run cut short by
// the plan window can be finished rather than repeated. Only scenarios that completed all three
// runs are carried: an `incomplete` row in the old report is exactly what this run is replacing,
// and keeping it would let a crash sit in the results under whichever status it happened to get.
const carried = options.merge ? await loadCompletedRecords(options.merge) : [];
if (options.merge)
  process.stderr.write(`Carrying ${carried.length} completed scenario(s) forward from ${options.merge}.\n`);

// `standard` is the profile the recorded runs are closest to in wall-clock terms. The hard
// ceilings are the harness's; the CLI enforces `--max-budget-usd` itself when `maxUsd` is set.
const budget = resolveResearchBudget("standard", {
  maxRuntimeMs: 20 * 60_000,
  ...(options.maxUsd ? { maxUsd: options.maxUsd } : {}),
});

const runtime = new ClaudeCliResearchRuntime({
  maxConcurrentRuns: options.concurrency,
  ...(options.model ? { model: options.model } : {}),
});

const startedAt = Date.now();
process.stderr.write(
  `Running ${scopes.length} scenario(s) x 3 runs at concurrency ${options.concurrency}…\n`,
);

const { records: fresh, aborted } = await runBenchmark({
  runtime,
  scopes,
  budget,
  onProgress: ({ index, total, record }) => {
    process.stderr.write(
      `[${index}/${total}] ${record.scenarioId}: ${record.status} ` +
        `(${record.agreement.runsWithBand}/${record.agreement.runsTotal} banded, ` +
        `low x${record.agreement.lowRatio ?? "-"}, high x${record.agreement.highRatio ?? "-"}, ` +
        `$${(record.costUsd ?? 0).toFixed(2)}, ${Math.round(record.elapsedMs / 1000)}s)\n`,
    );
  },
});
if (aborted) process.stderr.write(`\nABORTED after ${aborted.scenario}: ${aborted.message}\n`);

const records = mergeRecords(carried, fresh);
const comparison = await compareWithBaseline(records);
const exitTest = evaluateExitTest(comparison, { scenariosRun: records.length });

const report = {
  generatedAt: new Date().toISOString(),
  runtime: runtime.id,
  model: options.model ?? null,
  concurrency: options.concurrency,
  elapsedMs: Date.now() - startedAt,
  aborted,
  mergedFrom: options.merge ?? null,
  scenariosRunNow: fresh.map((record) => record.scenarioId),
  comparison,
  exitTest,
  records,
};
await mkdir(path.dirname(options.out), { recursive: true });
await writeFile(options.out, `${JSON.stringify(report, null, 1)}\n`, "utf8");

process.stdout.write(`${renderSummary(report)}\n`);
process.stderr.write(`Report written to ${options.out}\n`);
// A partial run has no verdict to fail on, so it exits 0 with the comparison and says so.
if (exitTest.applicable && !exitTest.passed) process.exitCode = 1;
// 2, not 1: "the run did not finish" and "the port is wrong" are different answers, and a
// caller that cannot tell them apart will read a quota wall as a failed port.
if (aborted) process.exitCode = 2;

/** New runs win. A scenario re-run after a quota wall replaces whatever the aborted run left. */
function mergeRecords(previous, current) {
  const byScenario = new Map(previous.map((record) => [record.scenarioId, record]));
  for (const record of current) byScenario.set(record.scenarioId, record);
  return [...byScenario.values()].sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}

async function loadCompletedRecords(file) {
  const previous = JSON.parse(await readFile(file, "utf8"));
  // Checked run by run rather than on the scenario status, because a report written before
  // `incomplete` existed records its crashed scenarios as `not_established` — which is the
  // exact conflation this merge must not carry forward.
  return (previous.records ?? []).filter((record) =>
    (record.runs ?? []).every((run) => run.status === "completed"),
  );
}

function renderSummary(report) {
  const { counts } = report.comparison;
  const lines = [
    `scenarios            ${counts.scenarios}`,
    `with a cost band     ${counts.withBand}  (recorded ${RECORDED_BASELINE.withBand} of ${RECORDED_BASELINE.scenarios})`,
    `three-run agreement  ${counts.agreed}  (recorded ${RECORDED_BASELINE.agreed})`,
    `disputed             ${counts.disputed}`,
    `no band              ${counts.notEstablished}`,
    `incomplete           ${counts.incomplete}  (runs that failed — not a finding either way)`,
    `status bucket match  ${report.comparison.statusMatches} of ${counts.scenarios}`,
    `plan usage           $${report.comparison.planUsd} ($${report.comparison.planUsdPerScenario}/scenario, recorded $${RECORDED_BASELINE.planUsdPerScenario})`,
  ];
  if (report.aborted)
    lines.push(
      "",
      `RUN ABORTED at ${report.aborted.scenario}: ${report.aborted.message}`,
      `  ${report.aborted.remaining.length} scenario(s) never ran: ${report.aborted.remaining.join(", ") || "none"}`,
    );
  if (!report.exitTest.applicable) {
    lines.push("", `EXIT TEST NOT RUN: ${report.exitTest.reason}`);
    return lines.join("\n");
  }
  lines.push("", report.exitTest.passed ? "EXIT TEST PASSED" : "EXIT TEST FAILED");
  for (const check of report.exitTest.checks)
    lines.push(
      `  ${check.passed ? "ok  " : "FAIL"} ${check.name}: ${check.actual} (expected ${check.expected})`,
    );
  if (!report.exitTest.passed)
    lines.push(
      "",
      "The port is wrong. Do not proceed to phase 2, and do not tune the agreement thresholds to fit.",
    );
  return lines.join("\n");
}

function readOptions(argv) {
  const options = {
    scopes: null,
    limit: null,
    concurrency: 3,
    model: null,
    maxUsd: null,
    merge: null,
    out: path.resolve(".data", "research-claude-cli", "phase-1-benchmark.json"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split("=");
    const value = inline ?? argv[++index];
    if (flag === "--scopes")
      options.scopes = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    else if (flag === "--limit") options.limit = Number(value);
    else if (flag === "--concurrency") options.concurrency = Math.max(1, Number(value));
    else if (flag === "--model") options.model = value;
    else if (flag === "--max-usd") options.maxUsd = Number(value);
    else if (flag === "--merge") options.merge = path.resolve(value);
    else if (flag === "--out") options.out = path.resolve(value);
    else throw new Error(`Unknown option ${flag}.`);
  }
  return options;
}
