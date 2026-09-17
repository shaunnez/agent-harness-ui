# Prompt 2 — Implement Neutral Research Contracts

Prerequisite: `RESEARCH-RUNTIME-ARCHITECTURE.md` is reviewed and accepted.

Implement ONLY the runtime-neutral foundation.

Do not integrate DeepSeek Harness yet.

## Implement
- research domain types
- `ResearchRuntime` interface
- runtime registry/resolution if required
- deterministic fake/in-memory runtime
- minimum persistence for Eversor-level research run metadata
- minimum API surface to create/read/cancel fake runs
- normalized event/artifact mapping
- tests

## Constraints
- existing SDLC behaviour unchanged
- research must not become a `TaskControlOrchestrator` stage unless the approved architecture explicitly requires it
- no runtime-specific fields in core contracts/tables
- no web research
- no DSH
- no LangGraph
- no RAG/vector DB
- no distributed queue
- no local models

Fake runtime must deterministically exercise:
- queued → running → completed
- running → cancelled
- running → failed

## Tests
Prove:
- create request
- start fake runtime
- events/status
- normalized usage
- result/artifact persistence
- cancellation
- relevant restart/read semantics
- no SDLC regressions

## Deliverable
Create `RESEARCH-RUNTIME-CONTRACTS-NOTES.md` containing:
- files changed
- final contracts
- deviations from architecture
- known limitations
- exact next integration seam for DSH

Run relevant tests and report exact commands/results.
