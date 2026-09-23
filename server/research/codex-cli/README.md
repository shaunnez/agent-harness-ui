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
| `stream.mjs` | `codex exec --json` → neutral events. **Provisional until pinned to a capture.** |
| `runtime.mjs` | The driver, and `CodexCliResearchRuntime`. |

## How the allowlist is enforced without `--allowed-tools`

- `--ignore-user-config`: the operator's MCP servers, plugins and instructions are not loaded.
- `mcp_servers.<name>.enabled_tools` from the recipe's `mcp__<server>__<tool>` list. A server
  with no allowed tool is not passed at all.
- `web_search="live"` only when the recipe allows `WebSearch`.
- `--disable shell_tool --disable unified_exec` (and `view_image`, `tool_suggest`, `memories`),
  with `--sandbox read-only` and `approval_policy="never"` beneath. If a shell command appears in
  the stream anyway, it is logged as one.

Every key above was checked against codex-cli 0.155.1 with `codex mcp list`, which parses the
same overrides without calling a model. Whether the shell is really absent is one of the things
the capture run confirms.

## What differs from the Claude runtime

- `maxModelCalls` and `maxUsd` are not enforced live: the stream reports neither. The run is
  held to `maxRuntimeMs` and `maxSearchCalls`.
- `usage.estimatedCostUsd` is priced from `server/model-catalog.mjs`, with
  `usage.costBasis: "api_rate_estimate"`. The ChatGPT plan bills nothing per call.
- The recipe's prompt says `WebSearch`; Codex's copy says `web_search`.
- A web search contributes a `tool.called` and nothing else: Codex keeps search results inside
  the model's context. Pages become checkable sources only through `fetch_source`, as on the
  Claude side.

## Before any Codex result is scored

1. **Capture.** `RUN_CODEX_CLI_CAPTURE=1 node scripts/research-codex-cli-capture.mjs` runs one
   small live run and copies its redacted stream to `tests/fixtures/codex-cli/capture.jsonl`.
   Pin `stream.mjs` and its tests to that file.
2. **Baseline.** `RUN_CODEX_CLI_BENCHMARK=1 node scripts/research-claude-cli-benchmark.mjs
   --runtime codex-cli` runs the 30 scopes x 3. The baseline is Opus's, so this is a
   measurement, not a pass/fail port check. Both steps spend plan usage and need the operator's
   go-ahead.
