#!/usr/bin/env node
// WP5 (docs/model-evaluation-plan.md section 5): renders a campaign's `report.md`/`report.json`
// from `manifest.json` (WP3), `judge/*.json` (WP4, optional — not required to run this), and
// `variant-map.json`, cross-checked against the live `GET /api/evaluations/summary`.
//
//   node scripts/report-eval-campaign.mjs --campaign <id> --baseline <variantId>
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { createHarnessClient } from "../evals/lib/harness-client.mjs";
import { buildReport, loadCampaignArtifacts } from "../evals/lib/report.mjs";

function parseArgs(argv) {
  const args = {
    dataRoot: path.join(".data", "evaluations"),
    api: "http://127.0.0.1:4310",
    skipLiveSummary: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--campaign":
        args.campaign = value;
        index += 1;
        break;
      case "--baseline":
        args.baseline = value;
        index += 1;
        break;
      case "--data-root":
        args.dataRoot = value;
        index += 1;
        break;
      case "--api":
        args.api = value;
        index += 1;
        break;
      case "--skip-live-summary":
        args.skipLiveSummary = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.campaign) throw new Error("--campaign is required.");
  if (!args.baseline) throw new Error("--baseline is required (the variantId the campaign's variants file named as its baselineId).");
  return args;
}

/** The live summary enriches blind scores already posted via the API; a report must still render
 * from `manifest.json`/`judge/*.json` alone when the companion is not running. */
async function fetchEvaluationSummary(api) {
  try {
    const client = createHarnessClient({ baseUrl: api });
    await client.connect();
    return await client.evaluationSummary();
  } catch (error) {
    process.stderr.write(
      `Warning: could not read ${api}/api/evaluations/summary (${error.message}); continuing with judge/*.json only.\n`,
    );
    return null;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const campaignDir = path.join(args.dataRoot, args.campaign);
  const { manifest, variantMap, judgeByLabel } = await loadCampaignArtifacts(campaignDir);
  const evaluationSummary = args.skipLiveSummary ? null : await fetchEvaluationSummary(args.api);

  const { json, markdown } = buildReport({
    manifest,
    judgeByLabel,
    variantMap,
    evaluationSummary,
    baselineId: args.baseline,
  });

  const reportMdPath = path.join(campaignDir, "report.md");
  const reportJsonPath = path.join(campaignDir, "report.json");
  await writeFile(reportMdPath, markdown, "utf8");
  await writeFile(reportJsonPath, JSON.stringify(json, null, 2), "utf8");
  process.stdout.write(
    `Report written: ${reportMdPath}\n` +
      `Reached awaiting-human-approval: ${json.completion.reachedApproval} / ${json.completion.total}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
