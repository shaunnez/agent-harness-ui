# Research Agent Spike — Deep Agents JS First

## Purpose

Extend the existing Eversor agent harness with a **provider-neutral research capability**, using **Deep Agents JS as the first open-runtime implementation candidate**.

This is a spike, not a rewrite.

The existing SDLC harness remains authoritative for:
- UI and operator experience
- task/run ownership
- approvals
- budgets and policy
- normalized usage/cost
- high-level events
- artifacts/results
- product integrations
- evidence/provenance

Deep Agents JS may own generic agent-runtime mechanics where it already provides them:
- planning
- isolated subagents
- working-context/file management
- LangGraph execution
- checkpointing/persistence when configured
- streaming
- tool/subagent execution

Eversor must NOT become coupled to Deep Agents-specific types.

## Existing audit

Read `HARNESS-RESEARCH-AUDIT.md` before doing anything.

Important findings:
1. Current execution is single-host and process-owned.
2. SQLite persists task state but does not provide durable model-turn continuation.
3. Current workflows are fixed SDLC stages.
4. Real concurrency exists for scouts/packages but there is no generic research-agent runtime.
5. Current model providers are local Codex/Claude CLIs.
6. There is no generic open-model HTTP adapter.
7. There is no web research/RAG/evidence plane.
8. Existing `ExecutionProvider.run()` is suitable for a single execution, but too narrow for a long-running research runtime.

## Architectural hypothesis

Do NOT put research inside `TaskControlOrchestrator`.

Introduce an Eversor-owned boundary:

```ts
interface ResearchRuntime {
  start(request: ResearchRequest): Promise<ResearchRunHandle>;
  status(runId: string): Promise<ResearchRunStatus>;
  cancel(runId: string): Promise<void>;
  resume?(runId: string): Promise<ResearchRunHandle>;
  events?(runId: string, cursor?: string): AsyncIterable<ResearchEvent>;
  result(runId: string): Promise<ResearchResult>;
}
```

First implementation candidate:

```text
Eversor ResearchRuntime
        |
        v
Deep Agents JS
        |
        +-- planner/coordinator
        +-- 3–5 bounded researchers
        +-- verifier
        +-- synthesiser
```

Initial worker model target:
- Qwen3.8-27B or another approved cheap/open model through an OpenAI-compatible endpoint
- hosted first; self-hosting is a later infrastructure experiment

Frontier models may be used selectively for planning, difficult verification and synthesis.

## Do not make Deep Agents the architecture

Deep Agents JS is the first implementation candidate, not the product boundary.

Later benchmark against:
1. one managed research API (You.com / Parallel / Exa-class)
2. NVIDIA AI-Q if useful
3. another open runtime only if Deep Agents exposes material gaps

## Execution order

1. `prompts/01-ARCHITECT-DEEP-AGENTS.md` — Claude Opus, high effort
2. review `RESEARCH-RUNTIME-ARCHITECTURE.md`
3. `prompts/02-IMPLEMENT-NEUTRAL-CONTRACTS.md` — Claude Sonnet, high effort
4. `prompts/03-DEEP-AGENTS-JS-SPIKE.md` — Claude Sonnet, high effort
5. `prompts/04-ADVERSARIAL-REVIEW.md` — preferably GPT-5.6 Sol High or another independent strong model
6. run the evaluation plan before selecting production architecture

## Current vertical-slice evaluation

- For the next implementation, read `06-FIRECRAWL-RUNTIME-IMPLEMENTATION-PLAN.md` v2 and use
  `prompts/05-IMPLEMENT-FIRECRAWL-RUNTIME.md` only after an explicit start instruction. The current slice is
  single-agent public research; earlier fan-out/model exploration above is not its implementation scope.
- `04-SEARCH-PROVIDER-BENCHMARK.md` compares public-web discovery.
- `05-CAPTURE-AND-PDF-BENCHMARK.md` records both live gates: the broad local/Firecrawl/Exa comparison and
  the difficult Firecrawl-versus-PlanCheck PDF gate, including the final public/private capture boundary.
- `06-FIRECRAWL-RUNTIME-IMPLEMENTATION-PLAN.md` v2 specifies the settled Firecrawl public capture route,
  exact configuration/fallback rules, initial OCR mode, bounded snapshot reads, page verification,
  credit accounting, ordered implementation steps, and separate deterministic/live acceptance gates.
- `07-CURRENT-PDF-REPLACEMENT-GATE.md` records the corrected current-PlanCheck comparison. It selects Firecrawl
  PDF Parse for public sources while keeping private PDFs on PlanCheck's local transcription path.
- The runtime still uses Tavily until the implementation slice is completed and accepted.

## Firecrawl runtime launch and rollback

Keep local research credentials in ignored `.env.research.local` with owner-only mode `0600`. The enabled
public-only profile uses `RESEARCH_SEARCH_PROVIDER=firecrawl`, `RESEARCH_SEARCH_FALLBACK=serper`,
`RESEARCH_CAPTURE_PROVIDER=firecrawl`, `RESEARCH_PDF_PROVIDER=firecrawl`, the bounded market/page/credit/call
settings from the v2 plan, and host-only `FIRECRAWL_API_KEY` / `SERPER_API_KEY`. Never place private document
context in this route; both queries and URLs leave the machine.

- `npm run research:acceptance` validates the versioned S8 manifest and 12-credit upper bound without DNS,
  provider or model calls. A live run additionally requires the explicit execution guard and public-only
  acknowledgement; preparing this command is not permission to execute it.
- `RUN_RESEARCH_DEMO=1 npm run research:demo:local -- "public objective"` runs the selected live model route
  only after its separate guard and credential preflight pass.
- Roll search back with `RESEARCH_SEARCH_PROVIDER=tavily` and `RESEARCH_SEARCH_FALLBACK=none`. Roll capture
  back with `RESEARCH_CAPTURE_PROVIDER=local` and `RESEARCH_PDF_PROVIDER=disabled`. Rollback does not delete
  retained snapshots or change historical evidence.

### Current live acceptance status

The bounded S8 session on 21 September 2026 **failed and stopped**. The first attempt exposed a local Node
ABI mismatch after a 6-credit Firecrawl upper bound. The authorized Node 22 retry reached both Firecrawl
scenarios and stopped at the fail-closed PDF block-status check after a further 12-credit upper bound. The
HTML search/capture and in-run reuse assertions passed; the PDF was not retained, Serper was not called,
no live model ran, and the retained artifacts contained no provider credential values. The local retry
receipt is `.data/research-runtime-acceptance/2026-09-21T02-47-05-734Z/report.json`.

The follow-up code adds a native-dependency preflight before network dispatch, guaranteed failed-run cleanup,
bounded block-status diagnostics, and underlying run-error reporting. That code is deterministically
qualified but has not been exercised by another paid provider run. S8/A15 and the live PDF portion of A2
remain failed; do not activate the provider profile or rerun S8 without a new explicit allowance.
