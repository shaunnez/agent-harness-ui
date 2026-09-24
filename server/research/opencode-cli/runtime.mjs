// `ResearchRuntime` over the local OpenCode CLI, on the operator's OpenCode Go plan.
//
// The same recipe and harness as `claude-cli` and `codex-cli`: one agent, the QV tools, web
// search, the host-owned `fetch_source`/`read_source`, and every citation checked after the run
// against the rows and pages the host recorded. Only the CLI differs, and it is confined to the
// driver below. The prompt is Codex's (`../codex-cli/codex-system-prompt.txt`), which allows a
// total from stated, cited assumptions, rewritten into OpenCode's tool vocabulary.
//
// Not in the Settings picker: it is under evaluation, and adding it needs Shaun's go-ahead.

import { ClaudeCliResearchRuntime } from "../claude-cli/runtime.mjs";
import { CODEX_SYSTEM_PROMPT_PATH } from "../codex-cli/runtime.mjs";
import { assertOpenCodeGoAuth, isOpenCodeGoModel } from "./auth.mjs";
import {
  buildOpenCodeEnvironment,
  classifyOpenCodeCall,
  OPENCODE_EMPTY_OUTPUT_ERROR_CODE,
  OPENCODE_MAX_RUNTIME_MS,
  runOpenCodeCall,
} from "./opencode-call.mjs";

export const OPENCODE_CLI_RESEARCH_RUNTIME_ID = "opencode-cli";
export const DEFAULT_OPENCODE_CLI_MODEL = "opencode-go/deepseek-v4.1-flash";

export function openCodeCliDriver() {
  return Object.freeze({
    label: "OpenCode CLI",
    transcript: { kind: "opencode-cli-transcript", name: "OpenCode CLI JSON transcript" },
    emptyOutputCode: OPENCODE_EMPTY_OUTPUT_ERROR_CODE,
    assertAuth: (options = {}) => assertOpenCodeGoAuth({ ...options, buildEnv: buildOpenCodeEnvironment }),
    defaultModel: (env) => env.RESEARCH_OPENCODE_CLI_MODEL ?? DEFAULT_OPENCODE_CLI_MODEL,
    metadata: ({ model, allowedTools }) => ({
      cliModel: model,
      allowedTools: allowedTools.join(","),
      costBasis: "api_rate_estimate",
    }),
    call: ({ workingDirectory, budget, model, ...rest }) => {
      if (!isOpenCodeGoModel(model))
        throw new Error(`"${model}" is not an OpenCode Go plan model; research runs only on the Go plan.`);
      return runOpenCodeCall({
        ...rest,
        model,
        cwd: workingDirectory,
        timeoutMs: Math.min(budget?.maxRuntimeMs ?? OPENCODE_MAX_RUNTIME_MS, OPENCODE_MAX_RUNTIME_MS),
        ceilings: budget ?? null,
      });
    },
    classify: classifyOpenCodeCall,
  });
}

export class OpenCodeCliResearchRuntime extends ClaudeCliResearchRuntime {
  constructor(options = {}) {
    const driver = openCodeCliDriver();
    super({
      id: OPENCODE_CLI_RESEARCH_RUNTIME_ID,
      systemPromptPath: CODEX_SYSTEM_PROMPT_PATH,
      ...options,
      driver,
      assertAuth:
        options.assertAuth ?? ((probe) => driver.assertAuth({ ...probe, env: options.env ?? process.env })),
    });
  }
}
