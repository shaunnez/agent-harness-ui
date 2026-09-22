// Artifact secret scan (plan §8). Reports counts and artifact names only: the searched values
// are never printed, and neither is any surrounding text that matched.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Credential-bearing variables whose in-memory values must not appear in any artifact. */
export const SCANNED_CREDENTIAL_VARS = Object.freeze([
  "RESEARCH_MODEL_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "FIRECRAWL_API_KEY",
  "SERPER_API_KEY",
  "TAVILY_API_KEY",
  "RESEARCH_SEARCH_API_KEY",
  "LANGSMITH_API_KEY",
  "LANGCHAIN_API_KEY",
]);

/** Values deterministic tests inject. A real artifact must never contain one either. */
export const SYNTHETIC_SENTINELS = Object.freeze([
  "firecrawl-sentinel",
  "serper-sentinel",
  "tavily-sentinel",
  "search-sentinel",
  "trace-sentinel",
  "model-sentinel",
]);

export function scannedNeedles(environment = process.env, extraSentinels = []) {
  const needles = [];
  for (const name of SCANNED_CREDENTIAL_VARS) {
    const value = environment[name];
    if (typeof value === "string" && value.length >= 8) needles.push({ label: name, value });
  }
  for (const sentinel of [...SYNTHETIC_SENTINELS, ...extraSentinels])
    needles.push({ label: "synthetic-sentinel", value: sentinel });
  return needles;
}

export async function scanArtifactsForSecrets(directory, needles) {
  const files = await listFiles(directory);
  const findings = [];
  let scannedBytes = 0;
  for (const file of files) {
    let contents;
    try {
      contents = await readFile(file, "utf8");
    } catch {
      continue;
    }
    scannedBytes += Buffer.byteLength(contents);
    for (const needle of needles) {
      if (!needle.value || !contents.includes(needle.value)) continue;
      const relative = path.relative(directory, file);
      const existing = findings.find((entry) => entry.artifact === relative && entry.label === needle.label);
      if (existing) existing.occurrences += 1;
      else findings.push({ artifact: relative, label: needle.label, occurrences: 1 });
    }
  }
  return {
    scannedFiles: files.length,
    scannedBytes,
    needleCount: needles.length,
    leakCount: findings.reduce((sum, entry) => sum + entry.occurrences, 0),
    findings,
  };
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile() && (await stat(full)).size <= 16 * 1_048_576) files.push(full);
  }
  return files.sort();
}
