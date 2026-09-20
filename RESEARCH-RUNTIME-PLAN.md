# Research Runtime Plan

## Status

This is the canonical implementation plan for adding a provider-neutral research capability to the existing Eversor agent harness.

Current state as of 18 September 2026:

| Stage | Status |
|---|---|
| Harness architecture audit | Complete |
| Research runtime architecture | Complete |
| G3 Deep Agents compatibility gate | Complete |
| Slice 1: Provider-neutral research foundation | Merged |
| Slice 2: Minimal Deep Agents JS adapter | Merged |
| Vertical research demo | **Next** |
| Bounded subagents | Not started |
| Cheap/open model workers | Not started |
| PlanCheck benchmark | Not started |
| Production hardening | Not started |

The existing SDLC workflow remains unchanged.

---

# 1. Target Architecture

The existing Eversor harness remains the control plane.

```text
                     Eversor Products
                   PlanCheck / future apps
                            |
                            v
                 Eversor Agent Platform
          auth / jobs / budgets / approvals
            events / artifacts / operator UI
                            |
                            v
                    ResearchRuntime
                            |
             +--------------+--------------+
             |              |              |
             v              v              v
       Deep Agents JS   Managed Research   Future runtime
                           API              AI-Q / other
             |
             v
      research execution
             |
      +------+------+------+
      |      |      |      |
      v      v      v      v
    model  model  model  tools
             |
             v
                    Evidence Plane
          claims / sources / snapshots
       citations / products / suppliers
      prices / assumptions / contradictions
             |
             v
                         PlanCheck
```

## Core architectural rule

Research is not another `TaskControlOrchestrator` stage.

The SDLC pipeline and the research runtime are separate capabilities behind the same Eversor control plane.

---

# 2. Ownership Boundaries

## Eversor owns

1. Research request identity.
2. Customer/project association.
3. Budget policy.
4. Runtime selection.
5. High-level lifecycle state.
6. Normalized events.
7. Normalized usage and cost.
8. Cancellation intent.
9. Final structured result.
10. Evidence and provenance.
11. Source snapshots or immutable snapshot references.
12. Product integration.
13. Operator UI and approvals.

## Runtime owns

1. Internal agent execution.
2. Internal message history.
3. Working context.
4. Checkpoints.
5. Subagent state.
6. Internal graph state.
7. Model-specific details.
8. Compaction/context management where provided by the runtime.

## Model provider owns

1. Model inference.
2. Provider-specific token reporting.
3. Provider-specific rate limits.
4. Provider-specific model behaviour.

Eversor should not depend on provider-specific vocabulary above the adapter boundary.

---

# 3. Model Strategy

Long-term target:

```text
frontier planner
      |
      v
3 to 5 cheap researchers
      |
      v
frontier verifier
      |
      v
frontier synthesiser
```

The majority of research should eventually run on inexpensive models.

Candidate bulk worker models include:

1. Qwen3.8-27B through a private OpenAI-compatible endpoint.
2. Mistral-class open models.
3. Other approved inexpensive hosted/open models.

Frontier models should be reserved for work where measured quality justifies the cost.

Self-hosting is a separate infrastructure decision. First prove that the cheap model is capable enough.

---

# 4. Budget Philosophy

Research uses bounded depth profiles.

## QUICK

1 to 2 researchers.

## STANDARD

3 to 5 researchers.

## DEEP

5 to 8 researchers with explicit higher budget.

Anything beyond this requires an explicit policy decision.

Hard ceilings should include:

1. Maximum researchers.
2. Maximum concurrent researchers.
3. Maximum delegation depth.
4. Maximum runtime.
5. Maximum model calls.
6. Maximum tool calls.
7. Maximum search calls.

Token and dollar ceilings are soft in the strict sense because cost is only known after an in-flight call completes.

The platform should stop before the next call once the soft ceiling has been reached and report possible overshoot honestly.

---

# 5. Completed Architecture Work

## Architecture audit

The existing harness was established as:

1. A single-host operator-controlled SDLC application.
2. Node.js/JavaScript backend with React/TypeScript UI.
3. Local Codex and Claude CLI execution.
4. Real bounded parallel scout/package execution.
5. SQLite persistence.
6. Process-owned, non-durable model execution.
7. No generic research runtime.
8. No generic open-model adapter.
9. No web research, RAG or evidence plane.
10. No generic parent/child agent tree.

The key conclusion was that the existing harness is valuable as a control plane but should not be converted into a generic research engine.

---

# 6. G3 Compatibility Gate

Deep Agents JS was validated before integration.

Verified:

1. `deepagents@1.13.4` works on the current Node runtime.
2. LangGraph checkpointing works.
3. SQLite checkpoint persistence survives process restart.
4. LangSmith is not required to execute.
5. Per-role model instances are possible.
6. Abort signals work.
7. Model-call limits work.
8. Tool-call limits work.
9. Graph recursion limits work.
10. General-purpose subagents can be explicitly disabled.
11. Delegation depth can be structurally constrained by omitting the `task` capability from child agents.

Important discoveries:

1. `createDeepAgent({ subagents })` does not disable the default general-purpose subagent.
2. `createSubAgentMiddleware({ generalPurposeAgent: false })` is required.
3. `tools: []` does not remove middleware-provided filesystem tools.
4. `StateBackend` is therefore an important security boundary.
5. Runtime behaviour must be demonstrated experimentally rather than inferred from types or docs.

---

# 7. Slice 1: Provider-Neutral Research Foundation

Status: merged.

Purpose:

Create Eversor-owned research concepts without introducing Deep Agents or LangGraph concepts.

Implemented:

1. `ResearchRuntime`.
2. `ResearchRequest`.
3. Research budgets.
4. Research run state.
5. Research events.
6. Research results.
7. Research findings.
8. Evidence references.
9. Runtime registry.
10. Deterministic fake runtime.
11. SQLite research persistence.
12. Research HTTP routes.
13. Cancellation lifecycle.
14. Usage tracking.
15. Evidence/source tables.

Important deliberate decisions:

1. No `resume()` method.
2. Runtime metadata is opaque and adapter-only.
3. Failed/cancelled runs keep partial usage.
4. Research is completely separate from SDLC execution.
5. Source identity is scoped to the research run.
6. Only Eversor may mark evidence as quote-verified.

---

# 8. Slice 2: Minimal Deep Agents JS Adapter

Status: merged.

Purpose:

Prove a real Deep Agents runtime can execute behind `ResearchRuntime`.

Implemented:

1. One Deep Agents agent.
2. Child-process isolation.
3. NDJSON parent/child protocol.
4. SQLite LangGraph checkpointing.
5. Deep Agents registered as an explicit runtime.
6. Fake runtime remains the default.
7. Anthropic live execution path.
8. OpenAI-compatible model configuration seam.
9. Deterministic fake model for CI.
10. Process-tree cancellation.
11. Normalized runtime events.
12. Usage normalization.
13. LangSmith disabled.
14. Deep Agents/LangGraph imports confined to the child worker.

Proven:

1. Real model execution works end to end.
2. Real checkpoints survive child process exit.
3. Child process failure does not kill the Eversor companion.
4. Cancellation kills the process.
5. Runtime remains replaceable.
6. Public research contracts remain runtime-neutral.

Current capability:

The runtime can execute one real agent and return findings.

It cannot yet perform useful external research because it does not have real search/fetch tools or source evidence.

---

# 9. Next: Vertical Research Demo

Status: **next**.

This deliberately comes before adding subagents.

Goal:

Make one single research agent do one genuinely useful research task.

Add only:

1. `web_search`.
2. `fetch_source`.
3. Host-retained source snapshots.
4. Evidence-linked `submit_finding`.
5. Exact excerpt validation against retained source content.
6. Source retrieval metadata.
7. Basic cost/time/search telemetry.

Example demo:

> Find current New Zealand suppliers, public pricing and manufacturer installation requirements for a specified waterproofing product or system.

Expected result:

```text
Research run
  |
  +-- web searches
  +-- source fetches
  +-- immutable source snapshots
  +-- evidence-linked findings
  +-- exact excerpts
  +-- cost/time/token metrics
  +-- structured result
```

Only after this works should parallel research be introduced.

See `NEXT-VERTICAL-SLICE.md`.

---

# 10. Slice 3: Bounded Researcher Fan-Out

Status: after the vertical demo.

Goal:

Move from one researcher to bounded parallel research.

Target:

```text
planner
   |
   +-- researcher A
   +-- researcher B
   +-- researcher C
   |
   v
fan-in
```

Requirements:

1. Default maximum 3 researchers for the first implementation.
2. `generalPurposeAgent: false`.
3. Named allowed researcher types only.
4. Children cannot receive the `task` delegation capability.
5. Delegation depth is therefore structurally 1.
6. Global aggregate tool-call ceiling.
7. Global model-call ceiling.
8. Bounded concurrency.
9. Worker lifecycle events.
10. Partial result handling.
11. One worker failure must not necessarily destroy all useful research.
12. `exitBehavior: "continue"` for bounded fan-out.

Do not add recursive swarms.

---

# 11. Slice 4: Per-Role Model Routing

Goal:

Prove the cost topology we actually care about.

```text
frontier planner
      |
      v
cheap researchers
      |
      v
frontier verifier
      |
      v
frontier synthesiser
```

Requirements:

1. Planner model separately configurable.
2. Researcher model separately configurable.
3. Verifier model separately configurable.
4. Synthesiser model separately configurable.
5. Usage tracked per model.
6. Cost estimated per model.
7. No model identifiers leak into neutral domain contracts unless represented through an Eversor-owned policy concept.

Initial model test:

1. Frontier Claude/GPT planner.
2. Qwen3.8-27B researchers.
3. Frontier verifier/synthesiser.

---

# 12. Slice 5: Private Qwen/Open Model Endpoint

Goal:

Connect the existing OpenAI-compatible model seam to a real inexpensive model endpoint.

Initial infrastructure experiment:

```text
RunPod Secure Cloud
        |
        v
A100 80 GB or L40S 48 GB
        |
        v
vLLM
        |
        v
Qwen3.8-27B
        |
        v
OpenAI-compatible endpoint
```

Start hosted/private rather than buying office hardware.

Measure:

1. Tokens per second.
2. Time to first token.
3. Concurrent requests.
4. GPU utilization.
5. GPU hours per research run.
6. Total cost per run.
7. Quality relative to frontier workers.

Alternative models should also be benchmarked where useful.

---

# 13. Slice 6: Evidence Plane Hardening

Goal:

Turn citations into defensible evidence.

Required concepts:

```text
Finding
   |
   v
Claim
   |
   +-- EvidenceRef
           |
           +-- source
           +-- snapshot
           +-- exact locator
           +-- excerpt
           +-- retrieval timestamp
           +-- authority
           +-- quote verification
```

Rules:

1. The model cannot self-certify `quoteVerified`.
2. Eversor owns source snapshots.
3. Submitted excerpts must be checked against retained content.
4. Verification result is separate from model confidence.
5. Source authority is recorded.
6. Contradictory sources are retained rather than flattened away.

Construction-specific extensions later include:

1. Product.
2. Supplier.
3. Price observation.
4. Currency.
5. Unit.
6. GST status.
7. Geography.
8. Observation date.
9. Availability.
10. Historical comparable project.

---

# 14. Slice 7: PlanCheck Integration

Goal:

Submit a real PlanCheck issue into the research runtime.

Example:

```text
PlanCheck issue
    |
    +-- issue description
    +-- cited document pages
    +-- project metadata
    |
    v
ResearchRequest
    |
    v
Deep Agents research
    |
    v
VariationResearchBundle
```

Initial research profiles:

1. Product research.
2. Supplier research.
3. Cost research.
4. Standards/guidance.
5. General variation research.

PlanCheck should reference source/project context by identifier rather than dumping an entire corpus into one prompt.

---

# 15. Slice 8: Evaluation Harness

Goal:

Measure whether this system is actually better.

Start with 10 known-answer tasks.

Expand to 20 to 30 real PlanCheck findings.

Eventually maintain a 50+ case regression corpus.

Compare:

1. Existing PlanCheck frontier stack.
2. Deep Agents plus cheap workers.
3. Hybrid cheap workers plus frontier verification.
4. One managed research API baseline.

Measure:

## Quality

1. Accepted findings.
2. Recall against known useful findings.
3. False positives.
4. Unsupported claims.
5. Evidence fidelity.
6. Citation correctness.
7. Contradictions detected.
8. Human QS usefulness.

## Economics

1. Total cost per run.
2. Model cost.
3. Search/retrieval cost.
4. GPU hours.
5. Model calls.
6. Search calls.
7. Input/output tokens.

## Time

1. Wall-clock run time.
2. Queue time.
3. Model latency.
4. Search/fetch latency.
5. Parallel speedup.

The key business question is:

> What percentage of expensive frontier workload can be replaced without materially degrading accepted findings?

---

# 16. Slice 9: Managed Research API Benchmark

Goal:

Determine whether commodity web research should be bought instead of built.

Candidate comparison providers include:

1. You.com Research API.
2. Parallel Task API.
3. Exa Agent.
4. Gemini Deep Research.
5. Perplexity research/agent APIs.

The platform should support a managed runtime adapter behind the same `ResearchRuntime`.

If a managed provider can produce equivalent evidence quality for a few cents per request, use it where appropriate.

Private customer/project-document research may still justify the controlled Deep Agents path.

---

# 17. Slice 10: Operational Hardening

Only after research quality is proven.

Potential work:

1. Orphan child recovery.
2. Checkpoint pruning.
3. Source snapshot retention policy.
4. Distributed/tenant-aware admission.
5. Global provider concurrency.
6. Global GPU concurrency.
7. Rate limiting.
8. Cost admission control.
9. Production authentication.
10. Customer isolation.
11. Private cloud/container security.
12. Background job recovery.
13. Long-lived run reconciliation.

Do not build these before the research workflow has proven useful.

---

# 18. Slice 11: Knowledge and Retrieval Layer

Only after real research usage demonstrates the need.

Potential components:

1. Historical research lookup.
2. Product database.
3. Supplier database.
4. Price history.
5. Previous variation outcomes.
6. Full-text retrieval.
7. Vector retrieval.
8. Reranking.
9. RAGFlow or another retrieval platform.
10. Knowledge graph if justified.

Do not begin with a giant RAG/data-lake project.

The research workflow should tell us which retrieval patterns matter.

---

# 19. Deployment Strategy

Expected long-term inference tiers:

## Tier 0

Deterministic code.

## Tier 1

Private/open models such as Qwen, Mistral or gpt-oss-class models.

Use for extraction, classification, enumeration, routine research and candidate generation.

## Tier 2

Approved cheap cloud models.

Use for burst capacity and commodity work where privacy policy allows.

## Tier 3

Frontier models.

Use for difficult planning, adjudication, verification and high-value synthesis.

The harness should route workloads rather than commit Eversor to one model vendor.

---

# 20. Security Principles

1. Customer documents should not be sent to unapproved shared endpoints.
2. Open model weights are different from the model creator's hosted API.
3. Private inference should use controlled infrastructure.
4. Tool permissions are technical boundaries.
5. Prompt instructions are not security boundaries.
6. Web content is untrusted.
7. Model output is untrusted.
8. Evidence verification is host-owned.
9. Child process isolation is fault isolation, not an OS sandbox.
10. Production research workers should eventually use container/VM security boundaries where sensitive data is involved.
11. Secrets must be explicitly allowlisted into workers.
12. Research workers should not receive repository write/shell access by default.

---

# 21. Immediate Order of Work

```text
DONE
Architecture audit
      |
DONE
Research architecture + G3
      |
DONE
Slice 1 neutral ResearchRuntime
      |
DONE
Slice 2 Deep Agents adapter
      |
NEXT
Vertical single-agent web research demo
      |
THEN
Bounded parallel researchers
      |
THEN
Per-role model routing
      |
THEN
Qwen/private endpoint
      |
THEN
PlanCheck issue integration
      |
THEN
Benchmark against current PlanCheck
      |
THEN
Managed research API comparison
      |
THEN
Production hardening
```

The guiding rule from this point forward is:

> Prove useful research before adding more orchestration.
