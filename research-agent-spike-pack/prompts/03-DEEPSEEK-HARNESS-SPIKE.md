# Prompt 3 — DeepSeek Harness Isolated Spike

Prerequisites:
- neutral research contracts merged
- fake runtime passes
- existing SDLC suite green

Implement a narrow DeepSeek Harness adapter behind Eversor's `ResearchRuntime` boundary.

This is experimental. DSH remains isolated and removable.

## Before coding
Read current official:
- DSH repository
- architecture docs
- SDK/headless docs
- sessions/persistence
- compaction
- subagents
- workflow
- safety guidance

Record exact DSH version/commit.

Prefer public seams. If the required integration depends on internal undocumented packages, stop and document that risk before creating brittle coupling.

## End-to-end spike
1. Eversor creates `ResearchRequest`.
2. DSH starts via the approved isolated boundary.
3. One planner decomposes a synthetic research problem.
4. At most 3 child researchers run.
5. Children have isolated contexts.
6. Workers return structured findings.
7. Parent consolidates.
8. Normalized events/usage/results return to Eversor.
9. Cancellation works.
10. Runtime session identity stays adapter metadata.

## Models
Do not hard-code DeepSeek.

Prove provider/model configurability.

Keep conceptual policies for:
- planner
- researcher
- verifier/synthesiser

If public DSH APIs support child model/reasoning overrides, demonstrate them.

No local inference required.

## Tools
Initially expose only:
- deterministic context reader
- finding submission

Optionally add one web-search provider if safe credentials already exist.

Do not expose arbitrary filesystem writes or shell by default.

## Limits
Hard-enforce or validate:
- max children = 3
- max depth = 1
- timeout
- cancellation

If cost/search/token limits cannot be truly enforced through DSH, state that explicitly.

## Session/compaction proof
Demonstrate:
- what DSH persists
- session identity
- process restart behaviour
- whether execution can truly resume
- compaction behaviour
- what survives compaction
- Eversor-owned vs DSH-owned state

Do not implement custom compaction.

## Failure experiments
Test:
- child failure
- cancellation during execution
- malformed structured output
- DSH unavailable
- DSH process termination/restart

## Deliverable
Create `DEEPSEEK-HARNESS-SPIKE-REPORT.md` including:
- exact DSH version
- architecture
- lifecycle/event/usage mapping
- model routing proof
- subagent proof
- cancellation proof
- persistence/resume findings
- compaction findings
- permissions/security findings
- developer-preview risks
- production gaps
- recommendation on whether DSH should proceed to benchmark

Do not make DSH the permanent default.
