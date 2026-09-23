# `codex-cli` research runtime

The `claude-cli` recipe and harness with the Codex CLI underneath, on the operator's ChatGPT
plan. GPT-6 Sol at high reasoning by default (`RESEARCH_CODEX_CLI_MODEL`,
`RESEARCH_CODEX_CLI_REASONING`).

It is `ClaudeCliResearchRuntime` with a different driver (`runtime.mjs`). The queue, host tools
(`fetch_source`, `read_source`), citation checks, strike counter, transcript redaction and
run lifecycle are the Claude runtime's own code, so a Codex result and a Claude result differ
by model, not by harness.

| File | What it owns |
|---|---|
| `auth.mjs` | Refuses to start unless `codex login status` says ChatGPT. Never reads a key. |
| `codex-call.mjs` | The `codex exec` argv, the environment allowlist, classification of a finished call. |
| `stream.mjs` | `codex exec --json` → neutral events, pinned to two captured runs in `tests/fixtures/codex-cli/`. |
| `runtime.mjs` | The driver, and `CodexCliResearchRuntime`. |

## How the allowlist is enforced without `--allowed-tools`

- `--ignore-user-config`: the operator's MCP servers, plugins and instructions are not loaded.
- `mcp_servers.<name>.enabled_tools` from the recipe's `mcp__<server>__<tool>` list, and
  `mcp_servers.<name>.tools.<tool>.approval_mode="approve"` for exactly those tools. Without the
  approval, `approval_policy="never"` refuses every MCP call; the first capture recorded that.
  A server with no allowed tool is not passed at all.
- `web_search="live"` only when the recipe allows `WebSearch`.
- `--disable shell_tool --disable unified_exec` (and `view_image`, `tool_suggest`, `memories`),
  with `--sandbox read-only` and `approval_policy="never"` beneath. If a shell command appears in
  the stream anyway, it is logged as one.

Every key above was checked against codex-cli 0.155.1 with `codex mcp list`, which parses the
same overrides without calling a model. In the capture the model reported no shell or command
tool listed, and no `command_execution` item appeared.

## What differs from the Claude runtime

- Tokens arrive once, on `turn.completed` at the end of the run, which is also all the SDLC
  Codex integration reads (`server/codex-runtime.mjs`). So `maxModelCalls` and `maxUsd` cannot
  stop a run part-way; it is held live to `maxRuntimeMs` (the process timeout) and
  `maxSearchCalls`, and its tokens and API-rate estimate are reported when it ends.
- `usage.estimatedCostUsd` is priced from `server/model-catalog.mjs`, with
  `usage.costBasis: "api_rate_estimate"`. The ChatGPT plan bills nothing per call.
- Codex has its own prompt, `codex-system-prompt.txt`. Under the Opus prompt GPT-6 Sol banded
  2 of 30 scopes (`26-CODEX-BASELINE-RESULT.md`): it read "never invent a number" as a ban on
  any total resting on an assumption. Its copy keeps the order of resort, citation rules and
  schema, and says that distinct components are added, a close row may stand in with a stated
  adjustment, and a minor unpublished item is a labelled allowance (`"basis": "allowance"`,
  counted as `citations.allowances`). The Opus prompt is unchanged.
- A web search contributes a `tool.called` and nothing else: Codex keeps search results inside
  the model's context. Pages become checkable sources only through `fetch_source`, as on the
  Claude side.

## Before any Codex result is scored

1. **Capture** (done 23 September 2026). `RUN_CODEX_CLI_CAPTURE=1 node
   scripts/research-codex-cli-capture.mjs` runs one small live run and copies its stream to
   `tests/fixtures/codex-cli/capture.jsonl`. Blank the licensed QV row text before committing
   it: the repository is public.
2. **Baseline** (not run). `RUN_CODEX_CLI_BENCHMARK=1 node scripts/research-claude-cli-benchmark.mjs
   --runtime codex-cli` runs the 30 scopes x 3. The baseline is Opus's, so this is a
   measurement, not a pass/fail port check. Both steps spend plan usage and need the operator's
   go-ahead.
