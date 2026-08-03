# Candidate G

## Issue

Structured run activity telemetry and drilldown

## Frozen brief

Implement structured, truthful Run activity telemetry and drilldown in this repository.

Extend the backward-compatible persisted event/run contract with every stable field the runtime genuinely has: run ID and kind, stage, role, model, reasoning, start/end/duration, artifact ID, input/output/cached usage, credits, API-rate estimate, decisions, tests, approvals, retries, and repair relationships. Capture tool-call name/category and a concise result only when Codex JSONL actually exposes it; never fabricate telemetry. Extract a focused RunActivity component under 500 lines with working Activity, Agent runs, Test runs, Decisions, and Tool calls filters, plus artifact/run drilldown. Preserve migration behavior for historical tasks and add parser, persistence/API, render/filter, and interrupted-run coverage.

Acceptance criteria:
- Persisted activity remains backward compatible and records stable run identity, stage/role/model/reasoning, timing, artifact, usage/cost, retry, gate, approval, and repair linkage when available.
- Tool-call rows appear only for genuinely parsed Codex JSONL tool events and never use invented command or result data.
- A cohesive RunActivity component under 500 lines supports Activity, Agent runs, Test runs, Decisions, and Tool calls filters plus artifact/run drilldown.
- Historical tasks migrate safely and interrupted runs retain truthful terminal activity without losing linkage.
- Parser, migration, API/persistence, rendering, filtering, and interrupted-run tests cover the new contract.

Required verification commands:
- npm run lint
- npm run typecheck
- npm test
- npm run build
- npm run test:sites
- git diff --check

## Acceptance criteria

- Persisted activity remains backward compatible and records stable run identity, stage/role/model/reasoning, timing, artifact, usage/cost, retry, gate, approval, and repair linkage when available.
- Tool-call rows appear only for genuinely parsed Codex JSONL tool events and never use invented command or result data.
- A cohesive RunActivity component under 500 lines supports Activity, Agent runs, Test runs, Decisions, and Tool calls filters plus artifact/run drilldown.
- Historical tasks migrate safely and interrupted runs retain truthful terminal activity without losing linkage.
- Parser, migration, API/persistence, rendering, filtering, and interrupted-run tests cover the new contract.

## Verification commands

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:sites`
- `git diff --check`

Base: `4c9d56813ae1787f9099d24efd5a8f67ed90234f`

Brief hash: `6a6b46e06ad20779988e319d7e3f71cdf84de32f22bebe2e72f88f712a564943`
