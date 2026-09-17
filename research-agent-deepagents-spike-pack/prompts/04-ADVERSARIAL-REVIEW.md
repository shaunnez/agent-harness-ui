# Prompt 4 — Independent Adversarial Review

Act as an independent principal engineer.

Review:
- `HARNESS-RESEARCH-AUDIT.md`
- `RESEARCH-RUNTIME-ARCHITECTURE.md`
- `RESEARCH-RUNTIME-CONTRACTS-NOTES.md`
- `DEEP-AGENTS-JS-SPIKE-REPORT.md`
- implementation/tests

Try to break the architecture.

Answer:

1. Did research semantics leak into the SDLC orchestrator?
2. Can Deep Agents JS be replaced without major refactoring?
3. Are LangChain/LangGraph types leaking into Eversor domain/API/store?
4. Are Eversor run state and LangGraph checkpoint state clearly separated?
5. Is resume genuine checkpoint continuation?
6. Is cancellation reliable?
7. Are worker/depth limits enforced outside model discretion?
8. Are call/token/cost limits hard or merely observed?
9. Can different model tiers genuinely be used for planner/researcher/verifier?
10. Does the architecture work with a private Qwen endpoint?
11. Is evidence independent of generated prose?
12. Are source locators retained?
13. Are permissions enforced technically?
14. Could retrieved prompt injection influence privileged tools?
15. What happens if the Deep Agents process dies?
16. What happens if Eversor dies?
17. What happens if LangGraph schema/package versions change?
18. Are we building something LangGraph/Deep Agents already provides?
19. Are we outsourcing something Eversor should own?
20. Is LangSmith becoming an accidental hard dependency?
21. Is the runtime simpler than implementing research directly in the existing harness?
22. Are we ready to benchmark against a managed research API?

Create `RESEARCH-SPIKE-ADVERSARIAL-REVIEW.md`.

Classify findings:
- BLOCKER
- HIGH
- MEDIUM
- LOW

For each BLOCKER/HIGH:
- exact evidence
- consequence
- smallest remediation

Finish with exactly one:
- READY_FOR_BENCHMARK
- READY_AFTER_FIXES
- REWORK_BOUNDARY
- ABANDON_DEEP_AGENTS_SPIKE

Do not select the final production runtime.
