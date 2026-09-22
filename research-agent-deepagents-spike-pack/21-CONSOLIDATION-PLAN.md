# Consolidation plan: one research runtime on the subscription

22 September 2026, against the tree at `df2a37c`.

## Where we are

Three ways to run research exist. Only one has ever produced a usable result.

| path | what it is | status |
|---|---|---|
| **Live-model pilot** | `scripts/research-model-pilot.mjs`, standalone, requires `RESEARCH_MODEL_API_KEY` in an owner-only 0600 file | 7 live sessions, metered API, an acceptance harness rather than a research engine |
| **Today's CLI runs** | `14c-run-research.sh`, spawns `claude -p` on the subscription with an MCP tool server | **90 runs, 28 of 30 scenarios priced, 18 with three-run agreement** |
| **Harness runtime** | `server/research/deepagents/`, LangGraph via LangChain `ChatAnthropic` | Never run. `research_runs` is empty in every database. Falls back to a silent fake with no credential |

## Two corrections to the stated plan

The plan as described was: keep the roles, use `--agents`, one CLI instance per role,
`--max-budget-usd`, drop LangGraph, orchestrate ourselves.

**1. `--agents` and one-CLI-call-per-role are alternatives, not both.**

- `--agents` hands the model four named roles and lets it decide when to call each. No
  guarantee the verifier runs.
- One CLI call per role means our code runs planner, then researcher, then verifier,
  then synthesiser, feeding each output to the next. The sequence is guaranteed because
  our code is the sequence.

Orchestrating it ourselves *is* the second one. Choosing it means `--agents` is not
needed. Both is not a thing.

**2. Roles are the destination, not step one.**

The 90 runs that worked used **one agent, no roles, no subagents, no checkpointer, no
budget flag**. Six CLI flags. The verification was running each scenario three times and
comparing, not a verifier agent.

So the four-role split is a hypothesis with nothing behind it yet, and the single agent
is the thing with 28 cost bands behind it. Build the proven one first as a baseline,
then measure whether roles beat it. Building roles first means never finding out
whether the extra structure earned its place.

## The plan

### Phase 0 — make the fake fail loudly. One hour. Do this first.

`resolveModelConfig()` returns `provider: "fake"` when no credential is present, and
nothing in the UI distinguishes a fake run from a live one. Nobody has been burned yet
only because the harness runtime has never run.

- Fail the run when no provider is configured outside tests.
- Put the provider and model on the run record, and surface it in the UI.

Independent of everything below, and the only item here that is pure risk reduction.

### Phase 1 — port what works. One day.

A new `server/research/claude-cli/` runtime implementing the five `ResearchRuntime`
methods, wrapping exactly the proven configuration:

```
claude -p "<objective>" --model claude-opus-5 \
  --append-system-prompt <role prompt> --mcp-config <tools> \
  --allowed-tools "<corpus tools>,WebSearch" --output-format stream-json --verbose
```

- `start` spawns the child, `cancel` kills it, `status` reads a `Map`
- `events` translates the stream: `system/init` → `run.started`, `tool_use` →
  `tool.called`, `tool_result` → `source.retrieved`, `rate_limit_event` →
  `budget.ceiling_hit`, `result/success` → `run.completed`
- `result` parses the final JSON block
- Three runs per objective, agreement computed as it is in `build_review.py`
- `--max-budget-usd` from `ResearchBudget`
- Refuses to start unless `claude auth status` reports `claude.ai`, and strips
  `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`

Register it beside `fake`. Do not make it the default yet.

Nothing changes in `src/domain/research.ts`, the store, the routes or the UI.

**Exit:** the 30 pinned scopes run through the harness and reproduce
`18a-review-feed.json` — 28 bands, 18 agreed — within the agreement thresholds already
recorded.

### Phase 2 — measure the role split. One day.

Only now build the four-role orchestration: planner, researcher, verifier, synthesiser
as four sequential CLI calls our code makes, each with its own prompt, model and tools.

Run it against the same 30 pinned scopes and compare with Phase 1 on:

- scenarios with a band (baseline: 28 of 30)
- three-run agreement (baseline: 18 tight)
- plan usage per scenario (baseline: $4.97)
- whether the verifier catches anything the single agent got wrong

**Exit:** keep whichever wins on the same 30. If roles do not beat one agent, ship one
agent and record that they did not. A negative result here is worth the day.

### Phase 3 — wire it into the product. Two to three days.

Per `19-RESEARCH-PROJECT-PROTOTYPE-PROMPT.md`:

- `projectId` on the run record, `GET /api/research/runs?projectId=`
- `kind: "delivery" | "research"` on `RuntimeProject`, `repositoryPath` optional
- Fifth base variant, research projects excluded from the delivery rotation
- Point `AgentActivity` at the research event stream
- `ExecutionSettings` over research roles
- Review surface off `18b-review-index.json`

### Phase 4 — remove the legacy. Gated on Phases 1–3.

**Do not start until the `claude-cli` runtime is the default and has served real
reviewed work.**

Delete:

| what | why |
|---|---|
| `server/research/deepagents/` (6 files) | The LangGraph adapter. Never produced a finding |
| 9 dependencies: `@langchain/anthropic`, `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint`, `@langchain/langgraph-checkpoint-sqlite`, `@langchain/langgraph-sdk`, `@langchain/openai`, `langchain`, `langsmith` | Nothing else imports them |
| `tests/research-deepagents-*.test.mjs` (3 files) | Test the deleted adapter |
| The LangChain reference in `src/research-runtime-contract.ts` | Last mention outside the adapter |
| `scripts/research-model-pilot.mjs` runner | Superseded as an engine |

Keep:

| what | why |
|---|---|
| `src/domain/research.ts` | Provider-neutral contract. Unchanged throughout |
| `research-store.mjs`, `research-routes.mjs`, `research-service.mjs` | LangChain-free already |
| All providers, source policy, snapshots, credit ledger, web tools | LangChain-free already |
| `fake-research-runtime.mjs` | Tests need it. Never the default again after Phase 0 |
| `scripts/research-model-pilot/secret-scan.mjs`, `session-ledger.mjs`, `preflight.mjs` | The guardrails are the good part of the pilot. Fold into the new runtime |

**The removal is unusually clean.** LangChain appears in exactly 6 source files, all
inside `deepagents/`, plus 3 tests and one comment. Everything else in
`server/research/` — store, routes, service, all providers, source policy, snapshots,
credit ledger, web tools, registry — is already free of it.

**Exit:** `npm test` green with 9 fewer dependencies.

## Total

Roughly a week: 1 hour, 1 day, 1 day, 2–3 days, then removal.

## The honest state

28 of 30 scenarios have a cost band and no quantity surveyor has reviewed one of them.
Three runs agreeing means the scope was specified well enough to reproduce, not that the
answer is right. Every phase above is plumbing around that fact, and none of it
substitutes for the review.
