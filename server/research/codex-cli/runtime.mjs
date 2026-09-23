// `ResearchRuntime` over the local Codex CLI, on the operator's ChatGPT plan.
//
// The same recipe and the same harness as `claude-cli`: one agent, the QV corpus server, web
// search, the host-owned `fetch_source`/`read_source`, and every citation checked after the
// run. Only the CLI underneath differs, and it is confined to the driver below, so a Codex
// result and a Claude result differ by model and not by harness.
//
// What it cannot do that the Claude runtime does:
// - `maxModelCalls` and `maxUsd` are not enforced live. `codex exec --json` reports neither a
//   per-call count nor a charge; the run is held to `maxRuntimeMs` and `maxSearchCalls`.
// - The dollar figure is an API-rate estimate from `model-catalog.mjs`, never a charge
//   (`usage.costBasis: "api_rate_estimate"`), because a ChatGPT plan bills nothing per call.
//
// The recorded baseline (28 banded, 18 agreed, 2 unpriced) is Opus's. A Codex run is measured
// against it, not ported to it: its own 30-scope run, with the operator's go-ahead.

import { ClaudeCliResearchRuntime } from "../claude-cli/runtime.mjs";
import { assertChatGptAuth } from "./auth.mjs";
import { CODEX_EMPTY_OUTPUT_ERROR_CODE, classifyCodexCall, runCodexCall } from "./codex-call.mjs";

export const CODEX_CLI_RESEARCH_RUNTIME_ID = "codex-cli";

export const DEFAULT_CODEX_CLI_MODEL = "gpt-6-sol";
export const DEFAULT_CODEX_CLI_REASONING = "high";

/** The Codex driver for `ClaudeCliResearchRuntime`, whose name is historical: it is the CLI
 *  research runtime, and the Claude driver is its default. */
export function codexCliDriver({ reasoning = null } = {}) {
  const effort = (env) => reasoning ?? env?.RESEARCH_CODEX_CLI_REASONING ?? DEFAULT_CODEX_CLI_REASONING;
  return Object.freeze({
    label: "Codex CLI",
    transcript: { kind: "codex-cli-transcript", name: "Codex CLI JSON transcript" },
    emptyOutputCode: CODEX_EMPTY_OUTPUT_ERROR_CODE,
    assertAuth: assertChatGptAuth,
    defaultModel: (env) => env.RESEARCH_CODEX_CLI_MODEL ?? DEFAULT_CODEX_CLI_MODEL,
    metadata: ({ model, reasoning: chosen, allowedTools, env }) => ({
      cliModel: model,
      reasoning: chosen ?? effort(env),
      allowedTools: allowedTools.join(","),
      costBasis: "api_rate_estimate",
    }),
    call: ({ workingDirectory, budget, env, reasoning: chosen = null, ...rest }) =>
      runCodexCall({
        ...rest,
        env,
        cwd: workingDirectory,
        reasoning: chosen ?? effort(env),
        timeoutMs: budget?.maxRuntimeMs ?? 30 * 60_000,
        ceilings: budget ?? null,
      }),
    classify: classifyCodexCall,
  });
}

export class CodexCliResearchRuntime extends ClaudeCliResearchRuntime {
  constructor({ reasoning = null, ...options } = {}) {
    super({
      id: CODEX_CLI_RESEARCH_RUNTIME_ID,
      ...options,
      driver: codexCliDriver({ reasoning }),
    });
  }
}
