# Prompt 3 — Deep Agents JS Spike

Prerequisites:
- neutral research contracts merged
- fake runtime works
- existing SDLC suite green

Implement a deliberately narrow Deep Agents JS adapter behind Eversor's `ResearchRuntime`.

## Before coding

Read current official Deep Agents JS / LangGraph docs and record:
- exact `deepagents` package version
- relevant LangGraph package versions
- public APIs being used

Do not use undocumented internals unless there is no supported alternative; if unavoidable, stop and document it first.

## Spike objective

Execute one synthetic research job end-to-end:

1. Eversor creates `ResearchRequest`.
2. Deep Agents JS graph starts.
3. Coordinator/planner decomposes task.
4. At most 3 researchers run.
5. Researchers have isolated contexts.
6. Researchers return structured findings.
7. Parent consolidates.
8. Normalized events/usage/results return to Eversor.
9. Cancellation/abort is tested.
10. Thread/checkpoint IDs stay adapter metadata.

## Models

Do NOT hard-code one vendor.

The adapter must prove model configurability.

Target conceptual policies:
- planner
- researcher
- verifier/synthesiser

Prove, if supported cleanly through public APIs, that researchers can use a cheaper/different model than planner/verifier.

The initial cheap worker may use any approved OpenAI-compatible endpoint available in development.

Do not require local GPU inference for this spike.

## Persistence/checkpointing

Use LangGraph's supported checkpoint mechanism.

Prove:
- thread ID handling
- checkpoint creation
- state after interruption
- what restart/recovery actually means
- distinction between graph checkpoint and Eversor result persistence

Do not claim durable continuation unless experimentally demonstrated.

## Working context

Investigate how Deep Agents uses filesystem/context management.

Use an isolated backend/workspace.

Do not give research agents access to the whole repository or developer home directory.

## Subagents

Prove:
- isolated context
- bounded maximum children
- depth ceiling
- structured child results
- failure of one child
- parallel execution if intended

Avoid recursive delegation in the spike.

## Limits

Hard-enforce where possible:
- max child researchers = 3
- max depth = 1
- model-call/tool-call limits
- timeout
- cancellation

Report limits that can only be observed rather than enforced.

## Tools

Initially:
- deterministic `read_context`
- `submit_finding`

Optional:
- one search/fetch implementation if safe credentials already exist

Do not expose:
- unrestricted shell
- arbitrary repository write access
- full host filesystem

## Failure tests

Test:
- child failure
- malformed structured output
- model/provider unavailable
- cancellation while active
- process/application restart against persisted checkpoint
- tool error

## Telemetry

Capture enough data to normalize:
- model
- model calls
- token usage where available
- tool calls
- child start/finish
- duration
- errors
- estimated cost where possible

## Deliverable

Create `DEEP-AGENTS-JS-SPIKE-REPORT.md` containing:
- exact versions
- architecture diagram
- lifecycle mapping
- LangGraph thread/checkpoint design
- model routing proof
- subagent proof
- parallelism proof
- cancellation proof
- restart/resume findings
- context-management findings
- security/tool boundary findings
- telemetry/cost findings
- optional LangSmith value
- production gaps
- recommendation: proceed to benchmark or stop

Do not make Deep Agents the permanent/default production runtime.

Keep it removable.

Run all relevant tests and report exact commands/results.
