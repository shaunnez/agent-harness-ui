# Research Runtime Goals and Guardrails

## Goal

Let Eversor products such as PlanCheck submit bounded, asynchronous, evidence-producing research jobs without turning the existing SDLC orchestrator into a generic agent framework.

## Non-goals for the first spike

Do not build:
- a production multi-tenant research platform
- a data lake
- a knowledge graph
- a full RAG platform
- self-hosted GPU inference
- recursive swarms
- generic long-term conversational memory
- custom compaction
- a custom subagent protocol
- a custom workflow DSL

## Hard rules

1. Existing SDLC workflows remain unchanged.
2. Research is a separate capability, not another SDLC stage.
3. Runtime-specific types do not cross the `ResearchRuntime` boundary.
4. Runtime choice remains replaceable.
5. Runs have hard ceilings on concurrency/depth/time and, where possible, spend.
6. Claims and evidence are separate objects.
7. A citation is not sufficient; exact supporting evidence must be retainable.
8. Tool permissions are enforced technically, not by prompt.
9. Web content is untrusted input.
10. First spike works without a vector DB.

## Initial depth profiles

### QUICK
1–2 workers.

### STANDARD
3–5 workers.

### DEEP
5–8 workers and explicit higher budget.

Anything larger requires explicit approval.

## Initial tools

- `web_search(query)`
- `fetch_source(url)`
- `read_context(ref)`
- `submit_finding(finding)`

Browser automation only as fallback.

Do not expose arbitrary repository writes or shell access to research workers by default.
