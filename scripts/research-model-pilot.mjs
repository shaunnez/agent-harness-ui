#!/usr/bin/env node
// Live-model research quality pilot (08-LIVE-MODEL-QUALITY-PILOT-PLAN.md).
//
//   npm run research:model-pilot
//       Dry run. Validates the frozen manifest, proves the local runtime, prints the exact
//       bounds a paid session would admit, and performs no DNS, provider or model call.
//
//   RUN_RESEARCH_MODEL_PILOT=1 RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED=1 npm run research:model-pilot
//       One guarded live session, still requiring a separately approved session allowance,
//       an explicit frozen model, an owner-only env file and a clean worktree.
//
// The live guard is the last point before the runner is imported, so a dry run cannot reach
// provider construction even by accident.

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { writeArtifact, writeJsonArtifact } from "./research-model-pilot/artifacts.mjs";
import { hashManifestText, parsePilotManifest, sessionBounds } from "./research-model-pilot/contracts.mjs";
import { LIVE_ENV_FILE, loadOwnerEnvFile } from "./research-model-pilot/preflight.mjs";

const LIVE_COMMAND =
  "RUN_RESEARCH_MODEL_PILOT=1 RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED=1 npm run research:model-pilot";

const manifestPath = fileURLToPath(new URL("./research-model-pilot/manifest.json", import.meta.url));
const manifestText = await readFile(manifestPath, "utf8");
const manifestHash = hashManifestText(manifestText);
const manifest = parsePilotManifest(JSON.parse(manifestText));
const live = process.env.RUN_RESEARCH_MODEL_PILOT === "1";

if (live && process.env.RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED !== "1")
  throw new Error(
    "A live pilot requires RESEARCH_PUBLIC_ONLY_ACKNOWLEDGED=1: objectives, queries, URLs and excerpts leave this machine.",
  );
if (live)
  process.stderr.write(
    `Reminder: execution authority must cover model calls and external provider calls. Reading ${LIVE_ENV_FILE}.\n`,
  );

// The owner-only file is read here, before the runner is imported, so a missing or
// world-readable file fails before any provider or model could be constructed.
const environment = live ? await loadOwnerEnvFile({ environment: process.env }) : process.env;

const { runModelPilotSession } = await import("./research-model-pilot/runner.mjs");
const session = await runModelPilotSession({
  manifest,
  manifestHash,
  manifestPath: path.relative(process.cwd(), manifestPath),
  environment,
  mode: live ? "live" : "dry-run",
});

if (!live) {
  const report = {
    version: 1,
    mode: "dry-run",
    generatedAt: new Date().toISOString(),
    sessionId: session.sessionId,
    manifest: { path: path.relative(process.cwd(), manifestPath), hash: manifestHash },
    model: session.preflight.model,
    runtime: session.preflight.runtime,
    git: session.preflight.git,
    bounds: sessionBounds(manifest),
    allowanceRequired: {
      firecrawlCredits: manifest.session.calculatedFirecrawlUpperBound,
      firecrawlSessionCeiling: manifest.session.firecrawlSessionCeiling,
      serperCalls: manifest.session.serperCallCeiling,
      modelCalls: manifest.session.maxModelCalls,
      modelDollars: "unknown — no reviewed rate card was supplied",
    },
    performed: { dnsLookups: 0, providerCalls: 0, modelCalls: 0, retries: 0 },
    liveCommand: LIVE_COMMAND,
  };
  await writeJsonArtifact(path.join(session.directory, "report.json"), report);
  await writeArtifact(path.join(session.directory, "report.md"), renderDryRun(report));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const { finalizeSession } = await import("./research-model-pilot/finalize.mjs");
const { report } = await finalizeSession({ manifest, session, environment });
process.stdout.write(
  `${JSON.stringify(
    {
      sessionStatus: report.sessionStatus,
      verdict: report.verdict,
      firstAttemptPasses: report.primaryMetric.firstAttemptPasses,
      review: report.review,
      artifactScan: { leakCount: report.artifactScan?.leakCount ?? null },
      directory: session.directory,
    },
    null,
    2,
  )}\n`,
);
// A bounded one-shot CLI: provider HTTP clients may hold idle handles after everything owned
// is closed, so exit deliberately once durable output is written.
process.exit(session.status === "completed" ? 0 : 1);

function renderDryRun(report) {
  return [
    `# Live-model research pilot — dry run ${report.sessionId}`,
    "",
    `- Manifest: ${report.manifest.hash}`,
    `- Commit: ${report.git?.commit ?? "unknown"}${report.git?.dirty ? " (dirty — a live session refuses this)" : ""}`,
    `- Node ${report.runtime?.nodeVersion} (ABI ${report.runtime?.moduleAbi}), native runtime ready: ${report.runtime?.ok}`,
    `- Model: ${report.model?.selectionPending ? `not selected — ${report.model.note}` : `${report.model.provider} ${report.model.model}, max output tokens ${report.model.maxOutputTokens}`}`,
    `- Model calls admitted: ${report.bounds.maxModelCalls}`,
    `- Firecrawl: ${report.allowanceRequired.firecrawlCredits} calculated credits against a ${report.allowanceRequired.firecrawlSessionCeiling}-credit session ceiling`,
    `- Serper: at most ${report.allowanceRequired.serperCalls} fallback call(s)`,
    `- Model dollars: ${report.allowanceRequired.modelDollars}`,
    `- Performed in this dry run: ${JSON.stringify(report.performed)}`,
    "",
    "## Per-case bounds",
    "",
    "| Case | Model calls | Searches | Unique captures | PDF page cap | Firecrawl upper bound |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.bounds.cases.map(
      (entry) =>
        `| ${entry.id} | ${entry.modelCalls} | ${entry.searches} | ${entry.uniqueCaptures} | ${entry.pdfPageCap} | ${entry.calculatedFirecrawlUpperBound} |`,
    ),
    "",
    "No retry is included. A failed paid session is final until a new authorization.",
    "",
    `Live command: \`${report.liveCommand}\``,
    "",
  ].join("\n");
}
