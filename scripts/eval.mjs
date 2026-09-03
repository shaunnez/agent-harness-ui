#!/usr/bin/env node
// WP6 (docs/model-evaluation-plan.md section 5): the single entry point for a model-evaluation
// campaign. Chains the runner (WP3, scripts/run-eval-suite.mjs), the blind judge (WP4,
// scripts/judge-eval-campaign.mjs), and the report (WP5, scripts/report-eval-campaign.mjs) into
// one command, all against the same campaign id, and prints the path to the finished report.
//
//   node scripts/eval.mjs --suite evals/suites/core.json --variants evals/variants/role-sweep.json
//
// Each stage remains runnable alone via its own script, exactly as before this package: this
// file only decides the campaign id up front (so it can thread the same one through all three
// stages) and forwards the rest of its flags to each stage's own argument parser.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { main as judgeCampaignMain } from "./judge-eval-campaign.mjs";
import { main as reportCampaignMain } from "./report-eval-campaign.mjs";
import { main as runSuiteMain } from "./run-eval-suite.mjs";

const DATA_ROOT = path.join(".data", "evaluations");

function parseArgs(argv) {
  const args = {
    api: "http://127.0.0.1:4310",
    worktreeRoot: path.join(".data", "evaluations", "worktrees"),
    concurrency: "1",
    timeoutMinutes: "90",
    onlyCases: null,
    onlyVariants: null,
    resume: null,
    judgeModel: null,
    judgeReasoning: null,
    skipJudge: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--suite":
        args.suite = value;
        index += 1;
        break;
      case "--variants":
        args.variants = value;
        index += 1;
        break;
      case "--only-cases":
        args.onlyCases = value;
        index += 1;
        break;
      case "--only-variants":
        args.onlyVariants = value;
        index += 1;
        break;
      case "--concurrency":
        args.concurrency = value;
        index += 1;
        break;
      case "--api":
        args.api = value;
        index += 1;
        break;
      case "--worktree-root":
        args.worktreeRoot = value;
        index += 1;
        break;
      case "--timeout-minutes":
        args.timeoutMinutes = value;
        index += 1;
        break;
      case "--resume":
        args.resume = value;
        index += 1;
        break;
      case "--judge-model":
        args.judgeModel = value;
        index += 1;
        break;
      case "--judge-reasoning":
        args.judgeReasoning = value;
        index += 1;
        break;
      case "--skip-judge":
        args.skipJudge = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.suite) throw new Error("--suite is required.");
  if (!args.variants) throw new Error("--variants is required.");
  return args;
}

/** Mirrors `scripts/run-eval-suite.mjs`'s own `newCampaignId`: this script must decide the
 * campaign id itself (instead of letting the runner invent one, as it does when run alone) so
 * the exact same id can be threaded through the judge and report steps that follow it. */
function newCampaignId(suiteId) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${suiteId}-${timestamp}`;
}

async function readJsonField(filePath, field) {
  const absolutePath = path.resolve(filePath);
  let raw;
  try {
    raw = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read/parse ${absolutePath}: ${error.message}`);
  }
  const value = raw?.[field];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${absolutePath} has no "${field}" string field.`);
  return value;
}

function buildSuiteArgv(args, campaignId) {
  const argv = [
    "--suite",
    args.suite,
    "--variants",
    args.variants,
    "--resume",
    campaignId,
    "--api",
    args.api,
    "--worktree-root",
    args.worktreeRoot,
    "--concurrency",
    String(args.concurrency),
    "--timeout-minutes",
    String(args.timeoutMinutes),
  ];
  if (args.onlyCases) argv.push("--only-cases", args.onlyCases);
  if (args.onlyVariants) argv.push("--only-variants", args.onlyVariants);
  return argv;
}

function buildJudgeArgv(args, campaignId) {
  const argv = [
    "--campaign",
    campaignId,
    "--suite",
    args.suite,
    "--api",
    args.api,
    "--worktree-root",
    args.worktreeRoot,
  ];
  if (args.judgeModel) argv.push("--judge-model", args.judgeModel);
  if (args.judgeReasoning) argv.push("--judge-reasoning", args.judgeReasoning);
  return argv;
}

function buildReportArgv(args, campaignId, baselineId) {
  return ["--campaign", campaignId, "--baseline", baselineId, "--api", args.api];
}

/**
 * Runs WP3 then, unless `--skip-judge` is set, WP4, then always WP5, against one campaign id.
 * `runSuite`/`runJudge`/`runReport` default to the real scripts' own `main` but are injectable so
 * tests can exercise the sequencing and argument-forwarding here without a live companion, git,
 * or model in the loop — each stage's own logic already has its own tests.
 */
export async function main(
  argv = process.argv.slice(2),
  { runSuite = runSuiteMain, runJudge = judgeCampaignMain, runReport = reportCampaignMain } = {},
) {
  const args = parseArgs(argv);
  const [suiteId, baselineId] = await Promise.all([
    readJsonField(args.suite, "suiteId"),
    readJsonField(args.variants, "baselineId"),
  ]);
  const campaignId = args.resume ?? newCampaignId(suiteId);

  await runSuite(buildSuiteArgv(args, campaignId));

  if (args.skipJudge) {
    process.stdout.write("Skipping blind judge (--skip-judge).\n");
  } else {
    await runJudge(buildJudgeArgv(args, campaignId));
  }

  await runReport(buildReportArgv(args, campaignId, baselineId));

  const reportPath = path.join(DATA_ROOT, campaignId, "report.md");
  process.stdout.write(`Campaign ${campaignId} complete. Report: ${reportPath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
