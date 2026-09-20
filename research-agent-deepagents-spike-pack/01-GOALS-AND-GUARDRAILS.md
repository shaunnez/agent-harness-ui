# Goals and Guardrails

## Goal

Allow products such as PlanCheck to submit bounded, asynchronous, evidence-producing research jobs without transforming the current SDLC orchestrator into a generic agent framework.

## Initial target topology

```text
frontier planner (optional)
        |
        v
3–5 cheap/open-model researchers
        |
        v
verifier
        |
        v
synthesiser
```

Deep Agents JS is expected to provide the generic agent harness for the first spike.

## Non-goals

Do NOT build in this spike:
- production multi-tenant distributed execution
- a data lake
- a knowledge graph
- a complete RAG platform
- self-hosted GPU infrastructure
- recursive agent swarms
- generic cross-customer long-term memory
- custom context compaction algorithms
- custom subagent lifecycle machinery
- a custom graph/workflow engine

## Hard rules

1. Existing SDLC semantics remain unchanged.
2. Research is separate from `TaskControlOrchestrator`.
3. Deep Agents/LangGraph types do not leak into Eversor domain/API contracts.
4. Runtime implementations remain replaceable.
5. Worker count, depth and runtime have enforceable ceilings.
6. Claims and evidence are separate objects.
7. Citations must retain exact supporting evidence where possible.
8. Tools are security boundaries; prompts are not.
9. Fetched web/document content is untrusted.
10. Do not expose shell or repository write access unless specifically justified.
11. First spike works without vector storage.
12. First spike must expose enough telemetry to calculate cost/run.

## Initial depth profiles

QUICK:
- 1–2 researchers

STANDARD:
- 3–5 researchers

DEEP:
- 5–8 researchers
- explicit higher budget/approval

Anything larger requires an explicit policy decision.

## Initial tools

Required:
- `web_search(query)`
- `fetch_source(url)`
- `read_context(ref)`
- `submit_finding(finding)`

Optional escalation:
- browser automation

## Data ownership

Deep Agents / LangGraph may own:
- thread state
- graph checkpoints
- internal message history
- subagent state
- runtime working files

Eversor owns:
- research request
- run identity
- product/customer/project association
- budget policy
- normalized usage
- high-level events
- final result
- evidence/provenance
- source snapshots or immutable references
- cancellation intent
- runtime selection
