// Keep credentials out of what a research run writes down.
//
// Carried over from the retired live-model pilot, whose guardrails were the part of it worth
// keeping. The CLI child is started from an environment allowlist, so no key should ever reach
// a transcript. This checks that it did not: after each run the transcript is searched for the
// value of every credential the host process holds, and any occurrence is redacted in place.
// The value itself is never printed — only which variable matched and how often.

import { readFile, writeFile } from "node:fs/promises";

/** Credential-bearing variables whose values must never appear in a run artifact. */
export const SCANNED_CREDENTIAL_VARS = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "FIRECRAWL_API_KEY",
  "SERPER_API_KEY",
  "TAVILY_API_KEY",
  "RESEARCH_SEARCH_API_KEY",
  // The API-loop runtime's provider and search keys (`../api-loop/providers.mjs`).
  "OPENCODE_API_KEY",
  "BASETEN_API_KEY",
  "PARALLEL_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
]);

/** Values shorter than this are too likely to occur by chance to be worth matching. */
const MIN_SECRET_LENGTH = 8;

export function scannedNeedles(environment = process.env) {
  const needles = [];
  for (const name of SCANNED_CREDENTIAL_VARS) {
    const value = environment[name];
    if (typeof value === "string" && value.length >= MIN_SECRET_LENGTH) needles.push({ label: name, value });
  }
  return needles;
}

/**
 * Redact every needle from `file`. Returns `[{ label, occurrences }]`, empty when the file was
 * clean, and leaves a clean file untouched.
 */
export async function redactSecretsInFile(file, needles) {
  if (!needles.length) return [];
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const found = [];
  for (const needle of needles) {
    const occurrences = contents.split(needle.value).length - 1;
    if (!occurrences) continue;
    found.push({ label: needle.label, occurrences });
    contents = contents.split(needle.value).join(`[redacted:${needle.label}]`);
  }
  if (found.length) await writeFile(file, contents, { encoding: "utf8", mode: 0o600 });
  return found;
}
