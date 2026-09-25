// Phase 2: the four-role sequence over the same 30 pinned scopes, scored against phase 1.
//
//   RESEARCH_QV_INDEX=/path/to/indexed-items.jsonl RUN_CLAUDE_CLI_BENCHMARK=1 \
//   node scripts/research-claude-cli-roles-benchmark.mjs --phase1 .data/research-claude-cli/phase-1-benchmark.json
//
// Four metrics, all read off the runs and none of them judged by a model:
//
//   scenarios with a band          phase 1 baseline: 28 of 30
//   three-run agreement            phase 1 baseline: 18 tight
//   plan usage per scenario        phase 1 baseline: $4.97
//   verifier challenges            no baseline — this is the actual question
//
// Whichever wins on the same 30 is what ships. If four roles do not beat one agent, ship one
// agent and record that they did not: a negative result is worth the day, an unmeasured
// assumption carried into phase 3 is not.
//
// Nothing here scores prose, and nothing here asks a model whether the output got better.
// `#101` merged a fix for exactly that failure in the SDLC scorecard — gate pass rate rewarded
// a laxer reviewer, because the gates were themselves model runs.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ClaudeCliRolesResearchRuntime } from "../server/research/claude-cli/roles-runtime.mjs";
import { RECORDED_BASELINE_MODEL } from "../server/research/claude-cli/runtime.mjs";
import { resolveResearchBudget } from "../src/research-budget-policy.ts";
import {
  compareWithBaseline,
  evaluateExitTest,
  loadPinnedScopes,
  RECORDED_BASELINE,
  runBenchmark,
} from "./research-claude-cli/benchmark.mjs";
import { comparePhases } from "./research-claude-cli/phase-comparison.mjs";

// Measured against the recorded baseline, which was run on the local capture.
process.env.RESEARCH_QV_SOURCE ??= "local";

if (process.env.RUN_CLAUDE_CLI_BENCHMARK !== "1")
  throw new Error(
    "Set RUN_CLAUDE_CLI_BENCHMARK=1 to confirm live runs on the Claude subscription. " +
      "Four calls per run means this costs more per scenario than phase 1, not less.",
  );

const options = readOptions(process.argv.slice(2));
const scopes = (await loadPinnedScopes({ only: options.scopes })).slice(0, options.limit ?? undefined);
if (!scopes.length) throw new Error("No pinned scopes matched the selection.");

const budget = resolveResearchBudget("standard", {
  // Four sequential calls need more wall clock than one, and the runtime divides this across
  // the roles. Too tight a total starves the verifier, which is the role the experiment is
  // about, so a short budget would bias the answer against the thing being measured.
  maxRuntimeMs: 40 * 60_000,
  ...(options.maxUsd ? { maxUsd: options.maxUsd } : {}),
});

const runtime = new ClaudeCliRolesResearchRuntime({
  maxConcurrentRuns: options.concurrency,
  model: options.model ?? RECORDED_BASELINE_MODEL,
});

const verifierByScenario = new Map();
const startedAt = Date.now();
process.stderr.write(
  `Running ${scopes.length} scenario(s) x 3 four-role runs at concurrency ${options.concurrency}…\n`,
);

const { records, aborted } = await runBenchmark({
  runtime,
  scopes,
  budget,
  onProgress: ({ index, total, record }) => {
    const effects = record.runs
      .filter((run) => run.status === "completed")
      .map((run) => runtime.verifierEffect(run.runId));
    verifierByScenario.set(record.scenarioId, effects);
    const challenged = effects.reduce((count, effect) => count + effect.challenged, 0);
    const removed = effects.reduce((count, effect) => count + effect.netComponentsRemoved, 0);
    process.stderr.write(
      `[${index}/${total}] ${record.scenarioId}: ${record.status} ` +
        `(${record.agreement.runsWithBand}/${record.agreement.runsTotal} banded, ` +
        `verifier challenged ${challenged}, removed ${removed}, ` +
        `$${(record.costUsd ?? 0).toFixed(2)}, ${Math.round(record.elapsedMs / 1000)}s)\n`,
    );
  },
});

if (aborted) process.stderr.write(`\nABORTED after ${aborted.scenario}: ${aborted.message}\n`);

const comparison = await compareWithBaseline(records);
const exitTest = evaluateExitTest(comparison, { scenariosRun: records.length });
const phase1 = options.phase1 ? JSON.parse(await readFile(options.phase1, "utf8")) : null;
const verdict = comparePhases({
  phase1: phase1?.comparison ?? null,
  phase2: comparison,
  verifier: summariseVerifier(verifierByScenario),
  scenariosRun: records.length,
  requiredScenarios: RECORDED_BASELINE.scenarios,
});

const report = {
  generatedAt: new Date().toISOString(),
  runtime: runtime.id,
  roles: ["planner", "researcher", "verifier", "synthesiser"],
  concurrency: options.concurrency,
  elapsedMs: Date.now() - startedAt,
  aborted,
  comparison,
  exitTest,
  verifier: summariseVerifier(verifierByScenario),
  verifierByScenario: Object.fromEntries(verifierByScenario),
  phase1Source: options.phase1 ?? null,
  verdict,
  records,
};
await mkdir(path.dirname(options.out), { recursive: true });
await writeFile(options.out, `${JSON.stringify(report, null, 1)}\n`, "utf8");

process.stdout.write(`${renderSummary(report)}\n`);
process.stderr.write(`Report written to ${options.out}\n`);
// The plan window, not the structure under test. Distinct from any verdict this run could form.
if (aborted) process.exitCode = 2;

function summariseVerifier(byScenario) {
  const effects = [...byScenario.values()].flat();
  const total = (pick) => effects.reduce((count, effect) => count + pick(effect), 0);
  return {
    runs: effects.length,
    supported: total((effect) => effect.checks.supported),
    weakened: total((effect) => effect.checks.weakened),
    rejected: total((effect) => effect.checks.rejected),
    challenged: total((effect) => effect.challenged),
    netComponentsRemoved: total((effect) => effect.netComponentsRemoved),
    missingByName: total((effect) => effect.missingByName),
    // Runs where the verifier changed nothing at all. A high number here is the honest answer
    // that the extra call bought nothing on those scenarios.
    runsWithNoChallenge: effects.filter((effect) => effect.challenged === 0).length,
  };
}

function renderSummary(report) {
  const { counts } = report.comparison;
  const lines = [
    "PHASE 2 — four roles, four sequential CLI calls",
    `scenarios            ${counts.scenarios}`,
    `with a cost band     ${counts.withBand}  (phase 1 recorded baseline ${RECORDED_BASELINE.withBand} of ${RECORDED_BASELINE.scenarios})`,
    `three-run agreement  ${counts.agreed}  (phase 1 recorded baseline ${RECORDED_BASELINE.agreed})`,
    `plan usage           $${report.comparison.planUsd} ($${report.comparison.planUsdPerScenario}/scenario, phase 1 recorded $${RECORDED_BASELINE.planUsdPerScenario})`,
    "",
    "verifier — the question phase 2 exists to answer",
    `  checks             ${report.verifier.supported} supported, ${report.verifier.weakened} weakened, ${report.verifier.rejected} rejected`,
    `  challenged         ${report.verifier.challenged} across ${report.verifier.runs} runs`,
    `  components removed ${report.verifier.netComponentsRemoved} (${report.verifier.missingByName} missing by name, the rest relabelled)`,
    `  runs it changed nothing on  ${report.verifier.runsWithNoChallenge} of ${report.verifier.runs}`,
  ];
  if (report.aborted)
    lines.push(
      "",
      `RUN ABORTED at ${report.aborted.scenario}: ${report.aborted.message}`,
      `  ${report.aborted.remaining.length} scenario(s) never ran: ${report.aborted.remaining.join(", ") || "none"}`,
    );
  if (report.verdict?.applicable === false) {
    lines.push("", `NO VERDICT: ${report.verdict.reason}`);
  } else if (report.verdict) {
    lines.push("", `VERDICT: ${report.verdict.winner}`, ...report.verdict.reasons.map((line) => `  ${line}`));
    if (report.verdict.winner === "one agent")
      lines.push(
        "",
        "Ship one agent, and write down that four roles did not beat it. That is a result, not a setback.",
      );
  } else {
    lines.push("", "No phase 1 report given (--phase1), so no head-to-head verdict was formed.");
  }
  return lines.join("\n");
}

function readOptions(argv) {
  const options = {
    scopes: null,
    limit: null,
    concurrency: 3,
    model: null,
    maxUsd: null,
    phase1: null,
    out: path.resolve(".data", "research-claude-cli", "phase-2-benchmark.json"),
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
    else if (flag === "--phase1") options.phase1 = path.resolve(value);
    else if (flag === "--out") options.out = path.resolve(value);
    else throw new Error(`Unknown option ${flag}.`);
  }
  return options;
}
