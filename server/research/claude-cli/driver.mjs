// The Claude half of a CLI research run: which binary, which login, which flags, and how the
// stream is read. Everything else — the queue, host tools, citation checks, the transcript
// scan, the run's lifecycle — belongs to `runtime.mjs` and is the same for every CLI.
//
// A driver is the seam a second CLI plugs into (`../codex-cli/driver.mjs`). Keeping it this
// narrow is what makes a comparison between the two a comparison of models rather than of two
// harnesses that drifted apart.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSupportedReasoning } from "../../model-catalog.mjs";
import { assertSubscriptionAuth } from "./auth.mjs";
import { buildClaudeEnvironment, classifyCall, runClaudeCall } from "./cli-call.mjs";

/** The model a research run uses unless told otherwise. */
export const DEFAULT_CLAUDE_CLI_MODEL = "claude-opus-5-5";

/** A run that exits cleanly having emitted no terminal `result` line. Named so a caller can
 *  retry it without string-matching a message. */
export const EMPTY_OUTPUT_ERROR_CODE = "claude_cli_empty_output";

export const claudeCliDriver = Object.freeze({
  label: "Claude CLI",
  transcript: { kind: "claude-cli-transcript", name: "Claude CLI stream transcript" },
  emptyOutputCode: EMPTY_OUTPUT_ERROR_CODE,
  assertAuth: assertSubscriptionAuth,
  defaultModel: (env) => env.RESEARCH_CLAUDE_CLI_MODEL ?? DEFAULT_CLAUDE_CLI_MODEL,
  metadata: ({ model, reasoning, allowedTools }) => ({
    cliModel: model,
    ...(reasoning ? { effort: reasoning } : {}),
    allowedTools: allowedTools.join(","),
  }),

  async call({ run, binary, env, workingDirectory, mcpConfig, budget, reasoning = null, ...rest }) {
    const mcpConfigPath = path.join(workingDirectory, "mcp.json");
    await writeFile(mcpConfigPath, JSON.stringify(mcpConfig), "utf8");
    return runClaudeCall({
      ...rest,
      run,
      binary,
      env: buildClaudeEnvironment(env, workingDirectory),
      cwd: workingDirectory,
      mcpConfigPath,
      // Only when the run carries a Settings choice: the recorded baseline passed no effort,
      // and the benchmarks, which bypass Settings, must keep passing none.
      effort: reasoning ? assertSupportedReasoning(rest.model, reasoning) : null,
      maxUsd: budget?.maxUsd ?? null,
      timeoutMs: budget?.maxRuntimeMs ?? 30 * 60_000,
      ceilings: budget ?? null,
    });
  },

  classify: (call) => classifyCall(call, { emptyOutputCode: EMPTY_OUTPUT_ERROR_CODE }),
});
