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
//
// By default the agent has the host tools (`fetch_source`, `read_source`) and every citation
// is checked; the recorded runs had neither. `--no-host-tools` runs the recorded configuration
// exactly, which is the run to use when the question is whether the port itself is faithful.
//
// `--runtime codex-cli` runs the same scopes through Codex on the ChatGPT plan (GPT-6 Sol by
// default), behind its own opt-in, `RUN_CODEX_CLI_BENCHMARK=1`. The baseline is Opus's, so a
// Codex run is a measurement against it rather than a pass/fail port check: it reports the
// same comparison and never fails the exit code on it. Its dollar figure is an API-rate
// estimate; the plan itself bills nothing per call.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ClaudeCliResearchRuntime, RECORDED_BASELINE_MODEL } from "../server/research/claude-cli/runtime.mjs";
import { CodexCliResearchRuntime, DEFAULT_CODEX_CLI_MODEL } from "../server/research/codex-cli/runtime.mjs";
import { resolveResearchBudget } from "../src/research-budget-policy.ts";
import {
  compareWithBaseline,
  evaluateExitTest,
  loadPinnedScopes,
  RECORDED_BASELINE,
  runBenchmark,
} from "./research-claude-cli/benchmark.mjs";

// Measured against the recorded baseline, which was run on the local capture.
process.env.RESEARCH_QV_SOURCE ??= "local";

const options = readOptions(process.argv.slice(2));
const codex = options.runtime === "codex-cli";
if (codex && process.env.RUN_CODEX_CLI_BENCHMARK !== "1")
  throw new Error(
    "Set RUN_CODEX_CLI_BENCHMARK=1 to confirm live runs on the ChatGPT plan. " +
      `The full set is ${RECORDED_BASELINE.scenarios} scenarios x 3 runs.`,
  );
if (!codex && process.env.RUN_CLAUDE_CLI_BENCHMARK !== "1")
  throw new Error(
    "Set RUN_CLAUDE_CLI_BENCHMARK=1 to confirm live runs on the Claude subscription. " +
      `The full set is ${RECORDED_BASELINE.scenarios} scenarios x 3 runs, around $${RECORDED_BASELINE.planUsdPerScenario} of plan usage each.`,
  );
const model = options.model ?? (codex ? DEFAULT_CODEX_CLI_MODEL : RECORDED_BASELINE_MODEL);
options.out ??= codex
  ? path.resolve(".data", "research-codex-cli", "benchmark.json")
  : path.resolve(".data", "research-claude-cli", "phase-1-benchmark.json");
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

const Runtime = codex ? CodexCliResearchRuntime : ClaudeCliResearchRuntime;
const runtime = new Runtime({
  maxConcurrentRuns: options.concurrency,
  model,
  // `--no-host-tools` is the recorded configuration exactly: no way to fetch a page. Without it
  // the agent can retain and quote web pages, which is a different recipe from the one the
  // 90 recorded runs used — so the exit test below becomes a regression check, not a port check.
  ...(options.hostTools ? {} : { hostTools: [] }),
});

const startedAt = Date.now();
process.stderr.write(
  `Running ${scopes.length} scenario(s) x 3 runs at concurrency ${options.concurrency}…\n`,
);

const { records: fresh, aborted } = await runBenchmark({
  runtime,
  scopes,
  budget,
  runs: options.runs ?? undefined,
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
  model,
  // A Codex run is a measurement against Opus's baseline; see the header.
  measurementOnly: codex,
  runsPerScenario: options.runs ?? 3,
  concurrency: options.concurrency,
  elapsedMs: Date.now() - startedAt,
  aborted,
  hostTools: options.hostTools,
  citations: sumCitations(records),
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
if (exitTest.applicable && !exitTest.passed && !codex) process.exitCode = 1;
// 2, not 1: "the run did not finish" and "the port is wrong" are different answers, and a
// caller that cannot tell them apart will read a quota wall as a failed port.
if (aborted) process.exitCode = 2;

/** Every run's citation check, added up. Null when no run reported one. */
function sumCitations(records) {
  const runs = records.flatMap((record) => record.runs ?? []).filter((run) => run.citations);
  if (!runs.length) return null;
  const total = {};
  for (const run of runs)
    for (const [key, value] of Object.entries(run.citations)) total[key] = (total[key] ?? 0) + value;
  return { runs: runs.length, ...total };
}

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
    report.measurementOnly
      ? `API-rate estimate    $${report.comparison.planUsd} ($${report.comparison.planUsdPerScenario}/scenario; the ChatGPT plan bills nothing per call)`
      : `plan usage           $${report.comparison.planUsd} ($${report.comparison.planUsdPerScenario}/scenario, recorded $${RECORDED_BASELINE.planUsdPerScenario})`,
  ];
  const c = report.citations;
  if (c)
    lines.push(
      `QV rows cited        ${c.rowsCited} (${c.rowsFound} found, ${c.rowsMissing} not in the capture, ${c.rowsUnpriced} unpriced)`,
      `web figures cited    ${c.webCited} (${c.webVerified} quote verified, ${c.webNotFetched} never fetched, ${c.webExcerptRejected} quote not on the page)`,
      `allowances           ${c.allowances ?? 0} (components priced from judgement, labelled as such)`,
    );
  if (report.runsPerScenario !== 3)
    lines.push(
      "",
      `${report.runsPerScenario} run(s) per scenario: a check of whether bands appear, not of agreement.`,
    );
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
  if (report.measurementOnly)
    lines.push(
      "",
      `${report.runtime} / ${report.model}: measured against the Opus baseline, not a pass/fail check.`,
    );
  lines.push("", report.exitTest.passed ? "EXIT TEST PASSED" : "EXIT TEST FAILED");
  for (const check of report.exitTest.checks)
    lines.push(
      `  ${check.passed ? "ok  " : "FAIL"} ${check.name}: ${check.actual} (expected ${check.expected})`,
    );
  if (!report.exitTest.passed && !report.measurementOnly)
    lines.push(
      "",
      report.hostTools
        ? "The counts moved. Host tools were on, so this recipe is not the recorded one: read it as a " +
            "regression against the baseline, rerun with --no-host-tools to check the port itself, and " +
            "do not tune the agreement thresholds to fit."
        : "The port is wrong. Do not proceed to phase 2, and do not tune the agreement thresholds to fit.",
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
    hostTools: true,
    runtime: "claude-cli",
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--no-host-tools") {
      options.hostTools = false;
      continue;
    }
    const [flag, inline] = argv[index].split("=");
    const value = inline ?? argv[++index];
    if (flag === "--scopes")
      options.scopes = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    else if (flag === "--limit") options.limit = Number(value);
    else if (flag === "--runs") {
      options.runs = Number(value);
      if (![1, 2, 3].includes(options.runs)) throw new Error("--runs must be 1, 2 or 3.");
    } else if (flag === "--concurrency") options.concurrency = Math.max(1, Number(value));
    else if (flag === "--model") options.model = value;
    else if (flag === "--runtime") {
      if (!["claude-cli", "codex-cli"].includes(value))
        throw new Error(`--runtime must be claude-cli or codex-cli, not ${value}.`);
      options.runtime = value;
    } else if (flag === "--max-usd") options.maxUsd = Number(value);
    else if (flag === "--merge") options.merge = path.resolve(value);
    else if (flag === "--out") options.out = path.resolve(value);
    else throw new Error(`Unknown option ${flag}.`);
  }
  return options;
}
