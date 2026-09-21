// Turning a session into reviewable artifacts, and reading those artifacts back offline
// (plan §Q4, §Q5). Nothing here constructs a provider or a model: scoring after a session is
// an offline activity, and a second scoring pass must never be able to spend anything.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { writeArtifact, writeJsonArtifact } from "./artifacts.mjs";
import { buildReviewPacket, renderReviewMarkdown, withReviewRevision } from "./review.mjs";
import { renderReportMarkdown, scoreSession } from "./score.mjs";
import { scanArtifactsForSecrets, scannedNeedles } from "./secret-scan.mjs";

/** A session is scored against the manifest revision it ran on. An oracle is never adjusted
 *  after a paid result, so a changed manifest must fail rather than rescore the old evidence. */
export function assertManifestLineage(session, manifestHash) {
  const recorded = session?.preflight?.manifest?.hash ?? null;
  if (recorded && recorded !== manifestHash) {
    const error = new Error(
      `This session ran against manifest ${recorded} but the working tree holds ${manifestHash}. Score the session against its own manifest revision.`,
    );
    error.code = "pilot_manifest_lineage_mismatch";
    throw error;
  }
  return recorded;
}

export async function finalizeSession({ manifest, session, environment = process.env, review = null }) {
  const directory = session.directory;
  const snapshotDirectory = path.join(directory, "sources");
  const existing = review ?? (await readJsonIfPresent(path.join(directory, "review.json")));
  const packet = existing ?? (await buildReviewPacket({ manifest, session, snapshotDirectory }));
  const stored = existing ? withReviewRevision(existing, packet) : packet;
  await writeJsonArtifact(path.join(directory, "review.json"), stored);
  await writeArtifact(path.join(directory, "review.md"), renderReviewMarkdown(stored));

  const artifactScan = await scanArtifactsForSecrets(directory, scannedNeedles(environment));
  await writeJsonArtifact(path.join(directory, "artifact-scan.json"), artifactScan);

  const report = scoreSession({ manifest, session, review: stored, artifactScan });
  await writeJsonArtifact(path.join(directory, "report.json"), report);
  await writeArtifact(path.join(directory, "report.md"), renderReportMarkdown(report));
  return { report, review: stored, artifactScan };
}

/** Reconstruct a completed session from its own artifacts, for offline scoring. */
export async function loadSessionFromDirectory(directory) {
  const preflight = await readJson(path.join(directory, "preflight.json"));
  const caseRoot = path.join(directory, "cases");
  const ids = (await readdir(caseRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const cases = [];
  for (const id of ids.sort()) {
    const result = await readJson(path.join(caseRoot, id, "result.json"));
    const accounting = await readJson(path.join(caseRoot, id, "accounting.json"));
    cases.push({
      id,
      runId: result.runId,
      status: result.status,
      error: result.error ?? null,
      result: {
        summary: result.summary ?? null,
        findings: result.findings ?? [],
        unresolvedQuestions: result.unresolvedQuestions ?? [],
      },
      sources: result.sources ?? [],
      verification: result.verification ?? [],
      accounting,
      capturesUsed: accounting.capturesUsed ?? (result.sources ?? []).length,
      allowedCaptures: accounting.allowedCaptures ?? null,
    });
  }
  const previous = await readJsonIfPresent(path.join(directory, "report.json"));
  return {
    mode: preflight.mode,
    sessionId: preflight.manifest ? path.basename(directory) : path.basename(directory),
    directory,
    preflight,
    status: previous?.sessionStatus ?? (cases.length ? "completed" : "unknown"),
    stopped: previous?.stopped ?? null,
    cases,
    ledgers: previous?.ledgers ?? null,
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonIfPresent(file) {
  try {
    return await readJson(file);
  } catch {
    return null;
  }
}
