# Prompt 2 — Implement Provider-Neutral Research Contracts

Prerequisite:
`RESEARCH-RUNTIME-ARCHITECTURE.md` has been reviewed and approved.

Implement ONLY the neutral Eversor research foundation.

Do not integrate Deep Agents yet.

Implement:
- research domain types
- `ResearchRuntime` abstraction
- runtime registry/resolution if justified
- deterministic fake runtime
- minimum Eversor run persistence
- minimum API lifecycle for fake research runs
- normalized events
- normalized usage
- results/artifacts
- tests

Constraints:
- existing SDLC unchanged
- no research stages in `TaskControlOrchestrator`
- no LangChain/Deep Agents types in domain/store/API contracts
- no web search
- no LangGraph yet
- no vector DB
- no new distributed queue
- no local inference

Fake runtime must exercise:
- queued → running → completed
- running → cancelled
- running → failed

Tests must prove:
- request creation
- runtime start
- status/events
- usage persistence
- result/artifacts
- cancellation
- persistence/read semantics
- existing SDLC regression suite remains green

Create `RESEARCH-RUNTIME-CONTRACTS-NOTES.md` with:
- files changed
- final contracts
- architecture deviations
- known limitations
- exact Deep Agents adapter seam

Run tests and report commands/results.
