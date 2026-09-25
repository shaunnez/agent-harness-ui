// The OpenCode gate. A research run on this runtime executes only on the operator's own OpenCode
// Go plan (`opencode-go/<model>`), never on a provider API key. Two mechanisms, as on the Claude
// and Codex sides:
//
//  1. `assertOpenCodeGoAuth` refuses to start unless `opencode auth list`, run with the same
//     stripped environment the research call gets, lists a stored OpenCode Console login. The
//     probe asks the CLI; the credential store itself is never opened here.
//  2. `buildOpenCodeEnvironment` (`opencode-call.mjs`) builds the child's environment up from an
//     allowlist, so `OPENCODE_API_KEY`, `ANTHROPIC_API_KEY` and every other provider key cannot
//     reach it and move the call onto metered billing.

import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess } from "../../process-runtime.mjs";

/** The provider prefix of an OpenCode Go plan model. */
export const OPENCODE_GO_PROVIDER = "opencode-go";

const AUTH_PROBE_TIMEOUT_MS = 20_000;

/** `OPENCODE_BIN`, else the installer's default location, else `opencode` on PATH. */
export async function locateOpenCode(env = process.env) {
  if (env.OPENCODE_BIN) return env.OPENCODE_BIN;
  const installed = path.join(env.HOME ?? os.homedir(), ".opencode", "bin", "opencode");
  if (
    await access(installed).then(
      () => true,
      () => false,
    )
  )
    return installed;
  return "opencode";
}

/** Read `opencode auth list`. Only the provider names and the credential's kind are kept: a line
 *  may carry an account label, and nothing else from it is worth carrying into an error. */
export function readOpenCodeAuth(stdout, stderr = "") {
  const text = `${stdout ?? ""}\n${stderr ?? ""}`;
  const console = /^\s*OpenCode Console\b.*\bstored\s*$/im.test(text);
  return { goPlan: console };
}

export function isOpenCodeGoModel(model) {
  return String(model ?? "").startsWith(`${OPENCODE_GO_PROVIDER}/`);
}

export function openCodeAuthFailureMessage(probe) {
  return (
    `OpenCode is not signed in to the OpenCode Go plan (goPlan=${probe.goPlan}). ` +
    "Research on this runtime runs on the operator's Go plan and never on a provider API key. " +
    "Run `opencode auth login` and choose OpenCode, then start the run again."
  );
}

/** Locate the CLI and prove it is on the Go plan. `run` and `locate` are injectable so the
 *  refusal is testable without a CLI on the machine. */
export async function assertOpenCodeGoAuth({
  binary = null,
  env = process.env,
  run = runProcess,
  locate = locateOpenCode,
  buildEnv,
} = {}) {
  const resolved = binary ?? (await locate(env));
  const status = await run(resolved, ["auth", "list"], {
    timeoutMs: AUTH_PROBE_TIMEOUT_MS,
    label: "OpenCode",
    ...(buildEnv ? { env: buildEnv(env, os.tmpdir()) } : {}),
  });
  const probe = readOpenCodeAuth(status?.stdout, status?.stderr);
  if (status?.code !== 0 || !probe.goPlan) {
    const error = new Error(openCodeAuthFailureMessage(probe));
    error.code = "opencode_cli_not_on_go_plan";
    throw error;
  }
  return { binary: resolved, probe };
}
