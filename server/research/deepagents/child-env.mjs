// The Deep Agents child's environment allowlist. No `deepagents`/`langchain`/`langsmith`
// import here — this is adapter-owned policy, built up from an allowlist rather than deleted
// down from `process.env`, the same discipline `buildClaudeEnvironment` uses and for the same
// reason: the guarantee has to be structural, not a reviewed subtraction.

import os from "node:os";
import process from "node:process";

const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "HOME",
  "USER",
  "LOGNAME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

/** Variables that must never reach the child even if a future allowlist edit reintroduces
 *  them. LangSmith activates purely on environment variables, so keeping these out is the
 *  entire enforcement mechanism behind "LangSmith stays inactive" (architecture §12). */
export const CHILD_ENV_DENYLIST = Object.freeze([
  "LANGSMITH_API_KEY",
  "LANGSMITH_TRACING",
  "LANGSMITH_ENDPOINT",
  "LANGSMITH_PROJECT",
  "LANGCHAIN_API_KEY",
  "LANGCHAIN_TRACING_V2",
  "LANGCHAIN_ENDPOINT",
  "LANGCHAIN_PROJECT",
  "LANGCHAIN_TRACING",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "FIRECRAWL_API_KEY",
  "SERPER_API_KEY",
  "TAVILY_API_KEY",
  "RESEARCH_SEARCH_API_KEY",
]);

const FALLBACK_PATH = process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/local/bin:/usr/bin:/bin";

/**
 * Build the child environment: the allowlist above, plus the one model credential the
 * adapter resolved for this run under a fixed variable name, and nothing else. Note that
 * `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are denylisted even though the model credential may
 * itself be an Anthropic or OpenAI key — it reaches the child only as `RESEARCH_MODEL_API_KEY`
 * (see `model-config.mjs`), never under the provider's own conventional variable name, so nothing
 * in the child can accidentally pick up a *different* stray provider credential from the
 * companion's own environment.
 */
export function buildChildEnvironment(source, { modelApiKeyEnvVar, modelApiKey, tempDirectory } = {}) {
  const entries = Object.entries(source ?? {});
  const environment = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    const entry = entries.find(([key]) => key.toUpperCase() === name);
    if (entry?.[1] != null && entry[1] !== "") environment[entry[0]] = entry[1];
  }
  if (!environment.PATH) environment.PATH = FALLBACK_PATH;
  if (!environment.HOME && !environment.USERPROFILE) environment.HOME = os.homedir();
  if (tempDirectory) {
    environment.TEMP = tempDirectory;
    environment.TMP = tempDirectory;
    environment.TMPDIR = tempDirectory;
  }
  for (const name of CHILD_ENV_DENYLIST) delete environment[name];
  if (modelApiKeyEnvVar && modelApiKey) environment[modelApiKeyEnvVar] = modelApiKey;
  // Re-applied after the injection above, not just before it: `apiKeyEnvVar` is always the
  // fixed `RESEARCH_MODEL_API_KEY` constant in practice (`model-config.mjs`), but this keeps
  // the denylist an actual guarantee rather than a guarantee-shaped ordering dependency.
  for (const name of CHILD_ENV_DENYLIST) delete environment[name];
  return environment;
}
