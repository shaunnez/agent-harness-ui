# Phases 0 to 2: what was built, what was verified, what is outstanding

Against `23-BUILD-BRIEF-PHASES-0-2.md`. Stopped after phase 2, as instructed.

`npm test`: 863 pass, 0 fail (826 before). `npm run typecheck` and Biome lint/format clean.

---

## Phase 0 — the fake fails loudly

**Done.**

`resolveModelConfig()` no longer falls back to `provider: "fake"` when no credential is
present. It throws, naming exactly what to set:

> No research model provider is configured. Set `RESEARCH_MODEL_PROVIDER=anthropic` with
> `RESEARCH_MODEL_API_KEY` or `ANTHROPIC_API_KEY`, `RESEARCH_MODEL_PROVIDER=openai-compatible`
> with `RESEARCH_MODEL_API_KEY` or `OPENAI_API_KEY`, or `RESEARCH_MODEL_PROVIDER=fake` to
> select the deterministic fake model deliberately.

The fake stays reachable by naming it (`RESEARCH_MODEL_PROVIDER=fake`), never by fallback. An
unrecognised provider name is also rejected rather than silently becoming the fake.

**Provider and model now reach the record and the projection.** A new neutral
`ResearchModelIdentity` (`{provider, model, live}`) on `src/domain/research.ts`:

- `ResearchRunHandle.model` — what an adapter reports at `start()`
- `ResearchRunRecord.model` — persisted in a new `research_runs.model_json` column, added by
  migration so existing databases keep their rows (null: those runs did not record one)
- `ResearchResult.model` — read back off the run, so a finding read alone still says what
  produced it

`live: false` is the field that matters. A reader does not have to recognise the word "fake"
to know a finding was invented. The fake runtime reports `{fake, deterministic-fake, false}`;
the Deep Agents adapter reports its resolved provider and model; both `claude-cli` runtimes
report `live: true`, because neither has a fake path at all.

An identity the runtime never reported stays `null`. It is never defaulted: "we do not know
what answered this" and "a fake answered this" are different states.

Surfaced on `GET /api/research/runs`, `GET /api/research/runs/:id`, the result endpoint, and
`scripts/research-demo.mjs`. There is no research UI yet — that is phase 3.

**Tests.** `tests/research-model-pilot.test.mjs` (the unconfigured-environment throw),
`tests/research-deepagents-adapter.test.mjs` (a bare environment fails at `start()` with the
remedy in the message; a live identity is reported without a network call),
`tests/research-store.test.mjs` (the identity survives to the record, the result and the run
list; a silent runtime stays null).

`tests/research-deepagents-test-support.mjs` now names the fake explicitly in `safeChildEnv`,
so a test that forgets gets the same failure a real operator would.

---

## Phase 1 — the port

**Built and verified on one scenario. The full 30-scope exit test has not been run — it costs
about $150 of plan usage and roughly 75 minutes.**

`server/research/claude-cli/` implements `ResearchRuntime` over the six proven flags:

```
claude -p "<pinned scope>" --model claude-opus-5 \
  --append-system-prompt qv-system-prompt.txt \
  --mcp-config <qv stdio server> \
  --allowed-tools "mcp__qv__search_qv,mcp__qv__get_qv_table,mcp__qv__list_qv_sections,WebSearch" \
  --output-format stream-json --verbose
```

| file | what |
|---|---|
| `runtime.mjs` | the five contract methods, the concurrency cap, the transcript |
| `cli-call.mjs` | one `claude -p` call: argv, environment, stream drain. Shared with phase 2 |
| `stream.mjs` | the stream-line → `ResearchEventType` mapping and the usage read |
| `auth.mjs` | the `claude.ai` subscription gate |
| `qv-recipe.mjs` | system prompt, MCP config, allowed tools, cost-band parsing, findings |
| `qv-corpus-server.py` | `14a` ported verbatim, capture path from argv/`RESEARCH_QV_INDEX` |
| `agreement.mjs` | `18f-build-review.py`'s arithmetic |
| `trio.mjs` | three runs per objective, empty-output retry |

Registered beside `fake` and `deepagents`. **Not the default** — `DEFAULT_RESEARCH_RUNTIME_ID`
is still `fake`.

### The traps, each handled

- `stream-json --verbose`, not `json`. `json` returns one blob at the end and `events()` would
  have nothing to yield.
- **Concurrency capped at 3**, in the runtime rather than in each caller. An empty output
  (clean exit, no `result` line) is `claude_cli_empty_output` with `retryable: true`, and
  `trio.mjs` retries only that — retrying a bad band would turn "these three disagree" into
  "these three agree, after I discarded the one that did not".
- No shell word-splitting anywhere: argv is an array.
- Thinking blocks are dropped by block type, never by `content[0]`.
- `nearest_group` stays in the corpus server's `fmt()`, with a comment saying why.

### The subscription guarantee

`start()` refuses unless `claude auth status --json` reports `authMethod: "claude.ai"`, and
the child environment comes from `buildClaudeEnvironment`'s allowlist — `CLAUDE_ENV_DENYLIST`
reused, not redeclared, so `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and
`ANTHROPIC_BASE_URL` cannot reach it. A test asserts all three are absent from the spawn.

### What has been verified

**The agreement arithmetic reproduces the recorded baseline exactly, offline.** Running
`agreement.mjs` over the 90 recorded runs in `17a-top30-results.json` gives:

| | recorded | computed |
|---|---|---|
| scenarios with a band | 28 of 30 | 28 |
| three-run agreement (1.25× / 1.35×) | 18 | 18 |
| no band | `network-supply-connection-hv-metering`, `switchboard-fault-rating-protection` | the same two |

This is asserted as a test, so a live benchmark that misses those numbers is telling us about
the runs, not about the maths.

**One live scenario reproduces.** `channel-drain`, three runs through the harness runtime:

| | recorded | harness |
|---|---|---|
| status | agreed | agreed |
| runs with a band | 3 of 3 | 3 of 3 |
| low / high ratio | 1.088 / 1.290 | 1.033 / 1.101 |
| consensus | $580–700 /m | $630–770 /m |
| resolved from | qv | qv (all three runs) |
| plan usage | $4.50 | $4.00 |

Status bucket, run count and source of resort match. Consensus is about 9% higher, which is
the expected variation between model runs and is why the exit test asserts buckets and counts
rather than cents.

### Outstanding

The full exit test. One command, about $150 and 75 minutes:

```bash
RESEARCH_QV_INDEX=/path/to/indexed-items.jsonl RUN_CLAUDE_CLI_BENCHMARK=1 \
  npm run research:claude-cli-benchmark
```

It passes on 28 bands, 18 tight, and those two scenarios producing none, and it prints
`EXIT TEST FAILED` plus "the port is wrong — do not proceed to phase 2, and do not tune the
agreement thresholds to fit" otherwise. A partial run (`--scopes`, `--limit`) reports the
comparison and explicitly declines a verdict.

---

## Phase 2 — the role split

**Built and verified structurally. The 30-scope measurement has not been run.**

`roles-runtime.mjs` runs planner → researcher → verifier → synthesiser as **four sequential
CLI calls this code makes**, each with its own prompt and tools, feeding each output to the
next. Not `--agents`: our code is the sequence, so the sequence is guaranteed.

| role | tools | gets |
|---|---|---|
| planner | corpus only | the pinned scope |
| researcher | corpus + WebSearch | scope + plan |
| verifier | corpus + WebSearch | scope + the researcher's components |
| synthesiser | **none** | scope + components + checks |

The synthesiser having no tools is the structural difference from one agent: by the time the
band is written no new evidence can enter, so it can only be built from what was checked. A
failed role stops the sequence rather than letting the synthesiser write a band from unchecked
evidence — that band would otherwise score as a success.

All four roles run on the same model as the baseline by default. A cheaper planner would
probably pay for itself, but phase 2 asks one question, so it changes one thing.

Both runtimes emit the same final cost-band schema and go through the same `cli-call.mjs`, so
`trio.mjs` and `agreement.mjs` score them identically. A comparison where the two sides are
measured differently answers nothing.

### Scoring

Nothing in the comparison asks a model anything. `#101`'s failure — a gate pass rate that
rewarded a laxer reviewer, because the gates were model runs — is not rebuilt here. The
verifier's effect is read off the artifacts: checks by status, and how many of the
researcher's components did not survive into the final band.

The decision rule is in `scripts/research-claude-cli/phase-comparison.mjs` and is written down
**before** either phase runs, so the answer is not chosen after seeing the numbers:

- fewer bands, or worse agreement → one agent wins, whatever else improved
- two or more scenarios better on bands or agreement → four roles win
- the verifier removed components and nothing got worse → four roles win on that narrow ground
- otherwise → one agent, because a tie goes to the simpler structure

Challenges the synthesiser ignored are not a benefit; they are four calls' worth of cost spent
on a note nobody acted on, and the summary reports `runsWithNoChallenge` for exactly that.

### What one live scenario showed

`channel-drain`, three four-role runs, against the same scope phase 1 ran:

| | phase 1 (one agent) | phase 2 (four roles) | recorded |
|---|---|---|---|
| status | agreed | agreed | agreed |
| runs with a band | 3 of 3 | 3 of 3 | 3 of 3 |
| consensus | $630–770 /m | $642–811 /m | $580–700 /m |
| plan usage | $4.00 | $10.88 | $4.50 |
| wall clock | 153 s | 585 s | — |

The sequence works: four calls in order, each fed the previous output, the verifier ran on
every run. It challenged 18 of 26 checked components across the three runs (18 weakened, 0
rejected) and changed nothing on none of them.

**One thing this run corrected in the measurement, before any conclusion was drawn from it.**
The first version counted removed components as a set difference on role names, and reported
"3 dropped" on a run with 8 researcher components and 8 final components — three relabellings,
not three removals, because the synthesiser rewords labels. The verdict rule now uses
`netComponentsRemoved` (rename-immune), and `missingByName` is reported beside it as the upper
bound it always was. A win condition that counted the synthesiser's prose as the verifier's
work would have been the same class of mistake as `#101`'s.

`comparePhases` now also declines to name a winner on a partial run. On one scenario the first
smoke printed "VERDICT: four roles", which is noise wearing a decision's clothes — one
scenario either way is well inside the run-to-run variation these are made of.

Nothing about which structure wins should be read from this. It is one scenario, and it cost
2.7× phase 1 to run.

### Outstanding

```bash
RESEARCH_QV_INDEX=/path/to/indexed-items.jsonl RUN_CLAUDE_CLI_BENCHMARK=1 \
  npm run research:claude-cli-roles-benchmark -- \
    --phase1 .data/research-claude-cli/phase-1-benchmark.json
```

At the smoke's $10.88 per scenario, the full 30 is roughly $330 and about five hours at
concurrency 3 — more than twice phase 1's cost, which is itself a fact the comparison should
weigh.

---

## What is still not true

No quantity surveyor has reviewed any of the 28 bands, and nothing built here changes that.
Three runs agreeing means the scope was specified well enough to reproduce. Every finding
these runtimes produce carries `verification.status: "unverified"` and says in its notes that
nobody has checked it, so a band cannot be read downstream as a settled price.

The 30 pinned scopes were written by a model from a prompt, using two hand-written examples.
The representative cases are assumptions, not a surveyor's judgement.
