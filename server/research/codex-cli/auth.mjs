// The ChatGPT gate. A research run on this runtime executes only against the operator's own
// ChatGPT plan, never against metered OpenAI API billing. `AGENTS.md`: never request, read,
// store or pass an OpenAI API key for this path.
//
// Two mechanisms, as on the Claude side, and deliberately different in kind:
//
//  1. `assertChatGptAuth` refuses to start unless `codex login status` says it is logged in
//     using ChatGPT. A positive assertion: the absence of an API key is not evidence of a plan,
//     and `codex login status` reports an API-key login as a login.
//  2. `buildCodexEnvironment` (reused from `../../codex-runtime.mjs`) builds the child's
//     environment up from an allowlist, so `OPENAI_API_KEY` and `CODEX_API_KEY` cannot reach
//     it. The key file itself is never opened here: the probe asks the CLI, and the CLI answers
//     with a sentence rather than a secret.

import { locateCodex } from "../../codex-runtime.mjs";
import { runProcess } from "../../process-runtime.mjs";

export const REQUIRED_CODEX_AUTH = "ChatGPT";

const AUTH_PROBE_TIMEOUT_MS = 10_000;

/** Read `codex login status`. Never throws: output it cannot read is "not on ChatGPT", which
 *  is the answer that refuses a run. Only the method is kept — an API-key login prints a
 *  masked key, and nothing from that line is worth carrying into an error message. */
export function readCodexAuth(stdout, stderr = "") {
  const text = `${stdout ?? ""}\n${stderr ?? ""}`;
  const match = text.match(/^\s*Logged in using (?:an? )?(ChatGPT|API key)\b/im);
  return {
    loggedIn: Boolean(match),
    authMethod: match ? (/chatgpt/i.test(match[1]) ? REQUIRED_CODEX_AUTH : "apiKey") : null,
  };
}

export function isChatGptAuth(probe) {
  return probe.loggedIn === true && probe.authMethod === REQUIRED_CODEX_AUTH;
}

export function chatGptAuthFailureMessage(probe) {
  return (
    `The Codex CLI is not signed in with ${REQUIRED_CODEX_AUTH} ` +
    `(loggedIn=${probe.loggedIn}, authMethod=${probe.authMethod ?? "null"}). ` +
    "Research on this runtime runs on the operator's ChatGPT plan and never on an OpenAI API key. " +
    "Run `codex login` and choose ChatGPT, then start the run again."
  );
}

/** Locate the CLI and prove it is on ChatGPT. `run` and `locate` are injectable so the refusal
 *  is testable without a CLI on the machine. */
export async function assertChatGptAuth({ binary = null, run = runProcess, locate = locateCodex } = {}) {
  const resolved = binary ?? (await locate());
  if (!resolved) throw new Error("The Codex CLI was not found on PATH. Install it, or set CODEX_BIN.");
  const status = await run(resolved, ["login", "status"], {
    timeoutMs: AUTH_PROBE_TIMEOUT_MS,
    label: "Codex",
  });
  const probe = readCodexAuth(status?.stdout, status?.stderr);
  if (status?.code !== 0 || !isChatGptAuth(probe)) {
    const error = new Error(chatGptAuthFailureMessage(probe));
    error.code = "codex_cli_not_on_chatgpt";
    throw error;
  }
  return { binary: resolved, probe };
}
