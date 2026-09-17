# Research Runtime — Slice 2: minimal Deep Agents adapter

**Date:** 17 September 2026
**Branch:** `feat/research-runtime-slice-2` (based on `main` @ merge of `feat/research-runtime-slice-1`)
**Scope:** the smallest real `ResearchRuntime` implementation over Deep Agents JS, running one agent, in a child process, behind the Eversor-owned boundary slice 1 built. No researcher fan-out, no web search, no RAG, no Qwen/self-hosted inference, no `resume()`.
**Verdict:** `SLICE_2_READY_FOR_REVIEW`

---

## 1. What this slice is

Slice 1 built the seam — provider-neutral contracts, persistence, the runtime registry, a deterministic fake runtime — with no real runtime behind it. This slice puts one real runtime behind that seam: a single Deep Agents agent, executing in a child process, checkpointed, cancellable, and normalized back into the exact same `ResearchRuntime` shape the fake already satisfies. The fake stays as the default and as the regression harness; nothing about the SDLC plane or the existing research contracts changed.

The deliverable is plumbing, not research quality. The agent has two tools (`read_context`, `submit_finding`), no evidence citation (no `fetch_source` exists yet — that is slice 6), and no delegation. What it proves: **Deep Agents can execute behind the Eversor boundary, in an isolated process, cancellably, with checkpointing, without leaking a single LangGraph concept into the domain contracts.**

## 2. Exact package versions

Installed exactly as G3 proved, plus two documented additions (§11.1).

| Package | Version | Source |
|---|---|---|
| `deepagents` | `1.13.4` | G3-proven |
| `@langchain/langgraph` | `1.4.15` | G3-proven |
| `langchain` | `1.5.11` | G3-proven |
| `@langchain/core` | `1.2.11` | G3-proven |
| `langsmith` | `0.9.0` (floating, peer range `>=0.7.1 <0.10.0`) | G3-proven |
| `@langchain/langgraph-sdk` | `1.11.0` (floating) | G3-proven |
| `@langchain/langgraph-checkpoint` | `1.1.5` (floating) | G3-proven |
| `@langchain/langgraph-checkpoint-sqlite` | `1.0.4` (→ `better-sqlite3@12.11.1`, prebuilt, no `node-gyp`) | G3-proven |
| `@langchain/anthropic` | `1.5.10` | **New — §11.1** |
| `@langchain/openai` | `1.5.13` | **New — §11.1** |
| `zod` | `4.6.5` | **New — §11.1** (already a transitive dependency at this exact version) |

`npm install`: 87 packages added, 0 vulnerabilities in the new subtree (`npm audit` reports 2 pre-existing, unrelated vulnerabilities in `browserslist`, transitively required by `@vitejs/plugin-react` — confirmed via `npm ls browserslist`, nothing to do with this dependency set). `better-sqlite3` installed prebuilt for Node v26.8.1 / ABI 147 / darwin-arm64, no compilation, matching G3 exactly.

## 3. Files changed

### New — the adapter (`server/research/deepagents/`)

| File | Purpose | Imports `deepagents`/`langchain`/`@langchain/*`/`langsmith`? |
|---|---|---|
| `worker.mjs` | **CHILD ENTRYPOINT.** The only file in the repository permitted to import them. | Yes — by design |
| `adapter.mjs` | `ResearchRuntime` implementation: spawns the child, parses NDJSON, normalizes events/status/result. | No |
| `child-env.mjs` | The child's environment allowlist/denylist. | No |
| `model-config.mjs` | Adapter-owned model configuration, resolved from environment. | No |
| `event-protocol.mjs` | The NDJSON wire schema shared by adapter and worker. | No |

`tests/research-deepagents-import-containment.test.mjs` checks the "No" column mechanically — it greps every file in the directory except `worker.mjs` for an actual import/require specifier naming these packages, not just prose that mentions them.

### New — tests

| File | Covers |
|---|---|
| `tests/research-deepagents-test-support.mjs` | Shared harness: a safe (credential-free) child env, a throwaway checkpoint DB per test, terminal-state polling. |
| `tests/research-deepagents-adapter.test.mjs` | 10 tests against the real child process and the deterministic fake model — success, checkpoint restart, malformed output, general-purpose rejection, model-call ceiling, cancellation, abnormal exit, LangSmith inactivity, post-failure survival, credential isolation. |
| `tests/research-deepagents-import-containment.test.mjs` | The containment guarantee above, plus a scan of `src/domain/research.ts` and `src/research-runtime-contract.ts` for the same vocabulary. |
| `tests/research-deepagents-live.test.mjs` | **Opt-in, not part of `npm test`.** One real Anthropic call through the full adapter/child stack. Skipped unless `RUN_RESEARCH_DEEPAGENTS_LIVE=1` and `ANTHROPIC_API_KEY` are both present. |

### Modified

| File | Change | Risk |
|---|---|---|
| `server/process-runtime.mjs` | One line: an optional `options.onSpawn(child)` hook, called immediately after `spawn()` succeeds. | Low. Additive, optional, no behavior change for `codex-runtime.mjs`/`claude-runtime.mjs`, which do not pass it. Needed so the adapter can record the child pid without re-implementing spawn/kill. |
| `server/index.mjs` | Two lines: import `DeepAgentsResearchRuntime`; register it alongside `FakeResearchRuntime` in the registry. | Low. `DEFAULT_RESEARCH_RUNTIME_ID` is still `"fake"` (`research-runtime-registry.mjs`, untouched) — a request with no explicit `runtimeId` behaves exactly as before. `deepagents` becomes *selectable*, not default. |
| `package.json` | New dependencies (§2); three new test files added to `npm test`; new `test:research-deepagents-live` script. | Low. |

**Not changed, in any way:** everything slice 1 already listed as untouched (`TaskControlOrchestrator` and all `orchestrator-*.mjs`, `execution-providers.mjs`, every existing route factory, `src/domain/research.ts`, `src/research-runtime-contract.ts`, `src/research-budget-policy.ts`, the schema, the store, the service, the routes, the registry's default id, the fake runtime, every existing test).

## 4. Process architecture

```
Companion process (no deepagents/langchain import anywhere reachable from server/index.mjs)
  ResearchService --start--> registry.resolve("deepagents") --> DeepAgentsResearchRuntime
                                                                       │
                                                    spawn(node, [worker.mjs], {
                                                      cwd: <mkdtemp isolated dir>,
                                                      env: <allowlist + one model credential>,
                                                      input: <JSON config over stdin>,
                                                      signal: <AbortController>,
                                                      timeoutMs: budget.maxRuntimeMs,
                                                    })
                                                                       │
                                                                       ▼
Child process (research-worker.mjs — the only deepagents/langchain importer)
  createDeepAgent({ model, tools: [read_context, submit_finding], backend: StateBackend,
                    checkpointer: SqliteSaver, middleware: [...] })
  agent.invoke(..., { signal, durability: "sync", configurable: { thread_id } })
  → NDJSON on stdout, one message per line
```

`adapter.mjs` reuses `runProcess`/`terminateProcessTree` from `server/process-runtime.mjs` unchanged — the same machinery `codex-runtime.mjs` and `claude-runtime.mjs` already rely on for spawn, stdout budget, timeout and the two-phase SIGTERM→SIGKILL escalation. No second implementation of process control exists anywhere in this slice.

## 5. Child process protocol

One NDJSON message per stdout line (`event-protocol.mjs`), five message types:

| Type | Meaning |
|---|---|
| `research_event` | `{ event, data }` — a lifecycle/tool/finding event the adapter re-emits as a `ResearchEvent` with its own ordinal. |
| `usage` | `{ usage, budgetState }` — the running spend and ceiling-consumption ledgers. |
| `result` | `{ result }` — the final `ResearchResult`-shaped payload, sent whenever the run reaches *any* end state the worker can still describe (success, ceiling breach, cancellation) — not only on a clean finish. |
| `error` | `{ error: { code, message, truncatedBy? } }` — sent whenever something went wrong, alongside a best-effort `result`; the adapter, not the worker, decides whether that makes the run `cancelled` or `failed` (§9). |
| `log` | Free-form diagnostic, surfaced as a `"log"` `ResearchEvent`. |

Anything on stdout that is not valid JSON or not one of these five types is treated as noise (surfaced as a `log` event) rather than corrupting the run — defensive, since a misbehaving dependency writing to stdout would otherwise be indistinguishable from protocol. The worker never uses `console.log`; every line is written through one `send()` function.

`run.started` / `run.completed` / `run.failed` / `run.cancelled` are emitted **by the adapter**, not the worker — the worker reports what happened, the adapter classifies it, which is what keeps "was this cancelled or did it fail" an Eversor decision (§9).

## 6. Adapter lifecycle

`DeepAgentsResearchRuntime` holds one in-memory record per run (mirroring `FakeResearchRuntime`'s shape): emitted events, waiters for the async generator, the `AbortController`, the child pid, the running usage/budget state, and the final result once known.

- **`start(request)`** — ensures the checkpoint directory exists, resolves model config, spawns the child with stdin carrying the full request, returns a handle immediately (`runtimeMetadata: { threadId, checkpointDbPath, childPid }`).
- **`status(runId)`** — a live projection of the in-memory record.
- **`cancel(runId)`** — marks intent, aborts the `AbortController`. `runProcess`'s existing abort handling does the rest (§9).
- **`events(runId, cursor)`** — an async generator over the locally emitted event list, exactly like the fake.
- **`result(runId)`** — throws until the run is closed; afterward always returns *something*, even for a run that never produced a worker `result` message (e.g. a structural startup failure), so a reader never has to distinguish "no result" from "result not fetched yet."

The child's exit is the single place terminal state is decided (`#handleExit`): cancel-requested wins over everything else, then a spawn-level error (timeout, process failure), then a non-zero exit code, then a worker-reported `error`, then a missing `result`, and only if none of those apply, `completed`.

## 7. Model configuration

Behind the adapter (`model-config.mjs`), resolved from environment at `start()` time, never touching the neutral contract:

1. `RESEARCH_MODEL_PROVIDER=openai-compatible` (or `OPENAI_API_KEY` present with no explicit provider) — `ChatOpenAI` with a configurable `baseURL`, defaulting to `https://api.openai.com/v1`. This is the exact shape a later self-hosted/Qwen endpoint plugs into, per the architecture's §8.2.
2. `RESEARCH_MODEL_PROVIDER=anthropic` (or `ANTHROPIC_API_KEY` present with no explicit provider) — `ChatAnthropic`. **This is the path exercised for the slice's live execution proof**, because `ANTHROPIC_API_KEY` is already an approved credential in this environment and no new account or key was needed.
3. Neither — a deterministic in-process fake model (`FakeToolCallingModel`, in `worker.mjs`), no network, no key. **Every test in the main suite runs on this path**, regardless of what the host's real environment carries (`tests/research-deepagents-test-support.mjs` constructs each test runtime with a minimal, credential-free env).

The resolved config crosses into the child as a plain JSON object over stdin (`provider`, `model`, `baseURL?`, `apiKeyEnvVar`) — the API key itself never enters that JSON; it reaches the child only as an environment variable under the fixed name `RESEARCH_MODEL_API_KEY`, never under the provider's own conventional name (`child-env.mjs` denylists `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` from the child even when the *value* came from one of them).

No model identifier reaches `src/domain/research.ts`.

## 8. Checkpoint / thread handling

- **Separate file:** `.data/research-checkpoints.sqlite3` (adapter-configurable, defaults there). Eversor never opens it.
- **Thread id:** `deepagents:<runId>`, stored only in `runtimeMetadata` (opaque, per slice 1's contract).
- **Checkpointer:** the official `@langchain/langgraph-checkpoint-sqlite` `SqliteSaver`, in the child only, `durability: "sync"` on `invoke()`.

**Proven, not assumed** (`tests/research-deepagents-adapter.test.mjs`, "a checkpoint is created and survives a fresh process reading it back"): after the child that ran a request has exited, a **new** `SqliteSaver` instance opened against the same file, in the test process, retrieves a non-empty checkpoint tuple for that thread. Manually verified once more outside the test harness for good measure:

```
$ node server/research/deepagents/worker.mjs < config.json   # child runs, exits
$ node -e "SqliteSaver.fromConnString(path).getTuple({configurable:{thread_id}})"
checkpoint found: true
checkpoint id: 1f1b2366-1d2a-6951-8010-91e486b288be
message count in channel_values: 4
```

This is thread-level restart durability, the same thing G3 demonstrated — not proof of genuine mid-node continuation. `resume()` remains absent from `ResearchRuntime`; nothing here changes that (§14, `R6` in slice 1).

`ResearchRunRecord` carries no checkpoint or thread concept — confirmed both by the compile-time blocklist in `src/research-runtime-contract.ts` (unchanged, still passing) and by the import-containment test scanning that file's source text directly.

## 9. Cancellation — proof of the complete path

```
ResearchService.cancel(runId)                  [persists status='cancelling' first — slice 1, unchanged]
  → registry.resolve("deepagents").cancel(runId)
    → DeepAgentsResearchRuntime.cancel(runId): run.controller.abort()
      → runProcess's existing abort handler: SIGTERM → wait 2s → SIGKILL → wait 3s
        (server/process-runtime.mjs, unchanged — the same escalation
         codex-runtime.mjs and claude-runtime.mjs already rely on)
      → worker.mjs's SIGTERM handler aborts its own AbortController, which is
        merged (`AbortSignal.any`) into the signal passed to agent.invoke()
        — graceful, when the child gets to run it
  → adapter's #handleExit sees cancelRequested=true → status becomes "cancelled"
```

Tested against a **genuinely running** child (`tests/research-deepagents-adapter.test.mjs`, "cancellation while the child is genuinely running..."): the fake model is given a 6-second artificial delay so the process is provably alive (`process.kill(pid, 0)` succeeds) before `cancel()` is called, and the test asserts the *process* is actually gone afterward (`process.kill(pid, 0)` throws), not merely that the promise resolved — the exact discipline the architecture calls for given LangGraph JS's own open questions about abort reliability (R3). Measured: cancellation reaches `"cancelled"` in ~2 seconds, consistent with the 2-second SIGTERM grace window before SIGKILL — in this run the graceful path did not finish in time (the fake model's artificial delay does not itself observe the abort signal, unlike a real provider call, which `invoke()`'s `signal` option does reach) and the forceful escalation is what actually ended it. That is exactly the R3 risk stated plainly: **reliable cancellation depends on killing the process, not on the library behaving**, and this slice's test asserts the outcome that matters.

Partial usage is preserved on a cancelled run (`usage.partial: true`, never `usage: null` — the audit §12 gap slice 1 already refused to repeat, held here too).

## 10. Normalized event mapping

| Deep Agents / LangGraph activity | `ResearchEvent.type` |
|---|---|
| Adapter starts the child | `run.started` |
| Worker begins the graph invoke | `phase.started` |
| A tool executes (`read_context`, `submit_finding`) | `tool.called` |
| `submit_finding` succeeds | `finding.created` |
| The worker reports its running usage | `usage.updated` |
| The graph invoke returns or throws | `phase.completed` |
| A hard ceiling was hit | `budget.ceiling_hit` |
| Adapter classifies the child's exit | `run.completed` / `run.failed` / `run.cancelled` |
| Anything else (diagnostics, unparseable stdout) | `log` |

No raw LangGraph event (`values`/`updates`/`debug`/`messages`/`tasks`/`checkpoints` stream modes) is exposed; the worker does not even use LangGraph's streaming API — it invokes once and reports through the fixed NDJSON schema above. `worker.started`/`worker.completed`/`worker.failed`/`source.retrieved`/`artifact.created` from the full vocabulary are not emitted in this slice — there is exactly one worker (not fan-out) and no source-fetching tool yet, so nothing would be true about them.

## 11. Usage mapping

`summarizeMessages()` in `worker.mjs` walks the checkpointed message list after the invoke settles (successfully, by ceiling, or by abort) and sums `usage_metadata` off every `AIMessage`, bucketed `byModel` by `response_metadata.model_name`. This works identically whether the model is the fake, `ChatAnthropic`, or `ChatOpenAI`, because all three attach `usage_metadata` the same way at the `@langchain/core` message level — the adapter never has to special-case a provider.

**Live-proven** (`tests/research-deepagents-live.test.mjs`, run manually with `RUN_RESEARCH_DEEPAGENTS_LIVE=1`): a real Anthropic call reported `modelCalls: 3`, `inputTokens: 10027`, `outputTokens: 258`, `byModel["claude-haiku-4-5-20251001"].priced: false`. `priced: false` is correct and intentional — `server/model-catalog.mjs`'s rate card is untouched by this slice (cost accounting is slice 5's job per the architecture), so an unpriced model reads as unpriced, never as free, exactly as slice 1's contract requires.

Usage is preserved as `partial: true` on every non-`completed` terminal state — ceiling breach, cancellation, or structural failure — carrying whatever was tallied before the run stopped, never discarded.

## 12. Security / environment boundary

| Control | Implementation | Verified how |
|---|---|---|
| No host filesystem | `backend: new StateBackend()` — the only backend constructed anywhere in this slice | Manual: the child's `cwd` is an isolated `mkdtemp` directory that is never referenced by the agent; `LocalShellBackend`/`FilesystemBackend`/`ContextHubBackend` are never imported |
| No shell | `execute`/`LocalShellBackend` never constructed | Static: not present in `worker.mjs` |
| No general-purpose subagent | `createSubAgentMiddleware({ generalPurposeAgent: false, subagents: [] })`, present even though zero subagents are configured | **Test**, "the general-purpose subagent is rejected even with zero subagents configured" — a scripted fake-model tool call for `subagent_type: "general-purpose"` throws `invoked agent of type general-purpose, the only allowed types are` (the empty list), matching G3's finding exactly |
| No researcher fan-out | No `task` tool ever succeeds (previous row); no `subagents` array populated | Same test |
| No web access | No search/fetch tool exists in this slice's tool set (`read_context`, `submit_finding` only) | Static: `worker.mjs`'s tool list |
| No arbitrary MCP | Not wired up; nothing in this slice references MCP | Static |
| Explicit env allowlist | `child-env.mjs`: a narrow allowlist (`PATH`, `HOME`, locale/cert vars) plus exactly one model credential under a fixed name, with a denylist re-applied *after* that injection as well as before | **Test**, "model configuration never reaches the child under the provider's own env var name" — `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` set on the companion side never appear in the child even with the fake provider selected |
| Isolated working directory | `mkdtemp` per run, removed on exit | Manual + code path (`adapter.mjs` `#handleExit`) |
| Process-tree termination on cancellation | Reuses `terminateProcessTree`/`runProcess`, unchanged | §9 |
| Parent detects abnormal child exit | `#handleExit` inspects exit code/signal | **Test**, "an abnormal child exit becomes a normalized research failure" |
| Child failure never reaches the SDLC companion | `ResearchService`'s existing `#consume()` try/catch (slice 1, unchanged) plus this adapter never throwing out of its promise chain | **Test**, "Eversor survives a Deep Agents child failure" |

## 13. LangSmith inactivity — proof

Three layers, matching the architecture's own three-layer confidence:

1. **Structural.** `child-env.mjs`'s `CHILD_ENV_DENYLIST` includes every `LANGSMITH_*`/`LANGCHAIN_*` variable the architecture names, deleted from the child environment both before and after the one credential injection, so a future code change cannot silently reorder past it.
2. **From inside the child.** `worker.mjs` reports, as its very first action before touching any config, how many `LANGSMITH_*`/`LANGCHAIN_*` variables it can see in its own `process.env` — not what the adapter *intended* to send, what actually arrived. Test: "LangSmith stays inactive..." deliberately puts real-looking `LANGSMITH_API_KEY`/`LANGSMITH_TRACING`/`LANGCHAIN_TRACING_V2` values into the *companion's* environment for that one test, and asserts the child's own self-report reads zero.
3. **G3's own network-sentinel result** (`RESEARCH-RUNTIME-G3-COMPATIBILITY.md` §5) already demonstrated zero outbound network attempts across four Deep Agents scenarios with these variables absent, at these exact package versions. This slice does not repeat that experiment (it would require patching `fetch`/`http`/`https` inside the child process, which the NDJSON-over-stdout design deliberately makes more awkward to instrument than G3's standalone scripts) — it relies on G3's result holding for the same versions, and adds the env-shape guarantee on top.

## 14. Budgets

| Ceiling | Enforced how in this slice | Demonstrated |
|---|---|---|
| `maxModelCalls` (hard) | `modelCallLimitMiddleware({ runLimit, exitBehavior: "error" })` | **Yes** — "the model-call ceiling invalidates the run..." |
| `maxRuntimeMs` (hard) | Two independent clocks: `runProcess`'s `timeoutMs` (parent) and `AbortSignal.timeout()` merged into the child's own invoke signal | Mechanism reused unchanged from `codex-runtime.mjs`/`claude-runtime.mjs`; not separately re-demonstrated here beyond G3's `AbortSignal` result — the cancellation test exercises the same abort path via `cancel()` instead of a real timeout, to keep the test suite fast |
| Cancellation | `AbortController` → `runProcess` → `terminateProcessTree` | **Yes** — §9 |
| `maxToolCalls` | `toolCallLimitMiddleware` applied per tool name (`read_context`, `submit_finding`), each capped at `budget.maxToolCalls` | Exercised incidentally by the malformed-output test (2 tool calls counted); not independently ceiling-tested in this slice — see §16 |
| `maxResearchers` / `maxConcurrentResearchers` / `maxDepth` | **Not exercised.** There is exactly one agent and no subagent capability at all (`generalPurposeAgent: false, subagents: []`), so there is nothing for a fan-out or depth ceiling to bound yet | Per the task's own instruction not to pretend researcher/search ceilings are exercised before the capability exists |
| `maxSearchCalls` | **Not exercised.** No search tool exists in this slice | Same reason |
| `maxUsd` / `maxTokens` (soft) | Not wired in this slice; `ResearchService`'s existing `researchSoftOverruns()` (slice 1) still runs but has nothing model-priced to compare against for an unpriced fake/Anthropic-without-rate-card model | Deferred to slice 5 alongside cost accounting, per the architecture |

## 15. Test / failure results

```
$ npm test
ℹ tests 573   ℹ pass 573   ℹ fail 0

$ npx tsc --noEmit
(clean)

$ npm run lint
Checked 514 files in 211ms. No fixes applied.

$ npm run format:check
1 pre-existing diagnostic in src/frontier/world-3d/ProofCamera.tsx — present before this
slice, not touched by it (same status slice 1 recorded)

$ npm run test:frontier
ℹ tests 122  ℹ pass 122  ℹ fail 0

$ npm run test:frontier-api
ℹ tests 18   ℹ pass 18   ℹ fail 0

$ RUN_RESEARCH_DEEPAGENTS_LIVE=1 npm run test:research-deepagents-live
ℹ tests 1    ℹ pass 1    ℹ fail 0   (real Anthropic call, run manually, not part of CI)
```

The eight failure experiments the task asked for, and where each lives:

| # | Experiment | Result |
|---|---|---|
| 1 | Successful Deep Agents run | `research-deepagents-adapter.test.mjs`, "a successful Deep Agents run..." — and live, §11 |
| 2 | Model/provider error | Covered structurally by "an abnormal child exit..." (bad checkpoint path fails before any model call) and by the live test's credential-absent path (`worker_startup_failed` when a real provider is selected without a key — manually verified, §16) |
| 3 | Child process abnormal exit | "an abnormal child exit becomes a normalized research failure" |
| 4 | Cancellation while running | "cancellation while the child is genuinely running..." |
| 5 | Malformed model output | "malformed tool output is rejected at the tool boundary and the model recovers" |
| 6 | Checkpoint storage failure | Same test as #3 — pointing the checkpoint path at an existing directory fails `SqliteSaver` construction inside the child's own startup, which is exactly a checkpoint storage failure |
| 7 | LangSmith configuration absent | "LangSmith stays inactive..." |
| 8 | Eversor survives child failure | "Eversor survives a Deep Agents child failure..." |

## 16. Architecture deviations

| # | Deviation | Why |
|---|---|---|
| D1 | Added `@langchain/anthropic@1.5.10` and `@langchain/openai@1.5.13`, beyond G3's exact dependency list. | G3 scoped its install to the graph engine only; it never needed a chat-model integration package because its scripts used a hand-written `FakeToolCallingModel`. The architecture's own §8.2 code sample already names `ChatOpenAI`. Slice 2 needs an actual model to prove a live execution (task §11.1), and `@langchain/anthropic` is the one real, already-credentialed provider available in this environment; `@langchain/openai` proves the OpenAI-compatible shape the architecture calls for without requiring a second live account (exercised via the `openai-compatible` provider branch, unit-testable against a local mock endpoint in a later slice if that becomes load-bearing). |
| D2 | Added `zod@4.6.5` as a direct dependency, pinned to the version already resolved transitively through `langchain`. | `worker.mjs`'s two tool schemas use `langchain`'s `tool()` helper, which expects a zod schema — the standard, documented way to define a LangChain tool. Declaring it directly rather than relying on an undeclared transitive dependency is ordinary hygiene, not a new capability. |
| D3 | Checkpointing (the official SQLite checkpointer, restart durability) is pulled forward from slice 3 into this slice. | The task's own slice-2 specification explicitly asks for it (§6: "checkpoints survive child-process restart"), ahead of `RESEARCH-RUNTIME-ARCHITECTURE.md`'s slice map, which put it in slice 3. G3 already proved the SQLite checkpointer installs prebuilt and survives restart at both the raw-checkpoint and full-thread level, so there was no unproven ground to cross. `resume()` still does **not** exist on `ResearchRuntime` — this slice proves *persistence*, not *mid-node continuation*, exactly the distinction the architecture insists on (R6, unchanged). |
| D4 | `maxToolCalls` is enforced identically for both tool names (`read_context`, `submit_finding`) rather than a single shared ceiling across all Eversor-authored tools. | `toolCallLimitMiddleware` ceilings are per tool name; a single shared counter across tool names would need a hand-rolled counter, which the architecture reserves for the fan-out ceiling specifically (§9.1: "the in-tool counter remains the real enforcement" for *that* ceiling). For two low-risk, read/append-only tools, two independent ceilings at the same limit is the smallest correct approximation, documented rather than silently assumed. |
| D5 | The worker classifies an aborted/timed-out `agent.invoke()` uniformly, without knowing whether the abort came from an operator cancel or a budget timeout; the **adapter** (via `run.cancelRequested`) is what actually decides `cancelled` vs. `failed`. | This keeps the classification decision on the Eversor side of the pipe, matching §9's ownership split, and means the wire protocol does not need a "why were you aborted" field the worker would have to get right. |
| D6 | `maxRuntimeMs` is not independently ceiling-tested in the automated suite (only exercised through `cancel()`'s abort path). | A dedicated timeout test would need either a real multi-second sleep (slow, flaky under load) or mocking `AbortSignal.timeout`, and the mechanism itself (`runProcess`'s `timeoutMs`, `terminateProcessTree`) is unchanged, already-tested infrastructure reused from `codex-runtime.mjs`/`claude-runtime.mjs`. Flagged here rather than silently skipped. |

## 17. Unresolved risks

1. **Orphan child reaping across a companion restart is still open.** Slice 1's unresolved question 2 ("a run that is `running` when the companion dies stays `running` forever") is unchanged by this slice: the child pid is now recorded in `runtimeMetadata`, but nothing reaps it on companion startup. This is now a real, not theoretical, cost — a Deep Agents child is long-lived and holds a real model-call budget. Belongs before this runtime is used for anything unattended.
2. **`maxRuntimeMs`'s two-clock design is unverified under real load** in this slice — both clocks exist and are wired, but the only automated proof of the cancellation path uses an explicit `cancel()` call, not a genuine timeout race between the parent's `runProcess` timer and the child's own `AbortSignal.timeout()`. Worth a dedicated (slower) test before this ceiling is relied on operationally.
3. **`toolCallLimitMiddleware`'s per-tool-name ceiling (D4) has not been adversarially tested** the way the model-call ceiling has — no test scripts a model into exceeding `maxToolCalls` specifically. Low risk at one agent with two harmless tools; becomes load-bearing again exactly when slice 4 adds `fetch_source`/`web_search`.
4. **R3 (LangGraph JS abort reliability under genuine mid-flight work) is still not directly exercised.** The cancellation test's forceful path (SIGKILL) is what actually ended the run in this slice's test run; whether the graceful path (`AbortSignal` reaching a real, in-flight provider call rather than an artificial `setTimeout`) would have resolved faster is unverified here — it was proven for a *pre-aborted* signal in G3, not for an abort arriving mid-call.
5. **Usage fidelity across providers (R7 from slice 1) is observed for exactly one real provider** (Anthropic) in this slice. The OpenAI-compatible path's `usage_metadata` fidelity is unverified — no live test exercises it, per §11.1's own reasoning for not requiring a second paid account this slice.
6. **The `.data/research-checkpoints.sqlite3` file is never pruned.** Same unbounded-growth flag the architecture raised for source snapshots (§7.4); now has an actual file behind it.

## 18. The exact seam for slice 3 bounded subagents

Nothing about this adapter needs to change shape — only what it constructs inside `worker.mjs`:

```diff
  const agent = createDeepAgent({
    model,
    systemPrompt: "...",
-   tools: [readContextTool, submitFindingTool],
+   tools: [readContextTool, submitFindingTool, /* fetchSourceTool, webSearchTool — slice 6 */],
    backend: new StateBackend(),
    checkpointer,
    middleware: [
-     createSubAgentMiddleware({ generalPurposeAgent: false, subagents: [] }),
+     createSubAgentMiddleware({
+       generalPurposeAgent: false,
+       defaultModel: researcherModel,
+       subagents: researcherSubagents, // ≤3, named, no `task` tool of their own
+     }),
      modelCallLimitMiddleware({ runLimit: config.budget.maxModelCalls, exitBehavior: "error" }),
-     toolCallLimitMiddleware({ toolName: "read_context", runLimit: ..., exitBehavior: "continue" }),
-     toolCallLimitMiddleware({ toolName: "submit_finding", runLimit: ..., exitBehavior: "continue" }),
+     toolCallLimitMiddleware({ toolName: "task", runLimit: config.budget.maxResearchers, exitBehavior: "continue" }),
+     // ...per-tool ceilings unchanged
    ],
  });
```

Everything else — the NDJSON protocol, the adapter's event/status/result normalization, the checkpoint file, the cancellation path, the env allowlist, the model-config resolution — is unaffected, because none of it encodes "one agent" as an assumption; it encodes "one child process, one thread." `event-protocol.mjs` already has `worker.started`/`worker.completed`/`worker.failed` reserved in the full `ResearchEventType` vocabulary (slice 1) for exactly this.

---

## Explicit answers

**1. Can the Deep Agents adapter be deleted without changing Eversor research domain tables?**
Yes. `server/research/deepagents/` is five files; deleting the directory and the two-line registration in `server/index.mjs` removes the runtime entirely. No table, column or index added by this slice — none were; slice 1's schema is unchanged. `research_runs.runtime_metadata_json` already existed and is opaque.

**2. Can another managed research provider implement the same `ResearchRuntime`?**
Yes, unchanged from slice 1's answer — this slice adds no new requirement to the interface. A managed-API adapter still only needs to implement five methods over JSON-shaped types and put its own correlation id in `runtimeMetadata`.

**3. Does child-process failure leave the SDLC companion healthy?**
Yes, demonstrated: "Eversor survives a Deep Agents child failure" runs a request that fails structurally (bad checkpoint path) and immediately runs a second, independent request to completion on the same runtime instance, in the same process, with no restart. `ResearchService`'s pre-existing isolation from the orchestrator (slice 1, unchanged) means this was never wired to the SDLC plane in the first place.

**4. Is checkpoint state clearly separate from Eversor-owned research state?**
Yes. Separate SQLite file (`.data/research-checkpoints.sqlite3` vs. `.data/tasks.sqlite3`), opened by nothing Eversor-owned, referenced only by an opaque path string in `runtimeMetadata`. `ResearchRunRecord` — what every route actually returns — carries no checkpoint or thread field, confirmed by the unchanged compile-time blocklist in `src/research-runtime-contract.ts` and by this slice's own import-containment test scanning that file's text.

**5. Did any LangGraph/Deep Agents concept leak into the public contract?**
No new leak; `src/domain/research.ts` was not touched by this slice. The import-containment test now also greps that file (and `src/research-runtime-contract.ts`) for the restricted vocabulary as a standing guard, not only at review time.

**6. Is the adapter ready for bounded subagent fan-out?**
Structurally, yes — §18 shows the exact, small diff. Operationally, not yet: `maxToolCalls`/ceiling-adversarial testing for a fan-out scenario, the orphan-reaping gap (§17.1), and R3's mid-flight-abort question are all still open and are exactly what slice 4's own exit criteria (per the architecture) already call for before bounded subagents ship.

---

`SLICE_2_READY_FOR_REVIEW`
