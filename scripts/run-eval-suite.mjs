#!/usr/bin/env node
// WP3 (docs/model-evaluation-plan.md section 5): runs a fixed set of task briefs through the
// whole harness, end to end, under several model configurations.
//
//   node scripts/run-eval-suite.mjs --suite evals/suites/core.json --variants evals/variants/role-sweep.json
//
// This step only drives runs to a stop point (awaiting-human-approval, blocked, failed,
// cancelled, or timeout) and records `manifest.json`/`variant-map.json`/`bundle/`. Blind judging
// (WP4) and the comparison report (WP5) are separate, later scripts.
import path from "node:path";
import { createHarnessClient } from "../evals/lib/harness-client.mjs";
import { runEvalCampaign } from "../evals/lib/campaign.mjs";
import { loadSuite } from "../evals/lib/suite.mjs";
import { loadVariants } from "../evals/lib/variants.mjs";
import { readExecutionProviderCatalog } from "../server/model-catalog.mjs";

function parseArgs(argv) {
  const args = {
    api: "http://127.0.0.1:4310",
    worktreeRoot: path.join(".data", "evaluations", "worktrees"),
    concurrency: 1,
    timeoutMinutes: 90,
    onlyCases: null,
    onlyVariants: null,
    resume: null,
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
        args.onlyCases = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        index += 1;
        break;
      case "--only-variants":
        args.onlyVariants = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        index += 1;
        break;
      case "--concurrency":
        args.concurrency = Number(value);
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
        args.timeoutMinutes = Number(value);
        index += 1;
        break;
      case "--resume":
        args.resume = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.suite) throw new Error("--suite is required.");
  if (!args.variants) throw new Error("--variants is required.");
  return args;
}

function newCampaignId(suiteId) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return `${suiteId}-${timestamp}`;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const suite = await loadSuite(args.suite);

  const client = createHarnessClient({ baseUrl: args.api });
  await client.connect();
  const settings = await client.settings();
  const catalog = await readExecutionProviderCatalog();
  const variants = await loadVariants(args.variants, { catalog, allowedModels: settings.allowedModels });

  const campaignId = args.resume ?? newCampaignId(suite.suiteId);
  const { manifest, manifestPath } = await runEvalCampaign({
    suite,
    variants,
    campaignId,
    client,
    worktreeRoot: args.worktreeRoot,
    onlyCases: args.onlyCases,
    onlyVariants: args.onlyVariants,
    concurrency: args.concurrency,
    timeoutMinutes: args.timeoutMinutes,
  });

  const completed = manifest.runs.length;
  const reachedApproval = manifest.runs.filter(
    (run) => run.terminalState === "awaiting-human-approval",
  ).length;
  process.stdout.write(
    `Campaign ${campaignId}: ${completed} run(s) recorded, ${reachedApproval} reached awaiting-human-approval.\n` +
      `Manifest: ${manifestPath}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
