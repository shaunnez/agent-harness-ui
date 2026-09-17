# Prompt 1 — Deep Agents JS Architecture Plan

Act as principal architect for this Node.js/TypeScript agent platform.

Read:
1. `HARNESS-RESEARCH-AUDIT.md`
2. `research-agent-deepagents-spike-pack/00-START-HERE.md`
3. `research-agent-deepagents-spike-pack/01-GOALS-AND-GUARDRAILS.md`
4. `research-agent-deepagents-spike-pack/02-TARGET-INTERFACES.md`
5. `research-agent-deepagents-spike-pack/03-EVALUATION-PLAN.md`

Then inspect the actual repository and verify all material assumptions.

Do NOT modify production code.

## Goal

Design the smallest architectural change that adds a replaceable research capability to Eversor, using **Deep Agents JS as the first implementation candidate**.

Do not make Deep Agents itself the Eversor architecture.

Current hypothesis:
- keep existing SDLC workflow unchanged
- add provider-neutral `ResearchRuntime`
- research runs outside `TaskControlOrchestrator`
- first runtime implementation uses Deep Agents JS
- Deep Agents/LangGraph own generic agent execution mechanics
- Eversor owns run policy, budget, evidence, normalized usage and product integration
- cheap/open worker models are the long-term bulk-compute target
- frontier models are optional escalation/planning/verification tiers
- managed research APIs remain a benchmark/buy alternative

Challenge this if repository evidence shows a better boundary.

## Required current Deep Agents JS research

Before proposing integration, read CURRENT official LangChain/Deep Agents JS and LangGraph documentation/source.

Establish the current package/version and public API.

Specifically investigate:

### Core harness
- `createDeepAgent`
- planning
- filesystem/working-memory behaviour
- built-in middleware
- custom tools
- model/provider abstraction
- model compatibility with OpenAI-compatible local/private endpoints

### Subagents
- static subagents
- dynamic subagents / `task()`
- isolated context behaviour
- parallel fan-out
- structured subagent result schemas
- parent/child state sharing
- recursion/depth behaviour
- call/run limit middleware

### Persistence
- LangGraph checkpointers
- thread IDs
- checkpoints
- fault-tolerance semantics
- stores vs checkpointers
- persistent backing-store options
- what Agent Server/LangSmith provides vs what OSS libraries provide

### Long-running context
- filesystem context offloading
- summarization/context middleware if applicable
- what is automatic vs what we must configure
- what happens as a research job becomes large

### Streaming/events
- stream APIs
- graph events
- subagent visibility
- usage/token visibility

### Security
- Deep Agents' documented trust model
- filesystem backends
- sandbox backends
- shell/code execution
- tool allowlists
- approval/HITL mechanisms
- prompt-injection implications

### Operations
- cancellation/abort semantics
- restart/resume semantics
- failure recovery
- process isolation
- LangSmith optional/required features
- vendor lock-in

Prefer official docs/source. Clearly label anything inferred.

## Deliverable

Create `RESEARCH-RUNTIME-ARCHITECTURE.md`.

Include:

### 1. Decision summary
Should Deep Agents JS proceed to spike, and why?

### 2. Architecture diagram
Mermaid showing:
- existing Eversor UI/API/store
- untouched SDLC orchestrator
- research application/domain layer
- `ResearchRuntime`
- Deep Agents JS adapter
- LangGraph/checkpoint layer
- model endpoint(s)
- tools
- evidence/result persistence

### 3. Ownership matrix
Who owns:
- research run identity
- graph/thread identity
- checkpoint state
- subagent lifecycle
- working files
- context control
- retries
- cost/budget
- source evidence
- final result
- cancellation
- tool permissions
- auth/secrets

Use:
- Eversor
- Deep Agents/LangGraph
- model provider
- search/provider
- infrastructure

### 4. Provider-neutral contracts
Review/refine `02-TARGET-INTERFACES.md`.

No LangChain/Deep Agents types may cross the boundary.

### 5. Exact repository integration map
Name existing files/modules to:
- reuse
- extend
- wrap
- leave untouched

Propose new modules with concrete paths.

### 6. Process boundary
Decide whether Deep Agents runs:
- in current Node process
- worker thread/child process
- separate local service/process
- another boundary

Do not assume a separate service is automatically better. Evaluate simplicity, crash isolation, checkpointing, deployment and security.

### 7. Persistence design
Minimum change for spike.

Separate:
- Eversor run metadata
- LangGraph checkpoint/thread state
- runtime working files
- Eversor evidence/results

Determine whether SQLite can be retained for the spike.

### 8. Model routing
Prove whether we can support:

```text
frontier planner
      |
3–5 Qwen/cheap researchers
      |
frontier verifier
      |
frontier synthesiser
```

Determine whether Deep Agents static/dynamic subagent configuration supports different models by role cleanly.

### 9. Budget enforcement
Determine how to hard-bound:
- max researchers
- max model calls
- max tool calls
- max depth
- timeout
- search calls
- tokens/cost where possible

Distinguish hard enforcement from telemetry.

### 10. Security
Assume model output and fetched web content are untrusted.

First spike should have:
- no arbitrary repo write
- no unrestricted host filesystem
- no unrestricted shell
- explicit tool allowlist
- scoped secrets
- isolated working directory/backend

### 11. Implementation slices
Small mergeable steps:
1. neutral contracts + fake runtime
2. minimal Deep Agents adapter with one agent
3. checkpoint/thread persistence
4. bounded subagents
5. cheap-worker model endpoint
6. research tools
7. evidence result contract
8. benchmark harness

Refine if appropriate.

### 12. LangSmith decision
Explicitly state whether the spike requires LangSmith.

Prefer OSS/local components unless LangSmith materially removes difficult operational work.

If optional, explain what we gain/lose.

### 13. Risks and unknowns
Rank them.

### 14. Go/no-go gates
What must be true before implementation begins?

## Constraints

- no rewrite
- Deep Agents first, not DeepSeek Harness
- do not introduce DeepSeek cloud/model dependencies
- no self-hosted GPU setup yet
- no vector DB unless proven necessary
- no recursive swarm
- default 3–5 researchers
- runtime remains replaceable
- preserve existing SDLC behaviour

At the end print:
1. recommended process boundary
2. whether LangSmith is required
3. recommended checkpoint/persistence approach
4. first three implementation slices
5. five biggest risks

Do not implement.
