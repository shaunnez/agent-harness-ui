#!/usr/bin/env node
// Offline final scoring: `npm run research:model-pilot:score -- <session-directory>`.
//
// Reads a completed session's own artifacts and the human review packet, applies the hidden
// oracle, and rewrites the report. It constructs no provider and no model, so scoring — or
// rescoring after the review is finished — can never spend anything.

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { hashManifestText, parsePilotManifest } from "./research-model-pilot/contracts.mjs";
import {
  assertManifestLineage,
  finalizeSession,
  loadSessionFromDirectory,
} from "./research-model-pilot/finalize.mjs";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: npm run research:model-pilot:score -- <session-directory>");

const manifestPath = fileURLToPath(new URL("./research-model-pilot/manifest.json", import.meta.url));
const manifestText = await readFile(manifestPath, "utf8");
const manifestHash = hashManifestText(manifestText);
const manifest = parsePilotManifest(JSON.parse(manifestText));

const session = await loadSessionFromDirectory(path.resolve(directory));
assertManifestLineage(session, manifestHash);

const { report } = await finalizeSession({ manifest, session, environment: process.env });
process.stdout.write(
  `${JSON.stringify(
    {
      sessionId: report.sessionId,
      sessionStatus: report.sessionStatus,
      verdict: report.verdict,
      primaryMetric: report.primaryMetric,
      review: report.review,
      cases: report.cases.map((entry) => ({
        caseId: entry.caseId,
        taskPassed: entry.taskPassed,
        failed: entry.failed,
        pending: entry.pending,
      })),
    },
    null,
    2,
  )}\n`,
);
process.exit(report.verdict === "passed" ? 0 : report.verdict === "pending_human_review" ? 2 : 1);
