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

- `04-SEARCH-PROVIDER-BENCHMARK.md` compares public-web discovery.
- `05-CAPTURE-AND-PDF-BENCHMARK.md` records both live gates: the broad local/Firecrawl/Exa comparison and
  the difficult Firecrawl-versus-PlanCheck PDF gate, including the final public/private capture boundary.
- `06-FIRECRAWL-RUNTIME-IMPLEMENTATION-PLAN.md` turns the selected Firecrawl-primary, Serper-fallback route
  into the next bounded production-enablement slice. It is a plan only; the runtime still uses Tavily until
  that slice is implemented and accepted.
