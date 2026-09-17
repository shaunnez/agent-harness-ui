# Research Runtime Evaluation Plan

## Purpose

Select a runtime using evidence, not framework popularity.

## Corpus

Start with 10 known-answer development tasks, then 20–30 real PlanCheck findings.

Cover:
- product identification
- equivalent products
- manufacturer installation requirements
- NZ supplier discovery
- current public pricing
- labour assumptions
- standards/guidance
- conflicting sources
- insufficient evidence
- misleading web content

## Initial arms

A. DeepSeek Harness + cheap/open worker model  
B. Deep Agents JS + same/closest worker model  
C. Managed deep research API

Add AI-Q, Pi or Hermes only after A–C can be scored consistently.

## Score

### Correctness
- factual correctness
- omissions
- unsupported claims
- false precision

### Evidence
- citation exists
- citation resolves
- citation supports the claim
- exact source location retained
- primary source preferred where appropriate
- retrieval date retained

### Economics
- total cost
- model cost
- search/retrieval cost
- tokens
- search/tool calls
- wall-clock duration

### Operations
- cancellation
- worker failure
- process restart
- event visibility
- hard budget/depth enforcement
- repeatability

### Human usefulness
Domain reviewer: useful / partially useful / not useful, with reason.

## Minimum production-candidate gates

A runtime must:
1. Respect hard worker/depth limits.
2. Be cancellable.
3. Expose sufficient usage for cost estimation.
4. Produce structured output reliably.
5. Retain source provenance.
6. Surface runtime failure rather than inventing confident prose.
7. Stay behind Eversor-owned interfaces.
8. Leave the existing SDLC orchestrator untouched.
