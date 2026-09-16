# Research Runtime — Slice 1: provider-neutral foundation

**Date:** 17 September 2026
**Branch:** `feat/research-runtime-slice-1` (based on `origin/main` @ `e6f783c`)
**Scope:** slice 1 of `RESEARCH-RUNTIME-ARCHITECTURE.md` rev 2 — Eversor-owned contracts, persistence, registry, deterministic fake runtime, API. **No Deep Agents, LangGraph, LangChain or LangSmith dependency was added, and none is imported anywhere.**
**Verdict:** `SLICE_1_READY_FOR_REVIEW`

---

## 1. What this slice is

An Eversor-owned research foundation that a future runtime plugs into. The deliverable is the *seam*, not a research capability: the only runtime that exists is a deterministic fake, and it exists so the lifecycle, the persistence and the API can be proved before a real runtime is allowed near them.

Everything the architecture marks as runtime-owned — graph state, saved checkpoints, subagent composition, model calls, web tools — is absent by design.

## 2. Files added

| File | Purpose |
|---|---|
| `src/domain/research.ts` | The provider-neutral contracts (§4.2 of the architecture). Types only. |
| `src/research-runtime-contract.ts` | Runtime-checkable constants and guards, plus the compile-time assertions that keep the contracts neutral. |
| `src/research-budget-policy.ts` | Profile → `ResearchBudget`, override resolution, ceiling/overrun reporting. Shared by server and UI. |
| `server/research/research-schema.mjs` | The six research tables. Additive DDL. |
| `server/research/research-store.mjs` | Eversor-owned persistence over the shared SQLite handle. |
| `server/research/research-runtime-registry.mjs` | `resolve(id)` plus a contract shape check. |
| `server/research/fake-research-runtime.mjs` | Deterministic `ResearchRuntime`, advanced one step at a time. |
| `server/research/research-service.mjs` | Lifecycle, validation, event ingestion, terminal reconciliation, cancellation ordering. |
| `server/research/research-routes.mjs` | Route factory for `/api/research/*`. |
| `tests/research-test-support.mjs` | Throwaway migrated database + manually clocked service. |
| `tests/research-contracts.test.mjs` | Contract neutrality, registry, budget policy. |
| `tests/research-fake-runtime.test.mjs` | The three lifecycles, budget delivery, start failure. |
| `tests/research-store.test.mjs` | Schema additivity, restart round-trip, revisions, event paging, evidence rows, cascade. |
| `tests/research-routes.test.mjs` | API lifecycle, cancellation, SDLC isolation, validation, absent-service behaviour. |

## 3. Files changed

Four, all additive, 11 net lines of production change outside `server/research/`:

| File | Change |
|---|---|
| `server/sqlite-storage.mjs` | `DATABASE_SCHEMA_VERSION` 3 → 4; one call to `createResearchSchema(db)`. No existing table, column or index is touched. |
| `server/sqlite-store.mjs` | New `databaseHandle()` accessor so the research plane shares one file, one lock, one transaction boundary. |
| `server/api.mjs` | Optional `researchService` parameter; one route-factory construction; one dispatch line. |
| `server/index.mjs` | Construct the store/registry/service for the SQLite companion; cancel in-flight runs during `shutdown()`. |
| `package.json` | Four research test files added to `npm test`. |

**Not changed, in any way:** `TaskControlOrchestrator` and every `orchestrator-*.mjs`, `execution-providers.mjs`, `codex-runtime.mjs`, `claude-runtime.mjs`, every existing route factory, every existing test. No new `RuntimeTaskStatus`, no new stage id, no new `POLICY_IDS` entry, no new member of `VALID_WORKFLOWS`.

## 4. Final public contracts

`src/domain/research.ts`. The runtime interface:

```ts
export interface ResearchRuntime {
  readonly id: string;
  start(request: ResearchRequest, signal?: AbortSignal): Promise<ResearchRunHandle>;
  status(runId: string): Promise<ResearchRunStatus>;
  cancel(runId: string): Promise<void>;
  events(runId: string, cursor?: string): AsyncIterable<ResearchEvent>;
  result(runId: string): Promise<ResearchResult>;
}
```

Types defined: `ResearchRequest`, `ResearchBudget`, `ResearchHardCeiling`, `ResearchProfile`, `ResearchContextRef`, `ResearchRunHandle`, `ResearchRunState`, `ResearchRunStatus`, `ResearchRunProgress`, `ResearchRunError`, `ResearchBudgetState`, `ResearchUsage`, `ResearchEvent`, `ResearchEventType`, `ResearchResult`, `ResearchFinding`, `ResearchRole`, `EvidenceRef`, `EvidenceLocator`, `EvidenceSourceType`, `ResearchArtifact`, `ResearchRunRecord`.

Three properties worth calling out:

- **Resumption is absent.** Not optional — absent. `assertResearchRuntime()` *rejects* a runtime that offers `resume()`, so the method cannot arrive before the evidence for it does (risk R6).
- **`runtimeMetadata` is the only place a runtime may keep correlation data**, it is `Readonly<Record<string, string>>` so nothing structured can be smuggled through it, and it is **not** part of `ResearchRunRecord` — the projection every route returns. An adapter reads it through `ResearchStore.runtimeMetadata(runId)`.
- **Three separate ledgers.** `ResearchBudget` is the configured ceiling, `ResearchBudgetState` is the observed consumption, `ResearchUsage` is the spend. `ceilingHit` and `ResearchResult.truncatedBy` mark a bounded result; `softOverruns` marks a soft limit that was passed rather than enforced, so the two are never confused.

### Budget policy

| Profile | researchers | concurrent | depth | runtime | model calls | search calls | tool calls |
|---|---|---|---|---|---|---|---|
| quick | 2 | 2 | 1 | 5 min | 30 | 20 | 60 |
| standard | 3 (from 5) | 3 | 1 | 20 min | 100 | 60 | 180 |
| deep | 3 (from 8) | 3 (from 4) | 1 | 45 min | 200 | 120 | 360 |

`SPIKE_MAX_RESEARCHERS = 3` clamps every profile. An override on a request may only **lower** a ceiling; a request cannot buy itself more budget than its profile allows.

## 5. Persistence additions

Schema version **4**. Six new tables, created through `createResearchSchema()` inside the existing `migrateSqliteSchema()`, in the existing `.data/tasks.sqlite3`:

`research_runs`, `research_events`, `research_sources`, `research_findings`, `research_evidence`, `research_artifacts`, plus their six indexes.

Design points:

- **Claims and evidence are rows, not a blob.** Audit §10 names the missing claim → source → locator → verification chain as a core gap; nesting it inside a run payload would reproduce the gap in a new table.
- **Events are append-only with a store-assigned ordinal.** The runtime proposes an ordinal; the store assigns the real one, so a runtime cannot renumber the stream a UI is paging through.
- **Runs carry `revision`** and every update is guarded by it, the same optimistic-concurrency shape `tasks` uses.
- **`cancellation_requested_at`** persists the operator's intent separately from `status`, so it survives the transition to `cancelled` and a companion restart in between.
- **One connection.** `ResearchStore` takes `SqliteTaskStore.databaseHandle()`. Every transaction on either side runs to COMMIT synchronously, so the two can never interleave on the event loop.

No checkpoint table, no runtime state table, no vector store, no queue.

## 6. API additions

All under `/api/research`, behind the same loopback + CSRF boundary `assertHttpBoundary` applies before any route factory runs.

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/research/runtimes` | `{ runtimes: ["fake"] }` |
| `POST` | `/api/research/runs` | Validate, resolve budget, persist, start. `201 { run }` |
| `GET` | `/api/research/runs` | `{ runs }`, newest first |
| `GET` | `/api/research/runs/:id` | `{ run }` or `404` |
| `POST` | `/api/research/runs/:id/cancel` | `{ run }` at `cancelling`, or terminal unchanged |
| `GET` | `/api/research/runs/:id/events?cursor&limit` | `{ events, nextCursor }` |
| `GET` | `/api/research/runs/:id/sources` | `{ sources }` |
| `GET` | `/api/research/runs/:id/result` | `{ result, status }`, or `409` while the run is still going |

Without a `researchService`, the routes do not exist and those paths 404 — which is exactly what the JSON-store companion and every pre-existing API test see.

## 7. Fake runtime lifecycle

Deterministic and **not instant**: a run advances one step at a time, because a runtime that finishes inside `start()` cannot prove cancellation works. Tests call `advance()`; the companion lets a 5 ms unref'd timer do it.

```
success   queued → running → [worker × min(3, maxResearchers)] → completed
failure   queued → running → failed          { code: "fake_runtime_failure", … }
cancel    queued → running → cancelling → cancelled
```

- **Budget delivery is demonstrated, not asserted.** The fake planner always wants three sub-questions. Under `quick` (`maxResearchers: 2`) it runs **two**, emits `budget.ceiling_hit`, and sets `truncatedBy: "maxResearchers"`. It also echoes the resolved budget in a `log` event, so a test can compare what crossed the boundary against what was persisted.
- **Usage is deterministic**: 1 planner call + 2 per worker + 1 synthesiser. A full `standard` run reports `modelCalls: 8`, split across `fake-planner` / `fake-researcher` / `fake-synthesiser` with `priced: false` on each — an unpriced model reads as unpriced, never as free.
- **Failure and cancellation keep their spend.** `usage.partial: true`, never `usage: null`. That is the audit §12 gap, not repeated.
- **Cancellation keeps partial findings.** A run cancelled after one worker still yields that worker's finding and a populated `unresolvedQuestions`.

### Ordering the service enforces

1. **Persist before signalling.** `cancel()` writes `status = 'cancelling'` and `cancellationRequestedAt` *before* the runtime is told anything.
2. **Terminal state is written last, and never from an event.** A `run.completed` event arrives before the result rows exist. The service takes terminal state only from the reconciliation pass, after `recordResult()` has committed — so a reader who sees `completed` always finds a result behind it.
3. **A runtime that cannot start still leaves a durable row**, at `failed` with `runtime_start_failed`.

## 8. Tests

23 new assertions-bearing tests across four files, all four registered in `npm test`.

| Required proof | Test |
|---|---|
| 1. Request can be created | `a research run can be created, watched, and read back through the API` |
| 2. Fake resolves through the abstraction | `the fake runtime resolves through the runtime abstraction` |
| 3. Success reaches completed | `a successful run walks queued -> running -> completed and persists its result` |
| 4. Failure reaches failed | `a failing run reaches failed with normalized error information and partial usage` |
| 5. Cancellation reaches cancelled | `a cancelled run walks running -> cancelling -> cancelled and keeps the operator's intent` |
| 6. Status persisted and recoverable | `a research run round-trips through SQLite with its budget unchanged` (closes and reopens the database) |
| 7. Normalized usage persisted | success, failure and cancellation tests all assert `usage` including `partial` |
| 8. Result/findings/evidence retrievable | `claims, evidence and sources are separate rows, not a blob`; API `result` and `sources` |
| 9. No runtime data in public contracts | `no runtime vocabulary leaks into the public research contracts` + the compile-time assertions |
| 10. Existing SDLC tests green | `npm test` — 558 pass |
| 11. Cannot reserve/start SDLC work | `a research run cannot reserve or start SDLC work` |
| 12. Budget survives persistence unchanged | `a research run round-trips through SQLite with its budget unchanged` |

Compile-time tests live in `src/research-runtime-contract.ts` and run under `npm run typecheck`:

- `ResearchUnionsAreExhaustive` — every member of `ResearchProfile`, `ResearchRunState` and `ResearchEventType` is listed in the runtime constant, in both directions.
- `ResearchContractsAreRuntimeNeutral` — no contract type may carry a key from a blocklist of runtime vocabulary (`thread`, `threadId`, `checkpointer`, `graph`, `messages`, `subagents`, `middleware`, `backend`, …).
- `ResearchRuntimeHasNoResume` — the interface has no `resume`.

The blocklist earned its place immediately: it caught `toolCalls` on `ResearchUsage`, which turned out to be a legitimate neutral *count* rather than a model payload. The exemption is recorded in the file next to the list.

## 9. Commands and results

```
$ node --version && npm --version
v26.8.1
11.19.0

$ npx tsc --noEmit
(clean)

$ npm run lint
Checked 501 files in 184ms. No fixes applied.

$ node --test tests/research-contracts.test.mjs tests/research-fake-runtime.test.mjs \
             tests/research-routes.test.mjs tests/research-store.test.mjs
ℹ tests 23   ℹ pass 23   ℹ fail 0   ℹ duration_ms 192.450417

$ npm test
ℹ tests 558  ℹ pass 558  ℹ fail 0   ℹ duration_ms 15469.651625

$ npm run test:frontier
ℹ tests 111  ℹ pass 111  ℹ fail 0

$ npm run test:frontier-api
ℹ tests 18   ℹ pass 18   ℹ fail 0
```

`npm run format:check` reports one pre-existing diagnostic in `src/frontier/world-3d/ProofCamera.tsx`, which this slice does not touch and did not introduce.

## 10. Deviations from architecture revision 2

| # | Deviation | Why |
|---|---|---|
| D1 | `research_sources.content_sha256` and `content_bytes` are **nullable**; the architecture has `content_sha256 NOT NULL`. | Host-side snapshots are slice 6. `NOT NULL` would force a fabricated hash for content no file holds. The column is present and the contract's `snapshotRef` is optional, so slice 6 fills both without a migration. |
| D2 | `research_evidence` gains `ordinal` and `snapshot_ref`; `research_runs` gains `budget_state_json` and `cancellation_requested_at`. | Stable evidence ordering, a forward slot for the snapshot reference, an observed-consumption ledger distinct from spend, and durable cancellation intent (§9.4 layer 1). All additive. |
| D3 | A fourth file is touched: `server/sqlite-store.mjs` gains `databaseHandle()`. The architecture named three extension points. | The architecture requires the research store to run "over the existing `DatabaseSync` handle", and the handle was private. Eight lines, no behaviour change. |
| D4 | `ResearchBudgetState.softOverruns` was added to the contract. | §9.2 distinguishes soft overruns from hard truncation but rev 2 gave the distinction nowhere to live. Without it an overrun would have to be reported as `ceilingHit`, which would read as a hard stop. |
| D5 | `maxToolCalls` is derived as `maxSearchCalls × 3`. | The §9.3 profile table does not give a tool-call ceiling. Three tool calls per permitted search lets a researcher fetch, read and submit around each search without the tool ceiling binding before the search ceiling does. |
| D6 | `createApiServer` takes `researchService` as an **optional** parameter rather than always constructing the plane. | Keeps every existing API test, and the JSON-store companion, on exactly their current behaviour: the paths 404 instead of existing in a degraded form. |

No architectural decision changed. Process boundary, persistence split, the LangSmith stance and the runtime recommendation are untouched by this slice, because this slice contains no runtime.

## 11. Review questions

**1. Could a future managed research API implement this interface without knowing anything about Deep Agents?**
Yes. The interface is five methods over JSON-shaped types. A managed API adapter would poll its own endpoint, map its events onto `ResearchEventType`, and put its job id in `runtimeMetadata`. Nothing in the contract assumes a graph, a local process, a checkpoint, a tool protocol or a message format. The one thing it must accept is the budget object — and accepting a ceiling it cannot enforce is a legitimate implementation answer, which is why `ResearchBudgetState` reports what actually happened rather than trusting what was configured.

**2. Could Deep Agents be removed after slice 2 without a database migration of core Eversor research concepts?**
Yes. No table, column or index names a runtime. The only runtime-touched column is `research_runs.runtime_metadata_json`, which is opaque, nullable, and absent from every projection. Dropping a runtime means deleting an adapter file and a registry entry; the runs, events, claims, evidence, sources and artifacts all still read back, and `ResearchStore.getResult()` reconstructs the deliverable from rows without consulting anything runtime-shaped. `runtime_id` remains as a historical label, which is a fact about the run, not a dependency.

**3. Did any runtime concept accidentally leak into the contract?**
Not that either half of the check can find. The compile-time blocklist covers the contract types; the runtime test scans `src/domain/research.ts` for runtime vocabulary including in comments — it caught two comments in my own first draft that named LangGraph and Deep Agents while explaining that they must not be named, and both were rewritten. `runtimeMetadata` is the deliberate, bounded exception: flat strings, adapter-only access, not in `ResearchRunRecord`. The registry additionally refuses a runtime that exposes `resume()`.

**4. Did the implementation alter existing SDLC execution?**
No. No orchestrator file, execution provider or existing route factory was edited. The four touched files gain additive DDL, an accessor, an optional parameter and a shutdown participant. All 558 tests in `npm test`, all 111 frontier tests and all 18 frontier-API tests pass unchanged. `a research run cannot reserve or start SDLC work` asserts the negative directly: after a completed research run the task list is empty, the worktree inventory is empty, and a request carrying `workflow` or `repositoryPath` is rejected with a 400 rather than quietly ignored.

**5. Did we create infrastructure that belongs in the external runtime instead?**
Reviewed each piece. Budget policy, run identity, the event ledger, claim/evidence rows and cancellation intent are Eversor's by the §3 ownership matrix — a runtime that owned any of them could not be swapped. The one judgement call is the event ordinal: the store assigns it rather than trusting the runtime's. That is deliberate, because a UI cursor must not be renumberable by a runtime. Nothing here reimplements planning, delegation, context control, tool calling or checkpointing — the four things §1 of the architecture says Eversor should stop building. The fake runtime's step machinery is a test double living behind the interface, not infrastructure in front of it.

## 12. Unresolved questions

1. **Event retention.** `research_events` grows without bound and nothing prunes it. The task plane has `retainRunActivityEvents`; research has no equivalent yet. Needs a policy before a long run is routine, not before slice 2.
2. **Restart recovery.** A run that is `running` when the companion dies stays `running` forever: the consumer loop is process-local and slice 1 has no reaping pass. `SqliteTaskStore.recoverInterrupted()` is the model to follow. It belongs with slice 2, where a real child process makes an orphan run actually expensive.
3. **`maxConcurrentResearchers` has no enforcement point yet**, because there is nothing concurrent to bound. It is carried and persisted; slice 4 attaches it.
4. **Cost estimation is not wired.** `estimatedCostUsd` and `priced` exist in the contract and the fake reports `priced: false`. Connecting `server/model-catalog.mjs` waits for a runtime that reports real model ids (slice 5).
5. **R6 remains open** from G3: whether a runtime resumes mid-execution or re-executes. That is what keeps `resume()` out, and slice 3 answers it.

## 13. Where the Deep Agents adapter attaches in slice 2

Exactly one seam, and nothing else changes:

```js
// server/research/deepagents/adapter.mjs  — new in slice 2
export class DeepAgentsResearchRuntime {   // implements ResearchRuntime
  get id() { return "deepagents"; }
  async start(request, signal) { /* spawn worker.mjs, return handle + runtimeMetadata */ }
  async status(runId) { /* normalized ResearchRunStatus */ }
  async cancel(runId) { /* SIGTERM, then terminateProcessTree */ }
  async *events(runId, cursor) { /* NDJSON on child stdout → ResearchEvent */ }
  async result(runId) { /* normalized ResearchResult */ }
}
```

```diff
  // server/index.mjs
- registry: createResearchRuntimeRegistry([new FakeResearchRuntime()]),
+ registry: createResearchRuntimeRegistry([new FakeResearchRuntime(), new DeepAgentsResearchRuntime()]),
```

Then `POST /api/research/runs` with `runtimeId: "deepagents"` routes to it. The store, the service, the routes, the schema and the contracts need no change; the fake stays as the regression harness that proves they did not.

What slice 2 must add on top of that: `server/research/deepagents/worker.mjs` as the **only** file in the repository permitted to import `deepagents`, `langchain`, `@langchain/*` or `langsmith`, and a test that asserts that containment mechanically. Plus the orphan-run reaping in unresolved question 2, which stops being theoretical once a child process is involved.

---

`SLICE_1_READY_FOR_REVIEW`
