# Prompt 1 — Architecture Plan

You are the principal architect for an existing Node.js/TypeScript agent platform.

Read first:
1. `HARNESS-RESEARCH-AUDIT.md`
2. `research-agent-spike-pack/00-START-HERE.md`
3. `research-agent-spike-pack/01-GOALS-AND-GUARDRAILS.md`
4. `research-agent-spike-pack/02-TARGET-INTERFACES.md`
5. `research-agent-spike-pack/03-EVALUATION-PLAN.md`

Then inspect the actual repository and verify material assumptions.

Do NOT modify production code.

## Goal

Design the smallest architectural change that gives Eversor a replaceable research capability without coupling the existing SDLC orchestrator to a particular external agent framework.

Current hypothesis:
- preserve existing SDLC workflow
- add Eversor-owned `ResearchRuntime`
- run research outside `TaskControlOrchestrator`
- evaluate DeepSeek Harness first
- compare Deep Agents JS and a managed research API later
- external runtime owns generic session/compaction/subagent mechanics
- Eversor owns requests, budgets, normalized usage, artifacts, results and evidence

Challenge this where the repository gives a better answer.

## DeepSeek Harness research

Read the CURRENT official DeepSeek Harness docs/source before recommending integration.

Determine:
- SDK/headless embedding options
- sessions/persistence
- events/streaming
- cancellation
- subagents
- per-child model override
- compaction
- workflows
- tool/plugin registration
- storage
- sandboxing
- model adapters
- usage/cost information
- process isolation options

It is a developer preview. Prefer public seams. Do not design against undocumented internals.

## Deliverable

Create `RESEARCH-RUNTIME-ARCHITECTURE.md` containing:

1. Decision summary.
2. Current-to-target Mermaid architecture.
3. Ownership matrix for sessions, compaction, child lifecycle, retry, persistence, run state, cost, budgets, evidence, source snapshots, cancellation, auth and tool permissions.
4. Refined TypeScript research contracts.
5. Exact repository integration map: reuse / wrap / untouched / extend.
6. Minimum SQLite persistence delta for the spike.
7. Event flow into existing UI/store conventions.
8. Recommended DSH process boundary: in-process, child process, local HTTP service or other. Account for developer-preview isolation.
9. Hard budget enforcement design: worker count, depth, timeout, search/tool calls, cost/tokens where enforceable.
10. Security boundary.
11. Small mergeable implementation slices.
12. Risks and unknowns.
13. Go/no-go gates before deeper DSH integration.

Constraints:
- no rewrite
- no Postgres/Redis/vector DB unless essential to the spike
- do not change existing SDLC semantics
- do not build custom compaction/session/subagent machinery if the runtime provides it
- no local inference yet
- no unbounded swarm
- default fan-out 3–5
- runtime implementation remains replaceable

At the end print:
- recommended process boundary
- first three implementation slices
- five biggest architectural risks

Do not implement yet.
