// The subscription gate. A research run on this runtime may only ever execute against the
// operator's own claude.ai plan, never against metered API billing.
//
// Two mechanisms, and they are deliberately different in kind:
//
//  1. `assertSubscriptionAuth` refuses to start unless `claude auth status --json` reports
//     `authMethod: "claude.ai"`. This is the check `14c-run-research.sh` ran before every one
//     of the 90 recorded runs, and it is a *positive* assertion — the absence of an API key is
//     not evidence of a subscription.
//  2. `buildClaudeEnvironment` (reused from `../../claude-runtime.mjs`) builds the child's
//     environment up from an allowlist, so `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and
//     `ANTHROPIC_BASE_URL` cannot reach it even if a future allowlist edit tried to admit
//     them. That denylist is not redeclared here: one list, asserted in one place, is the only
//     version of this guarantee that stays true.
//
// `claude-runtime.mjs` notes that `auth status` is "a good fast-path hint and a bad authority"
// for whether the CLI can *execute*, because credentials arriving through the environment make
// it report `loggedIn: false` for a usable CLI. That caveat does not weaken this use: here the
// question is not "can it run?" but "is it on the plan rather than on an API key?", and
// `authMethod` is exactly the field that answers it. A false negative refuses a run, which is
// the safe direction to be wrong in.

import { CLAUDE_ENV_DENYLIST, CLAUDE_RUN_LABEL, locateClaude } from "../../claude-runtime.mjs";
import { runProcess } from "../../process-runtime.mjs";

export const REQUIRED_AUTH_METHOD = "claude.ai";

const AUTH_PROBE_TIMEOUT_MS = 10_000;

/** Parse `claude auth status --json`. Never throws: an unparseable probe is "not on a
 *  subscription", which is the answer that refuses a run. */
export function readSubscriptionAuth(stdout) {
  try {
    const parsed = JSON.parse(stdout ?? "");
    return {
      loggedIn: parsed?.loggedIn === true,
      authMethod: typeof parsed?.authMethod === "string" ? parsed.authMethod : null,
      subscriptionType: typeof parsed?.subscriptionType === "string" ? parsed.subscriptionType : null,
      orgName: typeof parsed?.orgName === "string" ? parsed.orgName : null,
    };
  } catch {
    return { loggedIn: false, authMethod: null, subscriptionType: null, orgName: null };
  }
}

export function isSubscriptionAuth(probe) {
  return probe.loggedIn === true && probe.authMethod === REQUIRED_AUTH_METHOD;
}

export function subscriptionAuthFailureMessage(probe) {
  return (
    `The Claude CLI is not on a ${REQUIRED_AUTH_METHOD} subscription ` +
    `(loggedIn=${probe.loggedIn}, authMethod=${probe.authMethod ?? "null"}). ` +
    "Research on this runtime runs on the operator's plan and never on metered API billing. " +
    "Run `claude login` and choose the subscription, then start the run again."
  );
}

/**
 * Locate the CLI and prove it is on the subscription. Returns the binary path and the probe.
 *
 * `run` is injectable so a test can assert the refusal without a CLI on the machine — the
 * refusal is the part worth testing, and it must not be reachable only on a developer's
 * laptop that happens to be logged in.
 */
export async function assertSubscriptionAuth({
  binary = null,
  run = runProcess,
  locate = locateClaude,
} = {}) {
  const resolved = binary ?? (await locate());
  if (!resolved) throw new Error("The Claude CLI was not found on PATH. Install it, or set CLAUDE_BIN.");
  const status = await run(resolved, ["auth", "status", "--json"], {
    timeoutMs: AUTH_PROBE_TIMEOUT_MS,
    label: CLAUDE_RUN_LABEL,
  });
  const probe = readSubscriptionAuth(status?.stdout);
  if (!isSubscriptionAuth(probe)) {
    const error = new Error(subscriptionAuthFailureMessage(probe));
    error.code = "claude_cli_not_on_subscription";
    throw error;
  }
  return { binary: resolved, probe };
}

/** Re-exported so a caller can assert the stripped variables without importing the SDLC
 *  runtime directly, and so the list has exactly one definition. */
export { CLAUDE_ENV_DENYLIST };
