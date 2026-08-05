# Claude CLI fixtures

Recorded `claude -p --output-format stream-json --verbose` output from the real CLI
(**2.1.222**, native arm64, macOS 25.4.0) on 2026-08-05, authenticated against a
`claude.ai` team subscription. Captured for the Claude execution provider — see
[../../../docs/claude-execution-provider-design.md](../../../docs/claude-execution-provider-design.md).

These are evidence, not synthetic samples. Do not hand-edit them: the parser is tested
against what the CLI actually emitted, including its inconsistencies. Re-record from a real
run if the CLI's wire format changes.

| File | Captures |
|---|---|
| `stream-json-tool-calls.jsonl` | The parser fixture. 12 events: `system/init`, empty `thinking`, `rate_limit_event`, a `Read` tool call, **two parallel `Bash` calls whose results return out of order**, one failing (`is_error: true`, `Exit code 1\n…`) and one succeeding, final `assistant` text, `system/post_turn_summary`, and a `result` with cumulative usage + `modelUsage`. |
| `sandbox-denied-write.jsonl` | Sandbox canary. `sandbox.enabled` + `failIfUnavailable` + `filesystem.denyWrite` refuses a Bash write: `Exit code 1\n(eval):1: operation not permitted`. |
| `sandbox-escape-denied.jsonl` | The escape hatch. Model attempts `dangerouslyDisableSandbox: true` twice with `allowUnsandboxedCommands` left permissive; both denied and recorded in `result.permission_denials`. Also the only capture showing a PreToolUse hook rewriting a command **after** the `tool_use` event was emitted. |
| `safe-mode-sandbox.jsonl` | `--safe-mode` does not suppress the `--settings` sandbox block; the write is still refused and hooks no longer rewrite the command. |

Load-bearing details a parser must honour, all observable here:

- Correlate `tool_result` to `tool_use` **by `tool_use_id` only** — results arrive out of order.
- Success is `is_error !== true`. It is `false` on a successful `Bash` result and **absent
  entirely** on a successful `Read` result.
- A sandbox denial also carries an `Exit code N` prefix, so the prefix cannot classify *why* a
  command failed.
- Tolerate unknown top-level types and unknown `system` subtypes (`rate_limit_event`,
  `post_turn_summary`, `thinking_tokens` all appear).
- Top-level `result.usage` is cumulative for the primary model and equals
  `modelUsage[primary]`. `usage.iterations` does **not** reconcile — do not sum it.
- `modelUsage` may contain a model the harness never requested (`claude-haiku-4-5` appears
  under a `--model sonnet` run).
