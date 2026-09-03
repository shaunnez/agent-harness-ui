#!/usr/bin/env node
// WP4 (docs/model-evaluation-plan.md section 5): scores every candidate a campaign (WP3)
// exported with a fixed, strong judge model that never sees which variant produced it.
//
//   node scripts/judge-eval-campaign.mjs --campaign <id>
//
// Run after `scripts/run-eval-suite.mjs` has produced `.data/evaluations/<campaignId>/manifest.json`.
// The comparison report (WP5) is a separate, later script.
import path from "node:path";
import { createHarnessClient } from "../evals/lib/harness-client.mjs";
import { DEFAULT_JUDGE_MODEL, DEFAULT_JUDGE_REASONING, runJudgeCampaign } from "../evals/lib/judge.mjs";
import { loadSuite } from "../evals/lib/suite.mjs";

function parseArgs(argv) {
  const args = {
    api: "http://127.0.0.1:4310",
    dataRoot: path.join(".data", "evaluations"),
    worktreeRoot: path.join(".data", "evaluations", "worktrees"),
    judgeModel: DEFAULT_JUDGE_MODEL,
    judgeReasoning: DEFAULT_JUDGE_REASONING,
    onlyLabels: null,
    timeoutMs: 600_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--campaign":
        args.campaign = value;
        index += 1;
        break;
      case "--suite":
        args.suite = value;
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
      case "--data-root":
        args.dataRoot = value;
        index += 1;
        break;
      case "--worktree-root":
        args.worktreeRoot = value;
        index += 1;
        break;
      case "--api":
        args.api = value;
        index += 1;
        break;
      case "--only-labels":
        args.onlyLabels = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        index += 1;
        break;
      case "--timeout-ms":
        args.timeoutMs = Number(value);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.campaign) throw new Error("--campaign is required.");
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const suite = args.suite ? await loadSuite(args.suite) : null;

  const client = createHarnessClient({ baseUrl: args.api });
  await client.connect();

  const { manifestPath, results } = await runJudgeCampaign({
    dataRoot: args.dataRoot,
    campaignId: args.campaign,
    client,
    judgeModel: args.judgeModel,
    judgeReasoning: args.judgeReasoning,
    suite,
    worktreeRoot: args.worktreeRoot,
    onlyLabels: args.onlyLabels,
    timeoutMs: args.timeoutMs,
  });

  const valid = results.filter((result) => result.judgeStatus === "valid").length;
  const invalid = results.filter((result) => result.judgeStatus === "invalid").length;
  const noPatch = results.filter((result) => result.judgeStatus === "no-patch").length;
  process.stdout.write(
    `Campaign ${args.campaign}: ${results.length} bundle(s) considered, ${valid} scored, ${invalid} invalid, ${noPatch} without a patch.\n` +
      `Manifest: ${manifestPath}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
