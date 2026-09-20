# Research Runtime Evaluation Plan

## Question

Can Deep Agents JS + cheap/open worker models produce useful PlanCheck research more cheaply while preserving evidence quality?

## Initial corpus

Development:
- 10 known-answer research tasks

Before runtime selection:
- 20–30 representative PlanCheck findings

Eventually:
- 50+ regression cases

Include:
- manufacturer requirements
- equivalent products
- NZ suppliers
- current pricing
- labour assumptions
- standards/guidance
- conflicts between sources
- insufficient evidence
- misleading/injected web content
- private project-document evidence

## Initial comparison arms

A. Deep Agents JS + cheap/open worker model  
B. Managed research API baseline  
C. Existing frontier-model/manual approach

Optional after these:
- NVIDIA AI-Q
- another open harness if Deep Agents has material limitations

Do NOT run a framework zoo merely because projects exist.

## Keep constant where possible

- question
- supplied context
- maximum research depth
- source/search provider
- source-fetch implementation
- output schema
- verifier rubric

## Metrics

### Correctness
- factual correctness
- useful findings
- material omissions
- unsupported claims
- false precision

### Evidence
- citation exists
- citation resolves
- citation actually supports claim
- exact source location retained
- primary source preference
- retrieval date retained

### Research behaviour
- coverage
- contradictions detected
- assumptions surfaced
- unresolved questions surfaced
- duplicate research avoided

### Economics
- total cost/run
- model cost
- web/search cost
- input/output/cached tokens
- model calls
- tool/search calls
- GPU hours if using private inference
- wall-clock time

### Operations
- cancellation
- process restart
- checkpoint behaviour
- subagent failure
- structured-output failure
- hard call/depth limits
- observability

## Minimum gates

Before production consideration:
1. Worker/depth limits are hard bounded.
2. Run can be cancelled.
3. Usage/cost can be estimated.
4. Structured result is reliable.
5. Evidence provenance survives synthesis.
6. Failures are surfaced as failures.
7. Deep Agents types remain behind Eversor contracts.
8. Existing SDLC orchestrator remains unchanged.
