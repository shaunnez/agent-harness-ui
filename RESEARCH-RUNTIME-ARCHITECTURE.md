# Research Runtime Architecture — Deep Agents JS as First Candidate

**Author role:** principal architect (Prompt 1, `research-agent-deepagents-spike-pack/prompts/01-ARCHITECT-DEEP-AGENTS.md`)
**Date:** 16 September 2026
**Repository baseline:** `agent-harness-ui` @ `main` (`6773f41`), working tree as inspected on 16 September 2026
**Audit baseline consumed:** `HARNESS-RESEARCH-AUDIT.md` (audited `0f877a90`)
**Status:** design only. No production code was modified.
**Revision:** rev 2, 16 September 2026 — amended with the results of gate G3 (`RESEARCH-RUNTIME-G3-COMPATIBILITY.md`, verdict `G3_PASS_WITH_CHANGES`). Changes in this revision: §8.1/§8.4 subagent composition corrected, §9.1 ceilings marked demonstrated and `exitBehavior` policy set, §10.2 tool-isolation model corrected, §7.2/§13 R5 downgraded and the hand-written checkpointer struck, §6 dependency-weight argument withdrawn. **No decision changed** — process boundary, persistence split, LangSmith stance and runtime recommendation all stand.

---

## 0. Evidence standard and a note on the spike pack

Everything labelled **VERIFIED** below was checked by reading repository source or the current published package metadata / type declarations / official docs. Everything labelled **INFERRED** is a reasoned conclusion that the spike must confirm empirically. Everything labelled **UNVERIFIED** is a claim I could not ground and which must not be designed against.

Rev 2 adds a fourth and stronger label: **DEMONSTRATED** means gate G3 executed code that exercised the behaviour — typically by scripting a model to breach a limit and observing the failure. A demonstrated claim outranks a verified one, because "the option exists in the type declarations" and "the option stops the thing it claims to stop" turned out to be different questions in two places (§8.4, §10.2).

External facts were taken from the npm registry and from the published `.d.ts` of the exact versions named, not from memory. Where the prose docs and the type declarations disagreed, the type declarations win.

**Spike-pack location discrepancy.** The instruction referenced `research-agent-deepagents-spike-pack/`, which did not exist in this repository. The repository contained an older, superseded pack, `research-agent-spike-pack/`, whose premise is *DeepSeek Harness first* — the opposite runtime choice. The intended pack was found at `~/Downloads/research-agent-deepagents-spike-pack` and `~/projects/eversor-plancheck/research-agent-deepagents-spike-pack` (byte-identical copies) and has been copied to the repository root so the path references in this document resolve. **Recommendation: delete `research-agent-spike-pack/` before it is read as current direction.** Both packs are untracked; neither is production code.

---

## 1. Decision summary

**Deep Agents JS should proceed to spike — behind an Eversor-owned `ResearchRuntime` boundary, in a child process, with Eversor enforcing every ceiling that matters.**

### Why yes

1. **It removes the work Eversor should not do.** The audit's five gaps (§9) include persistent sessions, working memory, context control and subagent lifecycle. `deepagents@1.13.4` ships all of these as public, MIT-licensed, typed API: `createSubAgentMiddleware`, `createFilesystemMiddleware`, `createSummarizationMiddleware`, pluggable backends, and LangGraph checkpointing. Building these in-house is explicitly a non-goal (`01-GOALS-AND-GUARDRAILS.md`).
2. **Per-role model tiering is a first-class field, not a workaround.** `SubAgent.model?: LanguageModelLike | string` (VERIFIED in `deepagents@1.13.4` type declarations). The target topology — frontier planner, cheap researchers, frontier verifier/synthesiser — is directly expressible. This is the single most important economic requirement and it is satisfied natively.
3. **The current harness genuinely cannot do this.** Audit §4 is unambiguous: scout fan-out caps at 3, packages require Git ownership and repository verification, `providerForModelId()` rejects anything that is not `gpt-*` or `claude-*`, and there is no HTTP model adapter. The requested topology is "not supported as-is". This is a capability gap, not a configuration gap.
4. **The boundary is cheap.** Research does not touch `TaskControlOrchestrator`. It is a new, parallel, additive surface: new tables, one route factory, one adapter. The SDLC orchestrator is untouched by construction, not by discipline.

### Why with conditions

Deep Agents' own README states its trust model plainly: *"Deep Agents follows a 'trust the LLM' model. The agent can do anything its tools allow. Enforce boundaries at the tool/sandbox level, not by expecting the model to self-police."* (VERIFIED.) That is honest and it is also the whole design constraint.

Concretely, and this is the finding that shapes sections 9 and 10:

> **`SubAgentMiddlewareOptions` has no `maxConcurrency`, no `maxDepth`, and no `maxSubagentCalls` field.** (VERIFIED against the published type declarations: the interface is exactly `defaultModel`, `defaultTools`, `defaultMiddleware`, `generalPurposeMiddleware`, `defaultInterruptOn`, `subagents`, `systemPrompt`, `generalPurposeAgent`, `taskDescription`, `parentSystemPrompt`.)

Fan-out width and delegation depth are therefore **model discretion by default**. Guardrail 5 ("worker count, depth and runtime have enforceable ceilings") is not satisfied out of the box. It *can* be satisfied technically — section 9 shows how, using three independent mechanisms — but the architecture must do that work deliberately and the adversarial review must check it.

**G3 update (16 Sep 2026).** This has now been tested rather than reasoned about. See `RESEARCH-RUNTIME-G3-COMPATIBILITY.md`. Every ceiling in §9.1 was demonstrated enforcing against a model scripted to breach it, so guardrail 5 is met — but two composition details in this document were wrong and are corrected below:

- `createDeepAgent({ subagents })` silently admits a working `general-purpose` worker, so the shorthand **does not** meet the fan-out ceiling. Bounded fan-out requires `createSubAgentMiddleware({ generalPurposeAgent: false })` (§8.1, §8.4).
- `tools: []` does **not** strip middleware-provided filesystem tools. The tool boundary is the backend plus the middleware set, not the `tools` array (§10.2).

### What we are explicitly *not* deciding

This does not select a production research runtime. Deep Agents JS is arm A of the evaluation plan. The managed-research-API arm (B) and the existing-frontier-approach arm (C) remain live, and the `ResearchRuntime` interface exists precisely so that the answer can be "buy, not build" without a refactor.

### Recommendation summary

| Question | Answer |
|---|---|
| Proceed to spike? | **Yes** — §14 gates G1, G2, G4, G5 remain; **G3 satisfied** |
| Process boundary | **Child process, one per run** — fault isolation, cancellation control, security boundary, protecting the SDLC companion |
| LangSmith required? | **No** — the `langsmith` *package* is a mandatory peer dependency, but G3 recorded zero network attempts with tracing env unset |
| Checkpointing | `MemorySaver` + `durability:"exit"` for slices 1–2; official `@langchain/langgraph-checkpoint-sqlite` in the child from slice 3 — **installs prebuilt on Node 26, restart-durable (G3)** |
| Worker ceiling | `createSubAgentMiddleware({ generalPurposeAgent: false })` + `toolCallLimitMiddleware({ toolName: "task", runLimit: N, exitBehavior: "continue" })` |
| `resume()` | **Not implemented** until slice 3 demonstrates genuine *mid-node* continuation; thread-level restart already demonstrated |

---

## 2. Architecture

### 2.1 Current state (unchanged by this design)

```mermaid
flowchart LR
  subgraph Browser
    UI["src/App.tsx<br/>src/frontier/"]
  end
  subgraph Companion["Node companion · 127.0.0.1:4310 · single process"]
    API["server/api.mjs<br/>route factories"]
    ORCH["TaskOrchestrator<br/>orchestrator-*.mjs"]
    PROV["execution-providers.mjs<br/>codex · claude"]
    STORE[("SqliteTaskStore<br/>.data/tasks.sqlite3<br/>node:sqlite DatabaseSync")]
  end
  CLI["codex / claude CLI<br/>child processes"]
  GIT["git worktrees · gh"]

  UI -->|"poll + JSON"| API
  API --> ORCH
  API --> STORE
  ORCH --> PROV --> CLI
  ORCH --> GIT
  ORCH --> STORE
```

### 2.2 Target state

Everything in the existing diagram stays exactly as it is. The research plane is additive and shares only the HTTP listener, the database file and the process lock.

```mermaid
flowchart TB
  subgraph Browser
    UI["Existing UI"]
    RUI["Research views<br/>(new, polling)"]
  end

  subgraph Companion["Node companion process — no LangChain loaded here"]
    API["server/api.mjs"]
    subgraph SDLC["SDLC plane — UNTOUCHED"]
      ORCH["TaskControlOrchestrator<br/>+ all orchestrator-*.mjs"]
      PROV["execution-providers.mjs"]
    end
    subgraph RPLANE["Research plane — NEW"]
      RROUTES["research-routes.mjs"]
      RSVC["ResearchService<br/>lifecycle · budget ceilings · policy"]
      RREG["runtime registry<br/>fake | deepagents"]
      RIFACE{{"ResearchRuntime<br/>Eversor-owned boundary"}}
      RSTORE["ResearchStore"]
    end
    DB[("tasks.sqlite3<br/>+ research_* tables<br/>NEW TABLES ONLY")]
  end

  subgraph Child["Child process — one per run — research-worker.mjs"]
    ADP["Deep Agents adapter"]
    DA["createDeepAgent()<br/>compiled LangGraph graph"]
    SUB["subagents: planner · researcher×N · verifier · synthesiser"]
    MW["modelCallLimit · toolCallLimit<br/>summarization · StateBackend"]
    CP[("LangGraph checkpointer<br/>research-checkpoints.sqlite3<br/>SEPARATE FILE")]
  end

  TOOLS["Eversor-authored tools<br/>web_search · fetch_source<br/>read_context · submit_finding"]
  SNAP[(".data/research-sources/&lt;sha256&gt;<br/>immutable source snapshots")]
  MODELS["frontier: Claude/OpenAI API<br/>cheap: OpenAI-compatible baseURL"]

  UI --> API
  RUI -->|poll| API
  API --> ORCH
  API --> RROUTES --> RSVC
  RSVC --> RREG --> RIFACE
  RSVC --> RSTORE --> DB
  ORCH --> DB
  RIFACE -->|"spawn · NDJSON stdout · SIGTERM"| ADP
  ADP --> DA --> SUB
  DA --> MW
  DA --> CP
  SUB --> TOOLS
  TOOLS --> SNAP
  TOOLS -.->|"evidence rows"| DB
  SUB --> MODELS

  classDef untouched fill:#eef,stroke:#88a
  classDef new fill:#efe,stroke:#8a8
  class SDLC,ORCH,PROV untouched
  class RPLANE,RROUTES,RSVC,RREG,RIFACE,RSTORE,RUI new
```

**The load-bearing property of this diagram:** no LangChain, LangGraph or `deepagents` import ever executes inside the companion process. The companion spawns a child and parses NDJSON — the same shape it already uses for `codex` and `claude`.

---

## 3. Ownership matrix

Owners: **Eversor** · **DA/LG** (Deep Agents / LangGraph) · **Model** (model provider) · **Search** (search/fetch provider) · **Infra**.

| Concern | Owner | Mechanism | Notes |
|---|---|---|---|
| Research run identity (`runId`) | Eversor | `research_runs.id`, `RSCH-…` | Never a `tasks` row. Avoids inheriting repository/candidate semantics (audit §17.4). |
| Graph / thread identity | DA/LG | `thread_id` in child config | **Adapter metadata only.** Stored in `research_runs.runtime_metadata_json`, never in a domain type. |
| Checkpoint state | DA/LG | checkpointer, separate DB file | Eversor never reads or interprets it. |
| Subagent lifecycle | DA/LG | `createSubAgentMiddleware`, `task` tool | Spawn/execute/collect. |
| Subagent **count and depth ceilings** | **Eversor** | §9 — three independent mechanisms | **Not DA/LG.** No such option exists. This is the key split. |
| Working files | DA/LG | `StateBackend` (in-state, thread-scoped) | Ephemeral. No host filesystem in the spike. |
| Context control / compaction | DA/LG | `createSummarizationMiddleware` | Non-goal to rebuild. |
| Retry (tool-level) | DA/LG | `toolRetryMiddleware` | Backoff, jitter. |
| Retry (run-level) | Eversor | operator re-submits a new `ResearchRequest` | Mirrors existing SDLC retry authority. |
| Cost accounting | Eversor | `usage_metadata` → `enrichUsage`/`priceUsage` | Reuses `server/model-catalog.mjs`. Requires new rate-card entries for open models. |
| Budget ceilings | Eversor | §9 | Hard for count/depth/time/calls; soft for USD/tokens. |
| Source evidence + snapshots | **Eversor** | `fetch_source` tool writes `.data/research-sources/<sha256>` | Host-side, content-addressed, model cannot forge. |
| Claim↔evidence binding | **Eversor** | `submit_finding` verifies quote ⊂ snapshot | Technical, not prompted. See §10.3. |
| Final result | Eversor | `research_findings` / `research_artifacts` | The deliverable. |
| Cancellation intent | Eversor | `research_runs.status='cancelling'` + SIGTERM | Persisted intent survives companion restart. |
| Cancellation execution | Eversor + DA/LG | `terminateProcessTree` + in-child `AbortSignal` | Belt and braces. See §9.4. |
| Tool permissions | **Eversor** | explicit `tools[]`, `FilesystemPermission[]`, `StateBackend` | Never delegated. |
| Auth / secrets | Eversor + Infra | child-process env allowlist | Mirrors `execution-providers.mjs` pattern. |
| Model inference | Model | API endpoints | — |
| Search / fetch | Search | provider API | Untrusted output by definition. |
| Runtime selection | Eversor | registry | The replaceability guarantee. |

---

## 4. Provider-neutral contracts

`02-TARGET-INTERFACES.md` is close to correct. Six refinements, each driven by something found in the repository or in the Deep Agents type declarations.

### 4.1 Refinements

**(a) `resume()` must not exist yet.** The pack already warns about this. I am going further: the optional method should be *absent from the interface* until slice 3 proves genuine continuation. An optional method that no implementation provides is a promise the store and UI will start coding against. Add it in the slice that earns it.

**(b) Split `runtimeMetadata` out of the handle.** `ResearchRunHandle.runtimeThreadId?: string` puts a LangGraph concept in a neutral contract — exactly what guardrail 3 forbids. Replace with an opaque `runtimeMetadata?: Readonly<Record<string, string>>` that Eversor persists and never interprets.

**(c) `ResearchUsage` needs a hard/soft distinction.** Audit §12 shows the existing harness cannot support a strict spend ledger, and §4 notes failed runs are finished with `usage: null`, so spent work vanishes from totals. Research must not repeat that. Add `partial: boolean` and always record usage on failure.

**(d) Evidence needs an integrity field.** Guardrail 7 requires exact supporting evidence be *retainable*. A URL is not retention — the page changes. `EvidenceRef` gains `snapshotRef` (content-addressed) and `quoteVerified: boolean`.

**(e) `ResearchEvent` needs an ordinal.** The existing UI polls monotonic version markers (`projectTaskPollState`); a `string` id alone cannot drive a cursor. Add `ordinal: number`.

**(f) Budget needs `maxConcurrentResearchers` separate from `maxResearchers`.** Total count and simultaneous count are different ceilings with different costs (host load vs. spend). The audit's §6 finding — no global model-run admission limit — is exactly the failure mode of conflating them.

### 4.2 Refined contracts

Target path: `src/domain/research.ts` — a `.ts` file under `src/`, because **VERIFIED**: `server/*.mjs` already imports `../src/*.ts` directly (nine call sites, e.g. `server/action-policy.mjs:4` imports `../src/workflow-recovery-policy.ts`), running on Node 26 native type stripping. This is the established idiom for shared policy/contract code and needs no new build step.

```ts
// src/domain/research.ts
// Provider-neutral. No LangChain, LangGraph or deepagents type may appear in this file.

export interface ResearchRuntime {
  readonly id: string;
  start(request: ResearchRequest, signal?: AbortSignal): Promise<ResearchRunHandle>;
  status(runId: string): Promise<ResearchRunStatus>;
  cancel(runId: string): Promise<void>;
  events(runId: string, cursor?: string): AsyncIterable<ResearchEvent>;
  result(runId: string): Promise<ResearchResult>;
  // resume() is deliberately absent. Add only when slice 3 demonstrates genuine
  // checkpoint continuation, and name it for what it does.
}

export interface ResearchRequest {
  id: string;
  objective: string;
  profile: ResearchProfile;
  context: ResearchContextRef[];
  constraints?: Record<string, unknown>;
  budget: ResearchBudget;
  outputSchema?: Record<string, unknown>;
  metadata?: Record<string, string>;
}

export type ResearchProfile = "quick" | "standard" | "deep";

export interface ResearchBudget {
  // Hard-enforceable (see §9.1).
  maxResearchers: number;
  maxConcurrentResearchers: number;
  maxDepth: number;
  maxRuntimeMs: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxSearchCalls: number;
  // Soft — post-hoc, may overshoot by at most one model call per in-flight branch (§9.2).
  maxUsd?: number;
  maxTokens?: number;
}

export type ResearchRunState =
  | "queued" | "running" | "awaiting_approval"
  | "cancelling" | "cancelled" | "failed" | "completed";

export interface ResearchRunHandle {
  runId: string;
  runtimeId: string;
  status: ResearchRunState;
  startedAt: string;
  /** Opaque adapter-owned identifiers (LangGraph thread id, child pid, …).
   *  Eversor persists this and never interprets it. */
  runtimeMetadata?: Readonly<Record<string, string>>;
}

export interface ResearchRunStatus {
  runId: string;
  status: ResearchRunState;
  usage: ResearchUsage;
  progress?: {
    phase?: string;
    completedWorkers?: number;
    activeWorkers?: number;
    totalWorkers?: number;
  };
  budgetState?: {
    modelCallsUsed: number;
    toolCallsUsed: number;
    searchCallsUsed: number;
    researchersStarted: number;
    elapsedMs: number;
    ceilingHit?: keyof ResearchBudget;
  };
  error?: { code?: string; message: string };
}

export interface ResearchUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  modelCalls?: number;
  toolCalls?: number;
  searchCalls?: number;
  estimatedCostUsd?: number;
  /** True when a failure or cancellation means some spend is unaccounted for.
   *  Never silently omit spend the way the SDLC failure path does today. */
  partial: boolean;
  byModel?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    modelCalls?: number;
    estimatedCostUsd?: number;
    /** False when no rate card exists for this model id. */
    priced: boolean;
  }>;
}

export type ResearchEventType =
  | "run.started" | "run.completed" | "run.failed" | "run.cancelled"
  | "phase.started" | "phase.completed"
  | "worker.started" | "worker.completed" | "worker.failed"
  | "tool.called" | "source.retrieved" | "finding.created"
  | "budget.ceiling_hit" | "usage.updated" | "artifact.created" | "log";

export interface ResearchEvent {
  id: string;
  /** Monotonic within a run. Drives the polling cursor. */
  ordinal: number;
  runId: string;
  timestamp: string;
  type: ResearchEventType;
  data: unknown;
}

export interface ResearchResult {
  runId: string;
  summary?: string;
  findings: ResearchFinding[];
  artifacts: ResearchArtifact[];
  usage: ResearchUsage;
  unresolvedQuestions?: string[];
  /** Populated when the run stopped because a ceiling was reached, so a partial
   *  result is never mistaken for a complete one. */
  truncatedBy?: keyof ResearchBudget;
}

export interface ResearchFinding {
  id: string;
  claim: string;
  evidence: EvidenceRef[];
  assumptions?: string[];
  contradictions?: string[];
  confidence?: number;
  /** Which conceptual role produced it. Not a model id. */
  producedBy: "planner" | "researcher" | "verifier" | "synthesiser";
  verification?: {
    status: "unverified" | "supported" | "weakened" | "rejected";
    notes?: string;
  };
}

export interface EvidenceRef {
  sourceId: string;
  sourceType: "web" | "project_document" | "internal_record" | "other";
  url?: string;
  title?: string;
  retrievedAt: string;
  locator?: {
    page?: number;
    section?: string;
    lineStart?: number;
    lineEnd?: number;
    selector?: string;
    charStart?: number;
    charEnd?: number;
  };
  excerpt?: string;
  /** Content-addressed reference to the retained snapshot. Without this a
   *  citation is an assertion, not evidence. */
  snapshotRef?: string;
  /** Host verified `excerpt` is a literal substring of the snapshot (§10.3).
   *  A finding whose quote fails verification is rejected by the tool. */
  quoteVerified: boolean;
  authority?: "primary" | "secondary" | "unknown";
}

export interface ResearchArtifact {
  id: string;
  kind: string;
  name: string;
  contentRef: string;
}

export interface ResearchContextRef {
  type: string;
  id: string;
}
```

---

## 5. Repository integration map

### 5.1 Untouched (the guarantee)

No edit of any kind, in any slice:

`server/orchestrator.mjs`, `orchestrator-core.mjs`, `orchestrator-task-control.mjs`, `orchestrator-run-coordinator.mjs`, `orchestrator-investigation.mjs`, `orchestrator-work-packages.mjs`, `orchestrator-repair-execution.mjs`, `orchestrator-retention.mjs`, `orchestrator-gates.mjs`, `orchestrator-gate-evaluation.mjs`, `orchestrator-candidate-operations.mjs`, `orchestrator-pr-lifecycle.mjs`, `orchestrator-specification-planning.mjs`, `orchestrator-plan-authority.mjs`, `orchestrator-repair-authority.mjs`, `orchestrator-retained-package.mjs`, `orchestrator-merge-recovery.mjs`, `orchestrator-runtime-base.mjs`, `orchestrator-runtime-boundaries.mjs`, `orchestrator-stage-support.mjs`, `orchestrator-task-helpers.mjs`, `orchestrator-run-policy.mjs`, `orchestrator-prototype-design.mjs`
`server/prompts.mjs`, `scouts.mjs`, `structured-output.mjs`
`server/execution-providers.mjs`, `codex-runtime.mjs`, `claude-runtime.mjs`, `claude-exec-budget.mjs`
`server/verification.mjs`, `verification-concurrency.mjs`, `git-worktree.mjs`, `github-pull-request.mjs`, `repository-authority.mjs`, `candidate-lineage-validation.mjs`
`server/task-creation-routes.mjs`, `task-action-routes.mjs`, `task-lifecycle-routes.mjs`, `retained-evidence-routes.mjs`, `runtime-settings-routes.mjs`, `project-routes.mjs`, `companion-chat.mjs`
`server/effective-policy.mjs`, `policy-defaults.mjs`, `role-policy-eligibility.mjs`, `task-policy-snapshot.mjs`, `workflow-profiles.mjs`, `action-policy.mjs`, `retry-*.mjs`, `gate-policies.mjs`, `candidate-gate-policy.mjs`, `package-qualification-policy.mjs`
`src/domain/runtime.ts`, `src/runtime-activity.ts`, `src/workflow-recovery-policy.ts`
All existing files under `tests/`.

Research introduces **no new `RuntimeTask` status, no new stage id, no new `POLICY_IDS` entry, and no new workflow value in `VALID_WORKFLOWS`**. If a slice needs one of those, the boundary has been drawn wrong — stop and revisit.

### 5.2 Reuse (imported unchanged)

| Module | What research reuses it for |
|---|---|
| `server/process-runtime.mjs` | `runProcess`, `terminateProcessTree`, `waitForClose`, `ProcessTimeoutError`, `STDOUT_LIMIT`. VERIFIED exports. Cancellation already handles process groups and Windows task trees with 2s→SIGKILL→3s escalation — the hardest part of §9.4 is already written and tested. |
| `server/model-catalog.mjs` | `priceUsage`, `priceModelUsage`, `enrichUsage`, `normalizeModelId`, `validatePricingRates`, `MODEL_PRICING`. Cost estimation without a second pricing implementation. |
| `server/task-projections.mjs` | `encodePageCursor`, `decodePageCursor`, `normalizePageLimit`. Identical pagination idiom for research events. |
| `server/http-security.mjs` | `assertHttpBoundary`, `corsHeaders` — applied by `api.mjs` before routing, so research routes inherit the CSRF/Origin boundary for free. |
| `server/runtime-lock.mjs`, `exclusive-file-lock.mjs` | Unchanged. The existing single-companion guarantee already covers the research plane. |

### 5.3 Extend (additive only, three files)

| File | Change | Risk |
|---|---|---|
| `server/sqlite-storage.mjs` | Add six `CREATE TABLE IF NOT EXISTS` statements and their indexes to `migrateSqliteSchema()`; bump `DATABASE_SCHEMA_VERSION` 3 → 4. **No existing table, column or index is altered.** | Low. Idempotent DDL in the established pattern. |
| `server/api.mjs` | Two lines: construct `createResearchRoutes({...})`, and one `if (await researchRoutes(request, response, url)) return;` in the dispatch chain. | Low. The dispatch chain is already a list of route factories (VERIFIED, `api.mjs` ~line 265). |
| `server/index.mjs` | Construct `ResearchStore` + runtime registry after `store.init()`; pass to `createApiServer`; add research shutdown to the existing `Promise.allSettled` in `shutdown()`. | Low–medium. `shutdown()` must cancel in-flight research children or they outlive the companion — see risk R4. |

### 5.4 New modules

```
src/domain/research.ts                        neutral contracts (§4.2)
src/research-budget-policy.ts                 profile → ResearchBudget; validation; shared with UI

server/research/research-store.mjs            ResearchStore over the existing DatabaseSync handle
server/research/research-service.mjs          lifecycle, ceilings, event ingestion, cost normalisation
server/research/research-runtime-registry.mjs resolveResearchRuntime(id) — mirrors execution-providers.mjs
server/research/fake-research-runtime.mjs     deterministic; slice 1; the regression harness
server/research/research-routes.mjs           createResearchRoutes(...) — route factory
server/research/source-snapshot-store.mjs     content-addressed snapshots under .data/research-sources/
server/research/evidence-verification.mjs     quote ⊂ snapshot check (§10.3)

server/research/deepagents/adapter.mjs        ResearchRuntime impl: spawn, NDJSON, normalise, cancel
server/research/deepagents/worker.mjs         CHILD ENTRYPOINT — the only file that imports deepagents
server/research/deepagents/graph.mjs          createDeepAgent config: subagents, middleware, backend
server/research/deepagents/tools.mjs          web_search · fetch_source · read_context · submit_finding
server/research/deepagents/model-routing.mjs  role → model; OpenAI-compatible endpoint config
server/research/deepagents/event-protocol.mjs NDJSON schema — SHARED by adapter and worker

tests/research-contracts.test.mjs
tests/research-fake-runtime.test.mjs
tests/research-store.test.mjs
tests/research-routes.test.mjs
tests/research-budget-enforcement.test.mjs
tests/research-evidence-verification.test.mjs
tests/research-deepagents-adapter.test.mjs    (slice 2+)
```

**`worker.mjs` is the containment boundary.** It is the only file in the repository permitted to import `deepagents`, `langchain`, `@langchain/*`, or `langsmith`. A lint rule or a test asserting this should land in slice 2 — it is the mechanical guarantee behind guardrail 3, and it is cheap.

---

## 6. Process boundary

### Recommendation: **child process, one per research run.**

| Option | Verdict |
|---|---|
| **In current Node process** | **No.** Audit §17.2: a companion crash loses all in-memory promise and controller state and may require manual lock intervention. A multi-hour research graph — unbounded model output, large fetched documents, third-party execution we do not control — must not be able to OOM or wedge the process that owns the SDLC pipeline and the exclusive database lock. In-process also forfeits the process-tree kill that makes cancellation reliable (§9.4), and it puts untrusted-content processing inside the same address space as the SDLC plane's credentials and store handle. |
| **Worker thread** | **No.** Shares the heap and therefore shares the OOM. Buys concurrency, not isolation. |
| **Separate long-lived local HTTP service** | **Not yet.** Adds a second listener, its own auth surface, its own lifecycle, its own lock, its own deployment story. Buys nothing over a child process for a single-host spike, and the audit is clear the platform has no service-authentication model to reuse (§13). Revisit if and when research becomes multi-tenant. |
| **Child process per run** ✅ | **Yes**, on four grounds: **fault isolation** (the child's OOM or crash kills one run, not the companion); **cancellation control** (reuses `terminateProcessTree`, already proven for process groups and Windows task trees, so a wedged graph still dies — see R3); **security boundary** (untrusted web content is processed in a separate address space under an explicit env allowlist); and **protecting the SDLC companion** from long-running research failures, which is the asset with the least tolerance for collateral damage. Event transport is NDJSON on stdout — structurally identical to what `codex-runtime.mjs` and `claude-runtime.mjs` already do, so it fits the codebase's grain rather than fighting it. |

**Dependency weight is not a reason.** An earlier draft argued the companion should stay free of the LangChain tree. G3 measured it: **47 packages, zero native, zero install scripts** for the main set. That is modest, and the argument is withdrawn. The four grounds above carry the decision on their own.

### Costs of the choice, stated plainly

1. **Events must be serialised.** Mitigated: NDJSON with a shared schema module (`event-protocol.mjs`) used by both sides, so the two ends cannot drift silently.
2. **~200–600 ms child startup per run.** Irrelevant against multi-minute research runs.
3. **A killed child cannot flush its final checkpoint.** Mitigated: SIGTERM first (in-child `AbortSignal` → graceful stop → checkpoint flush → exit), SIGKILL only after the existing escalation window.
4. **Companion death orphans children.** This is a pre-existing property (audit §6: "Detached children are not guaranteed dead after abrupt parent termination"; "No persisted child-PID reclamation protocol found"). Research makes it more visible because research children are long-lived. **Slice 1 must persist the child pid in `research_runs.runtime_metadata_json` and reap orphans on startup** — a small piece of infrastructure the SDLC plane lacks and that research genuinely needs. See R4.

---

## 7. Persistence design

Four stores, deliberately separate, with a one-line rule for each.

### 7.1 Eversor research metadata — `.data/tasks.sqlite3`, new tables

Same database file: one lock, one backup unit, one transaction boundary, no second engine. Additive DDL in `migrateSqliteSchema()`, `DATABASE_SCHEMA_VERSION` 3 → 4.

```sql
CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  profile TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  request_json TEXT NOT NULL,       -- ResearchRequest as submitted
  budget_json TEXT NOT NULL,        -- resolved ceilings
  usage_json TEXT,                  -- normalized ResearchUsage
  runtime_metadata_json TEXT,       -- OPAQUE: thread id, child pid. Never interpreted.
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS research_events (
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY,              -- sourceId
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  url TEXT,
  title TEXT,
  retrieved_at TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,     -- -> .data/research-sources/<sha256>
  content_bytes INTEGER NOT NULL,
  media_type TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS research_findings (
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  produced_by TEXT NOT NULL,
  claim TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS research_evidence (
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL,
  id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  locator_json TEXT,
  excerpt TEXT,
  quote_verified INTEGER NOT NULL,  -- 0/1, set by the host, never by the model
  authority TEXT,
  PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS research_artifacts (
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  content_ref TEXT NOT NULL,
  payload_json TEXT,
  PRIMARY KEY (run_id, id)
);

CREATE INDEX IF NOT EXISTS research_runs_updated_idx  ON research_runs(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS research_runs_status_idx   ON research_runs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS research_events_page_idx   ON research_events(run_id, ordinal ASC);
CREATE INDEX IF NOT EXISTS research_findings_page_idx ON research_findings(run_id, ordinal ASC);
CREATE INDEX IF NOT EXISTS research_evidence_find_idx ON research_evidence(run_id, finding_id);
CREATE INDEX IF NOT EXISTS research_sources_run_idx   ON research_sources(run_id, retrieved_at DESC);
```

Note the deliberate divergence from the `tasks` pattern: **claims and evidence are first-class rows, not blobs inside `core_json`.** Guardrail 6 requires claims and evidence to be separate objects, and audit §10 identifies the absence of a claim→source→location→verification chain as a core gap. Nesting them in JSON would reproduce the gap.

`research_events` is append-only with an ascending ordinal — not the `syncTaskCollection()` delete-and-reinsert pattern used for task collections. Events are an ingest stream, not a synchronised collection.

### 7.2 LangGraph checkpoints — separate file, child-owned

`.data/research-checkpoints.sqlite3`. **Eversor never opens it.** It is the runtime's private state, and keeping it in a separate file makes "can we replace Deep Agents?" answerable by deleting a file.

**The native dependency — resolved by G3, no longer a blocker.** `@langchain/langgraph-checkpoint-sqlite@1.0.4` depends on `better-sqlite3` (resolved **12.11.1**), a native module, where this repository currently has **zero native dependencies** and uses Node's built-in `node:sqlite` `DatabaseSync` (`server/sqlite-store.mjs:4`).

G3 tested it on this host (Node v26.8.1, ABI 147, darwin-arm64) and it works:

- **Prebuilt binary installed; `node-gyp` never ran** (no `Makefile` in `build/`). Install took 3 s.
- **Upstream prebuilds exist for ABI v147 on all nine relevant platform triples** — `darwin-{arm64,x64}`, `linux-{x64,arm64,arm}`, `linuxmusl-{x64,arm64,arm}`, `win32-{x64,arm64}` — so a clean machine or CI runner will not compile either.
- **A trivial checkpoint written, read back, and re-read from a fresh Node process.**
- **A full Deep Agents thread survived process restart**: state restored from disk and the conversation continued. `durability: "sync"` accepted.
- **`node:sqlite` and `better-sqlite3` coexist in one process** without conflict — not needed given the child boundary, but one less unknown.

The plan, now two options rather than three:

1. **Slices 1–2: `MemorySaver` with `durability: "exit"`.** No resume, and `resume()` is absent from the interface anyway. Correct and honest while the adapter is still taking shape.
2. **Slice 3: official `@langchain/langgraph-checkpoint-sqlite`**, loaded **only in the child**. Verified working end-to-end.

**The hand-written `BaseCheckpointSaver` over `node:sqlite` is struck.** It existed solely as insurance against a native build failure that does not occur, and it was custom persistence machinery the runtime already provides — which the §01-GOALS non-goals warn against.

**The one real cost to record:** `better-sqlite3` becomes **the repository's first dependency with an install script** (`prebuild-install || node-gyp rebuild --release`). npm 11 flags it — `1 package has install scripts not yet covered by allowScripts` — so any environment with a strict `allowScripts` policy needs an explicit approval step. The repository `.npmrc` (`fund=false`, `audit=false`) sets no such policy today. Also noted: `prebuild-install@7.1.3` is deprecated upstream; if it ever stops working the fallback is compilation, not failure.

`durability` is `"exit" | "async" | "sync"`, default `"async"` (VERIFIED in `@langchain/langgraph@1.4.15` `pregel/types.d.ts:20,222`). Slice 3 should still measure the `"sync"` write cost and — the question G3 did **not** answer — whether a node interrupted *mid-execution* resumes or re-executes (R6).

### 7.3 Runtime working files — `StateBackend`, in-state

`backend: new StateBackend()`. Files live in graph state, inside the checkpoint, thread-scoped. **No host filesystem access at all** — strictly stronger than `FilesystemBackend({ virtualMode: true })`, whose docs explicitly warn "never in web servers". Nothing to clean up, nothing to escape.

### 7.4 Source snapshots — content-addressed files

`.data/research-sources/<sha256[0:2]>/<sha256>`. Written by `fetch_source` in the **host**, before the content is ever shown to a model. Deduplicated by hash. This is what makes `EvidenceRef.snapshotRef` mean something and what makes §10.3's quote verification possible.

Retention is an operator concern; the spike writes and never prunes. Flag for the benchmark: 30 runs × N sources × page size is small, but it is unbounded growth and needs a policy before production.

---

## 8. Model routing

### 8.1 The topology is directly expressible — VERIFIED

`SubAgent` is exactly:

```ts
interface SubAgent {
  name: string;
  description: string;
  systemPrompt?: string | SystemMessage;
  mode?: "isolated" | "fork";
  tools?: StructuredTool[];
  model?: LanguageModelLike | string;   // ← per-role model override
  middleware?: readonly AgentMiddleware[];
  interruptOn?: Record<string, boolean | InterruptOnConfig>;
}
```

(VERIFIED in `deepagents@1.13.4` published declarations, and per-role routing **demonstrated** in G3: three distinct model instances were each invoked the expected number of times — planner 2 calls, each worker 1.)

> **Do not use the `createDeepAgent({ subagents })` shorthand where a bounded worker count is required.** G3 proved it silently admits a working `general-purpose` subagent: invoking `subagent_type: "general-purpose"` on a shorthand-built agent was **ACCEPTED**. `createDeepAgent` has no `generalPurposeAgent` option of its own. Bounded fan-out therefore requires composing `createSubAgentMiddleware({ generalPurposeAgent: false, … })` explicitly and passing it as `middleware` — which, when tested, correctly **REJECTED** the call: `invoked agent of type general-purpose, the only allowed types are \`researcher-1\``.

```ts
// server/research/deepagents/graph.mjs  (child process only)
import { createDeepAgent, StateBackend, createSubAgentMiddleware } from "deepagents";
import { toolCallLimitMiddleware, modelCallLimitMiddleware } from "langchain";

const researcherTools = [readContext, webSearch, fetchSource, submitFinding];
// `task` is absent from every child's tool list, which is what makes depth
// structurally 1 (§9.1 — VERIFIED). Note this does NOT strip the filesystem
// tools that middleware injects; see §10.2 for what actually bounds those.

const subagents = [
  ...Array.from({ length: n }, (_, i) => ({
    name: `researcher-${i + 1}`,
    description: "Investigate one bounded sub-question and submit findings with evidence.",
    mode: "isolated",                     // default; stated for clarity
    systemPrompt: RESEARCHER_PROMPT,
    model: researcherModel,               // cheap / open, OpenAI-compatible
    tools: researcherTools,
  })),
  { name: "verifier",    description: "...", model: verifierModel,
    tools: [readContext, fetchSource], systemPrompt: VERIFIER_PROMPT },
  { name: "synthesiser", description: "...", model: synthesiserModel,
    tools: [readContext],              systemPrompt: SYNTHESISER_PROMPT },
];

const agent = createDeepAgent({
  model: plannerModel,                    // frontier
  systemPrompt: PLANNER_PROMPT,
  tools: [readContext],                   // the planner does not fetch
  backend: new StateBackend(),
  checkpointer,
  // Subagents are composed through explicit middleware, NOT the `subagents`
  // shorthand, so that generalPurposeAgent can be turned off.
  middleware: [
    createSubAgentMiddleware({
      defaultModel: researcherModel,
      generalPurposeAgent: false,         // ← only honoured on this path
      subagents,
    }),
    toolCallLimitMiddleware({ toolName: "task", runLimit: n, exitBehavior: "continue" }),
    modelCallLimitMiddleware({ runLimit: budget.maxModelCalls, exitBehavior: "error" }),
  ],
});
```

One residual wrinkle to handle in the prompt rather than the config: even with `generalPurposeAgent: false`, the `task` tool's *description* still advertises `general-purpose` as an available type. Enforcement is real — the call is rejected — but the planner will be told the worker exists and will waste calls attempting it. The planner prompt should name the permitted `subagent_type` values explicitly.

### 8.2 Cheap / open worker models

```ts
new ChatOpenAI({ model: WORKER_MODEL_ID, apiKey, configuration: { baseURL } })
```

Any OpenAI-compatible endpoint. No GPU work in the spike, per constraints. Note this deliberately **bypasses** `providerForModelId()`, which classifies only `gpt-*` and `claude-*` and throws otherwise (VERIFIED, audit §4) — research model routing is a separate, research-owned concern and must not try to reuse the SDLC catalog's classification.

### 8.3 Two consequences for cost accounting

1. **`MODEL_PRICING` has no entry for open models.** `priceUsage()` will return nothing for a Qwen-class id. `ResearchUsage.byModel[…].priced: boolean` exists for exactly this: an unpriced model must show as unpriced, not as free. Evaluation-plan economics are meaningless otherwise.
2. **`usage_metadata` availability varies by endpoint.** LangChain surfaces `input_tokens` / `output_tokens` / `total_tokens` on `AIMessage` when the provider reports them; many OpenAI-compatible servers omit or approximate detail fields, and cache-read reporting is inconsistent. Slice 5 must measure this per endpoint and record it. Treating an absent token count as zero would silently understate the cheap arm and bias the entire benchmark toward it.

### 8.4 Disable the default general-purpose subagent

A `general-purpose` subagent is added automatically and, per the docs, "has filesystem tools by default". An unaudited extra worker defeats the count ceiling, so it must be turned off.

`generalPurposeAgent?: boolean` exists **only on `SubAgentMiddlewareOptions`** — not on `CreateDeepAgentParams`. G3 measured all three paths:

| Construction | Invoking `general-purpose` |
|---|---|
| `createDeepAgent({ subagents: [...] })` | **ACCEPTED** — worker silently available |
| `createSubAgentMiddleware({ generalPurposeAgent: false })` | **REJECTED** — `the only allowed types are \`researcher-1\`` |
| `createSubAgentMiddleware({ generalPurposeAgent: true })` | **ACCEPTED** |

So the rule is: **wherever a bounded worker count is required, subagents are composed through `createSubAgentMiddleware({ generalPurposeAgent: false })`.** The `subagents` shorthand is convenient and wrong for our purposes. A test asserting that `task({ subagent_type: "general-purpose" })` is rejected belongs in slice 4 — it is the cheapest possible guard against someone later simplifying the construction back to the shorthand.

---

## 9. Budget enforcement

The distinction the adversarial review will press on (its Q7 and Q8): **what is hard, and what is merely displayed.**

### 9.1 Hard — technically enforced, not model discretion

**All of these were executed against a model scripted to breach them** (G3 §7). "Demonstrated" below means a test drove the breach and observed the stated failure, not that the option exists.

| Ceiling | Mechanism | G3 result |
|---|---|---|
| **Max researchers** | `toolCallLimitMiddleware({ toolName: "task", runLimit: N, exitBehavior: "continue" })` **and** registering exactly N named subagents **and** `generalPurposeAgent: false` via explicit middleware (§8.4) | **Demonstrated.** Planner scripted for 6 `task` calls with `runLimit: 3`: exactly 3 subagents executed, 3 blocked with `"Tool call limit exceeded. Do not call 'task' again."` With `exitBehavior: "error"` the same setup threw `ToolCallLimitExceededError: … (6/3 calls)`. |
| **Max depth = 1** | Every subagent's `tools` array **omits `task`** | **Demonstrated.** Parent bound tools included `task`; subagent bound tools did not. A researcher has no delegation tool. Strongest control in the design; reinforced by `recursionLimit`. *(Note: this works because `task` is injected by subagent middleware the children do not receive — **not** because `tools` replaces inherited tools. See §10.2.)* |
| **Max concurrency** | `maxConcurrency` on `RunnableConfig` | Accepted on the invoke config. Caps simultaneous branches; addresses audit §6's "no global model admission" for the research plane. |
| **Max model calls** | `modelCallLimitMiddleware({ runLimit, exitBehavior: "error" })` | **Demonstrated.** `runLimit: 2` against a model scripted for 4 turns threw `ModelCallLimitMiddlewareError` after exactly 2 calls. |
| **Max tool / search calls** | `toolCallLimitMiddleware` per tool name, **plus counters inside our own tool implementations** | Same middleware as the fan-out ceiling, demonstrated above. The in-tool counter remains the real enforcement; the middleware is defence in depth. |
| **Timeout** | `AbortSignal.timeout()` in the child, **plus** parent-side `runProcess` timeout and `terminateProcessTree` | **Abort demonstrated.** A pre-aborted `AbortController` passed as `signal` threw `DOMException: This operation was aborted`. Two independent clocks in two processes; survives a wedged event loop in the child. |
| **Graph runaway** | `recursionLimit` on `RunnableConfig` | **Demonstrated.** An infinite tool loop under `recursionLimit: 4` threw `GraphRecursionError`. |

#### Exit behaviour: `"continue"` is the default for research fan-out

`toolCallLimitMiddleware` takes `exitBehavior: "continue" | "error" | "end"`. The choice is not cosmetic and G3 showed both modes working, so the architecture picks deliberately:

- **`"continue"` — the default for the worker ceiling.** Excess `task` calls are blocked individually and the model receives a corrective tool message; the bounded run proceeds to completion with N workers. A planner that over-asks produces a *bounded, usable result* rather than a failed run. This is what research work should do.
- **`"error"` — reserved for breaches that should invalidate the whole run.** Use it where exceeding the ceiling means the result can no longer be trusted or afforded: the model-call ceiling (a runaway loop) and the cost ceiling (§9.2). There, aborting is the correct outcome.

When a `"continue"` ceiling is hit, the run still records `budget.ceiling_hit` and sets `ResearchResult.truncatedBy`, so a bounded result is never silently mistaken for an exhaustive one.

### 9.2 Soft — post-hoc, bounded overshoot

**USD and tokens cannot be hard-enforced**, and the design must say so rather than imply a guarantee it cannot keep.

Token counts arrive in `usage_metadata` *after* a call completes. A cost ceiling is therefore checked after each model response by a small `afterModel` middleware that aborts the run once the cumulative estimate crosses `maxUsd`. The consequence, stated precisely:

> **Overshoot is bounded by one model call per in-flight branch.** With `maxConcurrency: 5`, a run may exceed `maxUsd` by up to five model calls' worth of spend before it stops.

For a cheap-worker topology that is small in absolute terms. It must still be written on the UI next to the number, and it must be measured in the benchmark. This is strictly better than the SDLC plane's current position (audit §12: no dollar budget at all, and failed runs record `usage: null`), but it is not a hard financial ceiling and must never be described as one.

### 9.3 Profiles

From `01-GOALS-AND-GUARDRAILS.md`, resolved in `src/research-budget-policy.ts` so the UI and server share one definition:

| Profile | researchers | concurrent | depth | runtime | model calls | search calls |
|---|---|---|---|---|---|---|
| QUICK | 2 | 2 | 1 | 5 min | 30 | 20 |
| STANDARD | 5 | 3 | 1 | 20 min | 100 | 60 |
| DEEP | 8 | 4 | 1 | 45 min | 200 | 120 |

The spike caps at **3 researchers** regardless of profile (`03-DEEP-AGENTS-JS-SPIKE.md`). Anything above DEEP requires an explicit policy decision, not a larger number in a config file.

### 9.4 Cancellation — three layers

1. **Intent, persisted first.** `research_runs.status = 'cancelling'`, committed before any signal. Survives companion death; the answer to "what did the operator want?" is durable. This mirrors `TaskControlOrchestrator.cancel()`.
2. **Graceful.** SIGTERM → child's `AbortSignal` aborts the graph → checkpoint flushes → exit. `signal?: AbortSignal` is VERIFIED on `RunnableConfig`.
3. **Forceful.** Existing `terminateProcessTree(child, force)` escalation: 2 s, SIGKILL, 3 s (audit §2).

**Known risk (R3).** LangGraph JS has open issues around abort handling — "Controller is already closed" race conditions during aborted parallel streaming, and historical reports of abort signals not propagating past the start node. These are third-party issues and **UNVERIFIED** at version 1.4.15 specifically. Layer 3 is the reason cancellation is still reliable if layer 2 misbehaves: the process dies regardless. Slice 2's cancellation test must assert the *process* is gone, not merely that the promise rejected.

---

## 10. Security boundary

Deep Agents' own stated model — "trust the LLM… enforce boundaries at the tool/sandbox level" — is the design premise, not a caveat.

### 10.1 Attack surface

Both model output **and** fetched web content are untrusted. Guardrail 9 and the evaluation corpus both include deliberately misleading/injected web content, so prompt injection is an in-scope test case, not a hypothetical.

### 10.2 Controls

> **Correction from G3 — the tool-isolation model in an earlier draft was wrong.** That draft claimed an explicit `tools` array "replaces, not extends" inherited tools. It does not. A subagent declared with `tools: []` was still bound **eight** tools — `delete`, `edit_file`, `glob`, `grep`, `ls`, `read_file`, `write_file` (and `task` on the parent). Filesystem tools arrive from **middleware**, not from the `tools` list, so `tools` does not control them. Note also `delete`, which is not in the documented filesystem tool set and must be accounted for in any allowlist review.
>
> **Why the design still holds:** the security boundary was never really the `tools` array. It is the **backend**. `StateBackend` keeps every one of those eight tools operating on thread-scoped state inside the checkpoint — nothing touches the host filesystem, so there is no disk to escape to. And the depth-1 control is unaffected: `task` genuinely is absent from subagents, because it is injected by the subagent middleware that children do not receive.
>
> **What this changes in practice:** the `tools` array bounds *which Eversor-authored tools* an agent can call. It does **not** bound middleware-provided tools. To remove filesystem tools entirely, compose the agent from explicit middleware rather than relying on `tools: []`. Slice 4 should assert the *actual* bound tool list per agent rather than assuming it from config — that assertion is what would have caught this.

| Control | Implementation | Enforcement |
|---|---|---|
| No host filesystem | `backend: new StateBackend()` | **Technical, and load-bearing.** Filesystem tools exist but operate only on thread-scoped state. This is the primary boundary, not a secondary one. |
| No shell | Never construct `LocalShellBackend`; never expose `execute` | **Technical.** The tool does not exist. |
| No repository write | No repo path is reachable — `StateBackend` exposes no host path at all | **Technical.** |
| Eversor tool allowlist | Explicit `tools: []` per agent and per subagent | **Technical, but partial.** Bounds Eversor-authored tools only; middleware tools are unaffected (see box above). |
| Middleware tool set | Compose middleware explicitly; audit the resulting bound tool list per agent | **Technical.** The control that actually bounds `ls`/`read_file`/`write_file`/`edit_file`/`glob`/`grep`/`delete`. |
| Defence in depth | `permissions: FilesystemPermission[]` — `{ operations, paths, mode: "allow" \| "deny" }` (VERIFIED) | **Technical**, further layer over whatever the backend exposes. |
| Scoped secrets | Child spawned with an explicit env allowlist | **Technical.** Mirrors `execution-providers.mjs`. |
| No LangSmith egress | `LANGSMITH_TRACING` unset/false; `LANGSMITH_API_KEY` excluded from the child env | **Technical**, via the same allowlist. |
| Web content containment | Fetched content is written to a snapshot and referenced; never concatenated into a system prompt | **Technical.** |
| No privileged tool reachable from web content | Every tool a researcher holds is read-only or append-only; `submit_finding` writes only validated rows | **Technical.** There is no privileged tool to escalate into — the real mitigation. |
| No `execute` via sandbox | Do not use `LangSmithSandbox` | Also avoids a LangSmith coupling. |

**Note on `interruptOn` / HITL.** `humanInTheLoopMiddleware` exists and `createDeepAgent` accepts `interruptOn`, but it requires a checkpointer and adds an approval surface. The spike does not need it because no tool is dangerous. Keep it in reserve for the day a write-capable tool is proposed; it is the right mechanism at that point, and its existence is a reason to prefer Deep Agents over a hand-rolled harness.

### 10.3 Evidence integrity — the control that does the most work

Guardrails 6, 7 and 8, plus adversarial-review Q11 and Q12, all reduce to one question: **can the model fabricate a citation?**

Design answer: **no, because the model never supplies the evidence — it supplies a pointer, and the host validates it.**

```
fetch_source(url)  →  HOST fetches
                   →  HOST writes .data/research-sources/<sha256>
                   →  HOST inserts research_sources row (retrievedAt, sha256, url, mediaType)
                   →  returns { sourceId, title, charCount } + paginated text to the model

submit_finding({ claim, evidence: [{ sourceId, quote, locator }] })
                   →  HOST loads the snapshot by sourceId
                   →  HOST asserts `quote` is a LITERAL SUBSTRING of the snapshot
                   →  on failure: the tool REJECTS the finding and returns an error to the model
                   →  on success: persist finding + evidence with quote_verified = 1,
                      recording charStart/charEnd computed by the HOST
```

Consequences worth stating:

- A hallucinated quote is **rejected at the tool boundary**, not flagged downstream by a reviewer.
- `quoteVerified` is written by the host and is never a model-supplied field.
- A claim with zero verified evidence is still storable — with `evidence: []` — so "unsupported claim" becomes a *measurable metric* (it is one of the evaluation plan's correctness metrics) rather than an invisible failure.
- This closes, for the research plane, the exact gap audit §10 identifies: `parseScoutReport()` "does not check that the cited line proves the fact."

This is the piece of the design I would least want cut for schedule. It is also small: one function and one test.

---

## 11. Implementation slices

Each slice is independently mergeable and leaves the SDLC suite green.

| # | Slice | Contents | Exit criterion |
|---|---|---|---|
| **1** | **Neutral contracts + fake runtime** | `src/domain/research.ts`, budget policy, `ResearchStore`, schema v4, registry, `FakeResearchRuntime`, routes, orphan-pid reaping, tests | Fake runtime deterministically drives queued→running→completed, →cancelled, →failed. No LangChain anywhere. Existing suite green. |
| **2** | **Minimal Deep Agents adapter, one agent, no subagents** | `worker.mjs`, NDJSON protocol, `MemorySaver`, `StateBackend`, `read_context` + `submit_finding` only, `modelCallLimitMiddleware`, abort | One agent runs end-to-end; usage normalised; **cancellation kills the process**; import-containment test passes. |
| **3** | **Checkpoint persistence** | `@langchain/langgraph-checkpoint-sqlite` as optionalDependency in the child, separate DB file, `durability` experiments, restart tests | Empirical answer to "is resume genuine continuation or a rerun?" `resume()` added to the interface **only if** the answer is continuation. |
| **4** | **Bounded subagents** | ≤3 researchers via `createSubAgentMiddleware({ generalPurposeAgent: false })`, depth structurally 1, `toolCallLimitMiddleware` (`"continue"`), `maxConcurrency`, child-failure tests | Adversarial tests: a planner instructed to spawn 10 workers spawns 3; depth-2 delegation is impossible; `task({ subagent_type: "general-purpose" })` is **rejected**; the *observed* bound tool list per agent is snapshotted (R11). |
| **5** | **Cheap worker endpoint** | `ChatOpenAI` + `baseURL`, role→model routing, usage-metadata fidelity per endpoint, rate-card entries | Planner and researchers demonstrably run different models; token reporting per endpoint documented, including gaps. |
| **6** | **Research tools** | `web_search`, `fetch_source`, snapshot store, pagination, robots/size/timeout limits | A real web research run completes within its ceilings. |
| **7** | **Evidence contract** | Quote verification, verifier role, contradiction capture | Hallucinated quote is rejected by the tool. Unsupported-claim rate is measurable. |
| **8** | **Benchmark harness** | 10 known-answer tasks, metric collection, arm A vs C | Evaluation plan runnable end-to-end. |

**First three slices: 1, 2, 3.**

---

## 12. LangSmith decision

**Not required. Explicitly disabled. But the package is unavoidable.**

**VERIFIED** — `deepagents@1.13.4` peer dependencies:

```json
{
  "langchain": "^1.5.10",
  "langsmith": ">=0.7.1 <0.10.0",
  "@langchain/core": "^1.2.9",
  "@langchain/langgraph": "^1.4.10",
  "@langchain/langgraph-sdk": "^1.9.23",
  "@langchain/langgraph-checkpoint": "^1.1.5"
}
```

`langsmith` is a **mandatory peer dependency**. It must be installed. It is not optional.

The distinction that matters: *installed* ≠ *active*. Tracing activates on environment variables (`LANGSMITH_TRACING` / `LANGSMITH_API_KEY`). Since the child process receives an explicit env allowlist, the spike simply does not pass them — the same technique `execution-providers.mjs` already uses to keep API keys away from CLI runs.

**G3 proved this empirically, not by argument.** A sentinel patched `globalThis.fetch`, `http.request` and `https.request` to record and throw on any outbound attempt, and every scenario ran with `LANGSMITH_*`/`LANGCHAIN_*` stripped from the environment: minimal graph, subagent fan-out, SQLite-backed graph turn 1, and SQLite-backed graph after restart. **Zero network attempts in all four.** Supporting evidence: `langsmith`'s OpenTelemetry and `openai` integrations resolve as *optional* peers and are unmet, so the tracing and provider paths are opt-in at the dependency level too.

**Avoid** `ContextHubBackend` (stores the agent filesystem in a LangSmith Context Hub repository) and `LangSmithSandbox` (the shipped sandbox backend). Both are genuine lock-in vectors, and both are how LangSmith becomes an accidental hard dependency (adversarial Q20). The design avoids them for independent reasons anyway: `StateBackend` is stronger, and there is no `execute` tool.

**What we give up:** trace visualisation, which is genuinely good for debugging multi-agent graphs. **What we gain:** no external egress of research content, no vendor account in the critical path, no second observability system alongside the existing run/event/artifact store. If debugging proves painful in slice 4, revisit — but as a developer-machine opt-in, never as a runtime requirement, and never with customer research content.

A test asserting the child env contains no `LANGSMITH_*` and no `LANGCHAIN_*` variables is worth its four lines.

---

## 13. Risks and unknowns — ranked

| # | Risk | L | I | Mitigation | Verify in |
|---|---|---|---|---|---|
| **R1** | **No native fan-out/depth ceiling in `SubAgentMiddlewareOptions`.** Confirmed absent. Width and depth are model discretion by default; guardrail 5 is not met out of the box. | Certain | ~~High~~ **Medium** | Three independent mechanisms (§9.1), **all demonstrated enforcing in G3** against a model scripted to breach them. Residual: the ceilings only hold if the agent is composed correctly — hence R11. | ~~Slice 4~~ **G3 ✅**; re-assert in slice 4 |
| **R11** | **Mis-composition silently removes a ceiling.** Two ways found in G3: the `createDeepAgent({ subagents })` shorthand re-admits `general-purpose`, and `tools: []` does not bound middleware tools. Both look correct in review. | Medium | High | Slice 4 asserts *observed* behaviour — reject `subagent_type: "general-purpose"`, and snapshot the actual bound tool list per agent — rather than trusting config | Slice 4 |
| **R2** | **Developer-velocity package churn.** `deepagents` published 1.13.4 on **2026-09-09** — one week before this document — with 67 versions total; `@langchain/langgraph` 1.4.15 on 2026-09-12. Breaking changes between spike and benchmark are likely. | High | Medium | Pin exact versions; confine every import to `worker.mjs`; the adapter is the only thing that breaks | Continuous |
| **R3** | **Abort reliability in LangGraph JS.** Open issues on "Controller is already closed" races in aborted parallel streaming, and historical abort-propagation reports. Status at 1.4.15 UNVERIFIED. | Medium | High | Layer 3: kill the process. Test asserts the *process* is gone. | Slice 2 |
| **R4** | **Orphaned children on companion death.** Pre-existing (audit §6) but worse for long-lived research children. | Medium | Medium | Persist child pid; reap on startup; startup marks `running` research runs `failed` with `usage.partial: true` | Slice 1 |
| **R5** | ~~`better-sqlite3` may need native compilation on Node 26.~~ **Resolved by G3.** Residual risk restated: it becomes **the repository's first install-script dependency**, so environments with a strict npm `allowScripts` policy need an approval step. | ~~Medium~~ **Low** | ~~Medium~~ **Low** | Prebuilt binary installed on Node 26 / ABI 147 / darwin-arm64 with no `node-gyp`; upstream prebuilds exist for all nine relevant platform triples. Hand-written checkpointer fallback struck. | **G3 ✅** |
| **R6** | **Resume may be rerun, not continuation.** A checkpoint restores *state*; whether an interrupted node re-executes from its start is UNVERIFIED for this version. | Medium | High | `resume()` is absent from the interface until proven. Do not name it `resume` if it reruns. | Slice 3 |
| **R7** | **Usage fidelity on OpenAI-compatible endpoints.** Missing or approximate token reporting biases the economics arm toward the cheap worker. | High | Medium | `priced: boolean`, `partial: boolean`; document per endpoint; never treat absent as zero | Slice 5 |
| **R8** | **Prompt injection from fetched content.** In-scope by design (guardrail 9, evaluation corpus). | High | Low–Med | No privileged tool exists to escalate into; content never enters a system prompt; injection cases are corpus items | Slice 6–7 |
| **R9** | **Soft cost ceiling overshoot.** Up to `maxConcurrency` model calls beyond `maxUsd`. | Certain | Low | Stated in contract, surfaced in UI, measured | Slice 5 |
| **R10** | **Scope creep into a second platform.** Research plane accretes tenancy, queues, vector storage. | Medium | High | Non-goals are explicit; slices are small; §14 gates | Every slice |

---

## 14. Go / no-go gates

Before slice 1:

- **G1** — Product decision recorded on audit §19 Q1 (single trusted host vs. multi-customer) and Q5 (what "hard budget" means operationally). Both change the persistence and enforcement design, and both are outside what the repository can answer.
- **G2** — Confirm a cheap/open OpenAI-compatible endpoint with credentials is actually available in development. Without it, arm A cannot be evaluated and the economic premise is untested.
- **G3 — ✅ SATISFIED, 16 Sep 2026.** `RESEARCH-RUNTIME-G3-COMPATIBILITY.md`, verdict `G3_PASS_WITH_CHANGES`. Main set installs clean on Node v26.8.1 (43 packages, 0 vulnerabilities, no unmet *required* peers); 27/27 API checks pass; all §9.1 ceilings demonstrated enforcing; zero network without LangSmith config; `@langchain/langgraph-checkpoint-sqlite@1.0.4` installs **prebuilt** and survives process restart at both checkpoint and full-thread level. The three required changes — §8.1/§8.4 composition, §9.1/§10.2 tool boundary, §13/§7.2 R5 — are applied in this revision.
- **G4** — Accept the additive-only schema change (v3 → v4) and confirm a backup/restore path for `.data/tasks.sqlite3` exists (audit §19 Q6 notes none is established by the runtime code).
- **G5** — Accept that this document's answer to guardrail 5 is *Eversor enforces the ceilings*, not *the runtime provides them*. If that is unacceptable, the boundary must change before implementation, not after.

Before slice 4 (bounded subagents):

- **G6** — Slice 2's cancellation test passes with a process-level assertion.
- **G7** — The import-containment test is merged and failing-on-violation.

Before benchmarking:

- **G8** — All eight minimum gates in `03-EVALUATION-PLAN.md` are individually demonstrated, not argued.

---

## Required closing summary

### 1. Recommended process boundary

**Child process, one per research run**, on four grounds: fault isolation, cancellation/process-tree control, the security boundary around untrusted content, and protecting the SDLC companion from long-running research failures and OOMs. NDJSON events on stdout; cancellation via the existing `terminateProcessTree` escalation plus an in-child `AbortSignal`. Rejected: in-process (a research OOM or wedge would take down the companion, which holds the exclusive store lock and all in-memory run state, and it forfeits the process-tree kill that makes cancellation reliable), worker thread (shares the heap, so shares the OOM), and a separate long-lived HTTP service (new listener, new auth surface, new lifecycle, no benefit at single-host scale).

Dependency weight is **not** part of this argument — G3 measured the tree at 47 packages, zero native, zero install scripts, and that earlier justification is withdrawn.

### 2. Is LangSmith required?

**No — proven, not assumed.** `langsmith` is a **mandatory peer dependency** of `deepagents@1.13.4` and must be installed, but G3 recorded **zero outbound network attempts** across four scenarios with `LANGSMITH_*`/`LANGCHAIN_*` stripped and `fetch`/`http.request`/`https.request` instrumented. Tracing is env-activated, so the child's env allowlist simply omits those variables. Avoid `ContextHubBackend` and `LangSmithSandbox` — those are the real lock-in, and the design avoids them for independent reasons.

### 3. Recommended checkpoint / persistence approach

**Four separate stores.** Eversor run metadata, findings, evidence and sources as **new tables in the existing `.data/tasks.sqlite3`** (additive DDL, schema v3 → v4, no existing table touched). LangGraph checkpoints in a **separate file** the companion never opens: `MemorySaver` + `durability: "exit"` for slices 1–2, then the official `@langchain/langgraph-checkpoint-sqlite` in the child from slice 3 — **G3 verified it installs prebuilt on Node 26 (no `node-gyp`) and that both a raw checkpoint and a full Deep Agents thread survive process restart**, so the hand-written `node:sqlite` checkpointer fallback is struck. Its one real cost: `better-sqlite3` becomes the repository's first install-script dependency. Working files in `StateBackend` (no host filesystem, and per §10.2 this is the primary tool boundary). Source snapshots content-addressed under `.data/research-sources/<sha256>`. **`resume()` stays out of the interface until slice 3 proves genuine mid-node continuation** — G3 proved thread continuation across restart, which is not the same thing.

### 4. First three implementation slices

1. **Neutral contracts + fake runtime** — `src/domain/research.ts`, `ResearchStore`, schema v4, runtime registry, deterministic `FakeResearchRuntime`, research routes, orphan-pid reaping, tests. Zero LangChain.
2. **Minimal Deep Agents adapter** — `worker.mjs` child entrypoint, NDJSON protocol, one agent, no subagents, `MemorySaver`, `StateBackend`, `read_context` + `submit_finding`, `modelCallLimitMiddleware`, cancellation asserted at the process level, import-containment test.
3. **Checkpoint persistence** — separate checkpoint DB, `durability` experiments, restart tests, and a documented empirical answer to whether resume is continuation or rerun.

### 5. Five biggest architectural risks

*Re-ranked after G3. R5 (native build) has left this list; mis-composition has entered it.*

1. **Mis-composition silently removes a ceiling (R11).** G3 found two instances where the obvious, readable construction quietly loses a guarantee: `createDeepAgent({ subagents })` re-admits the `general-purpose` worker, and `tools: []` does not bound middleware-provided filesystem tools. Both pass review by eye. The ceilings themselves are verified to work — the risk is now that someone simplifies the composition back. Slice 4 must assert *observed* behaviour, not config.
2. **Developer-velocity churn (R2)** — `deepagents` shipped 1.13.4 seven days before this document, across 67 versions; LangGraph 1.4.15 three days later. Confining every import to `worker.mjs` is what keeps a breaking change an adapter problem rather than a platform problem.
3. **Abort reliability in LangGraph JS (R3)** — a pre-aborted signal was honoured in G3, but the open "Controller is already closed" races apply to *aborting mid-flight parallel* work, which G3 did not exercise. Reliable cancellation still depends on killing the process, not on the library behaving.
4. **Resume may be rerun, not continuation (R6)** — G3 proved a thread resumes across process restart, which is the easy half. Whether a node interrupted *mid-execution* re-executes is still unproven. Naming a rerun `resume()` would be the single most damaging thing this architecture could do to the SDLC plane's credibility.
5. **Usage fidelity on OpenAI-compatible endpoints (R7)** — `usage_metadata` propagated correctly in G3 from a model that reports it, which proves the plumbing, not the endpoints. Inconsistent real-world token reporting would silently bias the economic comparison toward the cheap arm — the one thing the entire evaluation exists to measure.

---

## Appendix A — Verified external facts

| Fact | Value | Source |
|---|---|---|
| `deepagents` latest | **1.13.4**, published 2026-09-09, MIT, 67 versions | npm registry |
| `deepagents` peer deps | `langchain ^1.5.10`, `langsmith >=0.7.1 <0.10.0`, `@langchain/core ^1.2.9`, `@langchain/langgraph ^1.4.10`, `@langchain/langgraph-sdk ^1.9.23`, `@langchain/langgraph-checkpoint ^1.1.5` | npm registry |
| `@langchain/langgraph` | 1.4.15, 2026-09-12 | npm registry |
| `langchain` | 1.5.11, 2026-09-09 | npm registry |
| `@langchain/core` | 1.2.11, 2026-09-12 | npm registry |
| `@langchain/langgraph-checkpoint-sqlite` | 1.0.4; depends on `better-sqlite3 ^12.10.0` (native) | npm registry |
| `SubAgent` fields | `name`, `description`, `systemPrompt?`, `mode?: "isolated"\|"fork"`, `tools?`, `model?`, `middleware?`, `interruptOn?` | published `.d.ts` |
| `SubAgentMiddlewareOptions` fields | `defaultModel`, `defaultTools?`, `defaultMiddleware?`, `generalPurposeMiddleware?`, `defaultInterruptOn?`, `subagents?`, `systemPrompt?`, `generalPurposeAgent?`, `taskDescription?`, `parentSystemPrompt?` — **no concurrency, depth or call limit** | published `.d.ts` |
| `CreateDeepAgentParams` | `model?`, `tools?`, `systemPrompt?`, `stateSchema?`, `middleware?`, `subagents?`, `responseFormat?`, `contextSchema?`, `checkpointer?`, `store?`, `backend?`, `interruptOn?`, `name?`, `memory?`, `skills?`, `permissions?`, `streamTransformers?` | published `.d.ts` |
| `FilesystemPermission` | `{ operations: readonly FilesystemOperation[]; paths: string[]; mode?: "allow" \| "deny" }` | published `.d.ts` |
| `AsyncSubAgent` | `{ name, description, graphId, url?, headers? }` — requires a LangGraph server; out of scope | published `.d.ts` |
| `Durability` | `"exit" \| "async" \| "sync"`, default `"async"` | `@langchain/langgraph` `pregel/types.d.ts` |
| `StreamMode` | `values \| updates \| debug \| messages \| checkpoints \| tasks \| custom \| tools` | `@langchain/langgraph` `pregel/types.d.ts` |
| `RunnableConfig` controls | `recursionLimit?`, `maxConcurrency?`, `timeout?`, `signal?: AbortSignal` | `@langchain/core` `runnables/types.d.ts` |
| Limit middleware | `modelCallLimitMiddleware({ threadLimit?, runLimit?, exitBehavior?: "end"\|"error" })`; `toolCallLimitMiddleware({ toolName?, threadLimit?, runLimit?, exitBehavior?: "continue"\|"error"\|"end" })` — both from `langchain` | LangChain docs |
| Deep Agents trust model | "The agent can do anything its tools allow. Enforce boundaries at the tool/sandbox level, not by expecting the model to self-police." | `deepagentsjs` README |

### Appendix A.1 — Facts added by G3 (executed, not read)

Full detail in `RESEARCH-RUNTIME-G3-COMPATIBILITY.md`.

| Fact | Value |
|---|---|
| Install, main set | 43 packages, 7 s, 0 vulnerabilities, no native, no install scripts, **no unmet required peers** (5 unmet *optional*: react, react-dom, 3× otel, openai, ws) |
| Resolved floating versions | `langsmith@0.9.0`, `@langchain/langgraph-sdk@1.11.0`, `@langchain/langgraph-checkpoint@1.1.5` |
| Total transitive tree | **47 packages** |
| `createDeepAgent` return | `ReactAgent` — has `invoke`/`stream`/`getState`/`checkpointer`, **no** `getGraph`. The README's "compiled LangGraph graph" is loose; every method the design uses is present. |
| Per-role model routing | **Demonstrated** — 3 distinct model instances, planner 2 calls, each worker 1 |
| Depth-1 containment | **Demonstrated** — `task` on parent, absent from subagents |
| Fan-out ceiling | **Demonstrated** both modes — `"error"` → `ToolCallLimitExceededError (6/3)`; `"continue"` → 3 executed, 3 blocked |
| Model-call ceiling | **Demonstrated** — `ModelCallLimitMiddlewareError` after exactly 2 of 4 |
| `recursionLimit` | **Demonstrated** — `GraphRecursionError` |
| `AbortSignal` | **Demonstrated** — pre-aborted signal throws `DOMException` |
| `generalPurposeAgent: false` | Honoured **only** via `createSubAgentMiddleware`; the `createDeepAgent({ subagents })` shorthand admits the worker |
| Subagent bound tools with `tools: []` | `delete`, `edit_file`, `glob`, `grep`, `ls`, `read_file`, `write_file` — middleware-provided, **not** removed by `tools` |
| LangSmith network | **0 attempts** across 4 scenarios with `fetch`/`http.request`/`https.request` instrumented |
| `better-sqlite3` | 12.11.1, **prebuilt** for ABI v147 / darwin-arm64, no `node-gyp`; upstream prebuilds for all 9 relevant triples |
| Checkpoint durability | Raw checkpoint and full Deep Agents thread both survived process restart; `durability: "sync"` accepted |
| `node:sqlite` + `better-sqlite3` | Coexist in one process without conflict |
| npm warnings | `prebuild-install@7.1.3` deprecated; `better-sqlite3` flagged by `allowScripts` policy |

## Appendix B — Verified repository facts

| Fact | Evidence |
|---|---|
| `server/*.mjs` imports `../src/*.ts` directly | 9 call sites, e.g. `server/action-policy.mjs:4`, `server/orchestrator-task-control.mjs:1` |
| Zero server-side runtime dependencies | `package.json` `dependencies`: fonts, phosphor, r3f, pixi, react, react-dom, react-markdown, remark-gfm, three, vite |
| SQLite via Node builtin, no native deps | `server/sqlite-store.mjs:4` — `import { DatabaseSync } from "node:sqlite"` |
| Schema version 3; tables `schema_migrations`, `metadata`, `settings`, `tasks`, `artifacts`, `events`, `runs` | `server/sqlite-storage.mjs:4–68` |
| Provider registry is a 2-entry `Map`; unknown ids throw | `server/execution-providers.mjs` |
| Route dispatch is a chain of route factories | `server/api.mjs` — `createApiServer` + dispatch chain |
| `assertHttpBoundary` runs before routing | `server/api.mjs` dispatch |
| Reusable process controls | `server/process-runtime.mjs` exports `runProcess`, `terminateProcessTree`, `waitForClose`, `ProcessTimeoutError`, `STDOUT_LIMIT`, `STDERR_LIMIT` |
| Reusable cost helpers | `server/model-catalog.mjs` exports `priceUsage`, `priceModelUsage`, `enrichUsage`, `normalizeModelId`, `MODEL_PRICING`, `validatePricingRates` |
| `providerForModelId()` accepts only `gpt-*` / `claude-*` | `server/model-catalog.mjs:196` |
| Node engine `>=22.13.0`; host running v26.8.1 | `package.json`, `node -v` |

---

## Sources

- [deepagents on npm](https://www.npmjs.com/package/deepagents)
- [langchain-ai/deepagentsjs](https://github.com/langchain-ai/deepagentsjs)
- [Deep Agents overview — LangChain docs](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [Deep Agents subagents](https://docs.langchain.com/oss/javascript/deepagents/subagents)
- [Deep Agents backends](https://docs.langchain.com/oss/javascript/deepagents/backends)
- [Deep Agents middleware](https://docs.langchain.com/oss/javascript/deepagents/middleware)
- [LangChain built-in middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in)
- [LangChain models / usage metadata](https://docs.langchain.com/oss/javascript/langchain/models)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
- [langgraphjs issue #1908 — "Controller is already closed" on aborted parallel streaming](https://github.com/langchain-ai/langgraphjs/issues/1908)
- [langgraphjs issue #319 — abort signal propagation](https://github.com/langchain-ai/langgraphjs/issues/319)
