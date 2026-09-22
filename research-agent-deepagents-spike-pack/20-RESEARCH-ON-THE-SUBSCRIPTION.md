# Does the research runtime use the subscription? No — and the failure is silent

Checked 22 September 2026 against the tree at `df2a37c`.

## The answer

**It does not, and removing the API keys does not move it onto the subscription. It
moves it onto a deterministic fake.**

`server/research/deepagents/model-config.mjs` resolves exactly three providers:

```
no credentials  -> {"provider":"fake","model":"fake-research-model"}
ANTHROPIC_API_KEY set -> {"provider":"anthropic","model":"claude-haiku-4-5-20251001", ...}
OPENAI_API_KEY set    -> {"provider":"openai-compatible", ...}
```

That is the actual output of `resolveModelConfig()` run against a stripped environment,
not a reading of the code. There is no fourth branch and no CLI path: a grep for
`locateClaude`, `buildClaudeEnvironment` or a spawned `claude` across all of
`server/research/` returns one hit, and it is a comment.

`worker.mjs` constructs the model with `new ChatAnthropic(...)` from
`@langchain/anthropic`, which is the Messages API and needs a key. The key reaches the
child as `RESEARCH_MODEL_API_KEY` — renamed on the way in so the provider's own
variable name never enters the child environment — but it is still a metered API key.

`research-runtime-registry.mjs` sets `DEFAULT_RESEARCH_RUNTIME_ID = "fake"`.

## Why it would have looked like it worked

Three things line up badly:

1. Removing the keys does not error. It silently selects `provider: "fake"`.
2. The fake is a real implementation of the runtime contract — it emits the proper
   event stream, produces findings, and completes. A run looks normal.
3. **Nothing in the UI says which provider ran.** A grep of the frontier views for a
   provider badge on research output finds nothing.

So a keyless run completes, shows agents working, and produces findings. There is no
visible difference between that and a live one.

**This is worth fixing on its own account, ahead of any subscription work.** A research
runtime that quietly answers with canned output when its credential is missing is a
trap. Either fail the run when no provider is configured outside tests, or badge the
provider on every run record and every finding. Preferably both.

## How hard is it to move onto the subscription

Two routes. One is much cheaper than the other.

### Route A — a CLI-backed runtime beside the existing one. Recommended.

The `ResearchRuntime` contract is five methods:

```ts
start(request, signal): Promise<ResearchRunHandle>
status(runId): Promise<ResearchRunStatus>
cancel(runId): Promise<void>
events(runId, cursor?): AsyncIterable<ResearchEvent>
result(runId): Promise<ResearchResult>
```

The registry is built to take another entry — its own comment says registering a second
adapter "is the whole of that wiring change".

The CLI supplies everything those five methods need. `claude -p --output-format
stream-json --verbose --mcp-config …` emits, in one run:

| CLI stream | maps to |
|---|---|
| `system/init` | `run.started` |
| `assistant` block `tool_use` | `tool.called` |
| `user` block `tool_result` | `source.retrieved` |
| `assistant` block `text` | `finding.created` / `log` |
| `rate_limit_event` | `budget.ceiling_hit` |
| `result/success` | `run.completed` |

That table is from an actual stream captured today, not from documentation.

So the work is: one module that spawns the CLI per run, translates the stream, keeps a
`Map` of live runs, kills the child on `cancel`, and parses the final JSON for
`result`. Roughly 250–400 lines. Then register it and make the default runtime
configurable.

Nothing else changes — not the neutral contract in `src/domain/research.ts`, not the
store, not the routes, not the UI. **Call it one to two days.**

The pieces are already proven in this pack: `14c-run-research.sh` and `18d-ask.sh`
spawn the CLI on the subscription with MCP tools and return structured JSON, and
`14a-qv-mcp-server.py` is the tool server. 90 runs went through that path for
`17-TOP-30.md`.

### Route B — keep the deepagents graph, swap its model layer

Subclass LangChain's `BaseChatModel` (already imported in `worker.mjs`) so a model call
shells out to the CLI.

This is the harder route and I would not start here. The deepagents graph binds tools
to the model and expects `tool_calls` back in LangChain's shape. `claude -p` runs its
own agent loop with its own tools; it does not expose a single-turn completion with
tool-call output. You would be fighting to make an agent pretend to be a chat model.

## The trade to be aware of

Route A gives up the deepagents graph for research runs that take it: the planner /
researcher / verifier / synthesiser decomposition, the checkpointer, the
`modelCallLimitMiddleware` ceiling. The CLI runs its own loop instead.

That may be the right trade — the CLI loop produced 28 cost bands across 30 scenarios
with three-run agreement — but it is a trade, not a free win. Registering it beside the
existing runtime rather than replacing it keeps both available, and the run record
already carries `runtimeId`, so which one answered is recorded per run.

## Correction

`19-RESEARCH-PROJECT-PROTOTYPE-PROMPT.md` said the research runtime "takes
`RESEARCH_MODEL_API_KEY` and bills the API". True as far as it goes, and it missed the
more important half: with no key at all it does not fail, it fakes.
