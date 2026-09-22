# `claude-cli` research runtimes

Two `ResearchRuntime` implementations over the local Claude CLI, on the operator's own
claude.ai subscription. Neither is the default: `DEFAULT_RESEARCH_RUNTIME_ID` is still `fake`,
and both are reachable only by an explicit `runtimeId` on the request.

| id | what | phase |
|---|---|---|
| `claude-cli` | one agent, six flags — the configuration behind all 90 recorded runs | 1 |
| `claude-cli-roles` | planner → researcher → verifier → synthesiser, four sequential CLI calls | 2 |

These are the only live research runtimes. The Deep Agents runtime (`server/research/deepagents/`,
LangGraph over an API key) was retired on 23 September 2026 without ever producing a measured
result, and its useful parts moved here — see "What came over from Deep Agents" below.

## The six flags

```
claude -p "<pinned scope>" \
  --model claude-opus-5 \
  --append-system-prompt <qv-system-prompt.txt> \
  --mcp-config <one stdio server over the local priced-rate capture> \
  --allowed-tools "mcp__qv__search_qv,mcp__qv__get_qv_table,mcp__qv__list_qv_sections,WebSearch" \
  --output-format stream-json --verbose
```

`stream-json --verbose` rather than the recorded script's `json`: `json` returns one blob at
the end, so `events()` would have nothing to yield until the run was already over.

Plus, by default, two host tools on a second MCP server: `mcp__research__fetch_source` and
`mcp__research__read_source`. The recorded 90 runs had neither; `hostTools: []` (or the
benchmark's `--no-host-tools`) runs the recorded configuration exactly.

## What came over from Deep Agents

| idea | where it lives now |
|---|---|
| The model's process holds no credential and no general HTTP tool; the host fetches | `host-tools/`: the CLI spawns `mcp-server.mjs`, a dependency-free relay that forwards each call over a Unix socket in the run's owner-only temp directory to `bridge.mjs`, which runs `ResearchWebTools` in the parent. `WebFetch` is not allowed. |
| A page is retained as a content-addressed snapshot before it can be cited; PDFs by physical page | unchanged `ResearchWebTools` / `research-source-snapshots.mjs` |
| Every cited excerpt is checked against the retained source | `citations.mjs`, after the run, over the final answer: web figures need a `source_id` and an exact `excerpt`; QV row ids are looked up in the capture and the row text is retained so the store can re-verify it |
| A tool error the model can fix is fed back, not fatal | `host-tools/tool-errors.mjs` — the default is recoverable, and strikes count the same failing call (code + tool + input), not every error with one code, so three different 403s no longer end a run |
| Budget ceilings enforced during the run | `cli-call.mjs` counts model calls and web searches off the stream and the runtime stops the child the first time one is crossed; the host enforces tool calls and the deadline |
| A provider outage is not a research failure | a paid provider's rate limit, quota, auth or transient failure ends the run as `provider_unavailable`; a local fetch of one site timing out is feedback |
| Credentials never land in an artifact (from the live-model pilot) | `secret-scan.mjs` redacts any host credential value from the transcript and logs the variable name, never the value |

Not carried over: the LangGraph checkpointer (nothing resumed from it), the fake chat model
(the CLI tests replay recorded streams instead), and the pilot's scoring harness, which was an
evaluation of the Deep Agents runtime specifically. Its scoring ideas are worth revisiting when
the phase 2 evaluation is designed.

## Guarantees

- **Subscription only.** `start()` refuses unless `claude auth status --json` reports
  `authMethod: "claude.ai"`, and the child environment is built up from
  `buildClaudeEnvironment`'s allowlist, so `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and
  `ANTHROPIC_BASE_URL` cannot reach it. That denylist is `CLAUDE_ENV_DENYLIST`, reused rather
  than redeclared.
- **A corpus is required.** `RESEARCH_QV_INDEX` must name the local capture. A run that
  silently searched nothing would fall back to the web for everything and produce a plausible
  band from the wrong source of resort.
- **Concurrency is capped at three.** Eight parallel spawns produced six empty outputs out of
  seventy-two; three produced none. An empty output is reported as `claude_cli_empty_output`
  with `retryable: true`, because it correlated with spawn concurrency and never with the scope.
- **Verification is three runs compared, not a model judging a model.** `agreement.mjs` is
  arithmetic over the bands, at the recorded thresholds (1.25× low, 1.35× high).

## Running the live exit tests

Both spend real plan usage and both are opt-in.

Phase 1 — the 30 pinned scopes, three runs each, against `17a-top30-results.json`. About
$150 and roughly 75 minutes at concurrency 3:

```bash
RESEARCH_QV_INDEX=/path/to/indexed-items.jsonl RUN_CLAUDE_CLI_BENCHMARK=1 \
  npm run research:claude-cli-benchmark
```

It passes on 28 of 30 with a band, 18 of those tight, and no band for
`network-supply-connection-hv-metering` and `switchboard-fault-rating-protection`. If it does
not reproduce those, the port is wrong — do not proceed to phase 2, and do not move the
thresholds to fit.

Phase 2 — the same 30 scopes through the four roles, scored head to head. Four calls per run,
so budget more than phase 1:

```bash
RESEARCH_QV_INDEX=/path/to/indexed-items.jsonl RUN_CLAUDE_CLI_BENCHMARK=1 \
  npm run research:claude-cli-roles-benchmark -- \
    --phase1 .data/research-claude-cli/phase-1-benchmark.json
```

`--scopes <id,…>` and `--limit N` cut either down to a smoke test. A partial run reports the
comparison and explicitly declines an exit-test verdict, because the exit test is defined over
all thirty.

## What is still not true

No quantity surveyor has reviewed any band these runtimes produce. Three runs agreeing means
the scope was specified well enough to reproduce, not that the answer is right. Every finding
carries `verification.status: "unverified"` and says so in its notes for that reason.
