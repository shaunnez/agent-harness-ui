# Build brief: phases 0 to 2

For whoever implements this. The plan is `21-CONSOLIDATION-PLAN.md`; this is the
working detail, the exit tests, and the traps. Stop after phase 2. Phase 3, the
Frontier UI, does not start until phases 0, 1 and 2 are done.

Everything referenced here is on `main` as of `8b2f529`.

---

## Phase 0 — make the fake fail loudly. One hour.

`server/research/deepagents/model-config.mjs` returns `{provider: "fake"}` when no
credential is present. Nothing in the UI distinguishes a fake run from a live one, and
`research-runtime-registry.mjs` sets `DEFAULT_RESEARCH_RUNTIME_ID = "fake"`.

Prove it for yourself before changing it:

```js
node -e "import('./server/research/deepagents/model-config.mjs').then(m=>{
  const e={...process.env}; delete e.ANTHROPIC_API_KEY; delete e.OPENAI_API_KEY;
  delete e.RESEARCH_MODEL_API_KEY; delete e.RESEARCH_MODEL_PROVIDER;
  console.log(m.resolveModelConfig(e));})"
```

Do three things:

1. Throw when no provider is configured, unless an explicit opt-in is set for tests.
   `resolveModelConfig` already throws with a clear message when a provider is named
   without a key — match that wording.
2. Put `provider` and `model` on the run record and expose them on the run projection.
3. Surface them wherever a run or finding is displayed.

**Exit:** a run with no credential fails with a message naming what to set. Existing
tests still pass — several depend on the fake, so keep it reachable by explicit
selection, never by fallback.

---

## Phase 1 — port what already works. One day.

### What to port

The configuration behind all 90 runs. It is six flags, in
`research-agent-deepagents-spike-pack/14c-run-research.sh`:

```
claude -p "<objective>" \
  --model claude-opus-5 \
  --append-system-prompt <system prompt> \
  --mcp-config <tool server config> \
  --allowed-tools "mcp__qv__search_qv,mcp__qv__get_qv_table,mcp__qv__list_qv_sections,WebSearch" \
  --output-format json
```

One agent. No roles, no subagents, no checkpointer, no budget flag. Verification was
running each scenario three times and comparing — that is what phase 2 questions, not
phase 1.

Supporting files, all on `main`:

| file | what |
|---|---|
| `14a-qv-mcp-server.py` | dependency-free MCP stdio server over the local QV capture |
| `14b-mcp.json` | the MCP config |
| `14d-system-prompt.txt` | the system prompt, including the order of resort |
| `16-pinned-scopes/` | the 30 pinned scopes, one file each |
| `18f-build-review.py` | raw runs to review records, including the agreement maths |
| `17a-top30-results.json` | the 90 runs summarised — your comparison target |

### Where it goes

`server/research/claude-cli/`, implementing the five `ResearchRuntime` methods from
`src/domain/research.ts`:

- **start** — spawn the child, return a handle. Use `--output-format stream-json
  --verbose` here rather than `json`, so `events` has something to read.
- **cancel** — kill the child.
- **status** — a `Map` of live runs.
- **events** — translate the stream. Verified mapping, from a captured run:

  | CLI stream line | `ResearchEventType` |
  |---|---|
  | `system` / `init` | `run.started` |
  | `assistant` block `tool_use` | `tool.called` |
  | `user` block `tool_result` | `source.retrieved` |
  | `assistant` block `text` | `log` or `finding.created` |
  | `rate_limit_event` | `budget.ceiling_hit` |
  | `result` / `success` | `run.completed` |

- **result** — parse the final ```json fence from `result`.

Three runs per objective, agreement computed exactly as `18f-build-review.py` does it.
Map `ResearchBudget` onto `--max-budget-usd`.

Refuse to start unless `claude auth status --json` reports `authMethod: "claude.ai"`,
and strip `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` — the same
denylist as `CLAUDE_ENV_DENYLIST` in `server/claude-runtime.mjs`, which you can reuse
rather than redeclare.

Register beside `fake`. **Do not make it the default yet.**

### Exit test — this is the whole point of the phase

Run all 30 pinned scopes through the harness runtime, three runs each, and compare with
`17a-top30-results.json`:

- 28 of 30 produce a cost band
- 18 of those agree within 1.25× low and 1.35× high
- `network-supply-connection-hv-metering` and `switchboard-fault-rating-protection`
  produce no band — that is the correct answer for both

Consensus values will not match to the cent; these are model runs. Status buckets and
counts should. **If they do not reproduce, the port is wrong — do not proceed to phase 2
and do not tune the thresholds to fit.**

Budget about $150 of plan usage, roughly $5 per scenario.

---

## Phase 2 — measure the role split. One day.

Only now build planner / researcher / verifier / synthesiser, as **four sequential CLI
calls your code makes**, each with its own prompt, model and tools, feeding each output
to the next.

Not `--agents`. That hands the model four roles and lets it choose when to call each,
with no guarantee the verifier runs. Orchestrating it yourself is the point: your code
is the sequence, so the sequence is guaranteed.

Run against the same 30 pinned scopes and compare against phase 1 on:

| metric | phase 1 baseline |
|---|---|
| scenarios with a band | 28 of 30 |
| three-run agreement | 18 tight |
| plan usage per scenario | $4.97 |
| verifier catches something one agent got wrong | n/a — this is the real question |

**Exit:** keep whichever wins. If four roles do not beat one agent, ship one agent and
write down that they did not. A negative result is worth the day; an unmeasured
assumption carried into phase 3 is not.

Score it on the output, not on anything a model judges. `#101` merged a fix for exactly
that failure in the SDLC scorecard — gate pass rate rewarded a laxer reviewer, because
the gates were themselves model runs. Do not rebuild that here.

---

## Traps, all hit during the 90 runs

- **`--output-format json` gives one blob; `stream-json --verbose` gives the events.**
  You need the second for `events()`.
- **Concurrency.** 8 parallel CLI spawns produced 6 empty outputs out of 72. At 3 they
  all completed. The scopes were fine in isolation — it is a concurrency limit, not a
  content failure. Cap it, and treat an empty output as retryable.
- **zsh does not word-split unquoted variables.** A loop using `set -- $var` to split a
  pair silently produced one argument and wrote to malformed paths. Use explicit fields
  or `IFS= read -r`.
- **Opus with a high `max_tokens` needs streaming** if you ever call the API directly;
  the SDK raises rather than blocking. Not an issue through the CLI.
- **Thinking blocks come first.** Any direct SDK call must select the text block, not
  `content[0]`. Cost me a full billed batch that returned nothing.
- **`nearest_group` carries the in-table sub-heading** — load class, size band, duty.
  Omitting it from tool output made the agent infer load classes from the price ladder.
  Including it dropped `not_established` from 8 entries to 5 on one scenario. Keep it in
  whatever retrieval you build.

---

## What is still not true

**No quantity surveyor has reviewed any of the 28 bands.** Three runs agreeing means
the scope was specified well enough to reproduce, not that the answer is right.
`18g-review.html` is the page that gets them reviewed; phases 0 to 2 are the plumbing
that makes the numbers come from the harness instead of a script in `/tmp`.

The 30 pinned scopes were written by a model from a prompt, using two hand-written
examples. The representative cases — 1.8m timber pole, 25mm² XLPE, 30 kWp array — are
assumptions, not a surveyor's judgement.
