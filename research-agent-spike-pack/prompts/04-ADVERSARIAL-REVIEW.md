# Prompt 4 — Adversarial Architecture Review

Act as an independent principal engineer.

Review:
- `HARNESS-RESEARCH-AUDIT.md`
- `RESEARCH-RUNTIME-ARCHITECTURE.md`
- `RESEARCH-RUNTIME-CONTRACTS-NOTES.md`
- `DEEPSEEK-HARNESS-SPIKE-REPORT.md`
- implementation/tests

Do not praise or rewrite it. Try to break the architecture.

Answer:
1. Did research semantics leak into the SDLC orchestrator?
2. Can DSH be replaced without major refactoring?
3. Are DSH-specific types leaking into Eversor domain/API/store layers?
4. Are Eversor run persistence and runtime session persistence separate?
5. Is resume genuine continuation or rerun?
6. Is cancellation reliable?
7. Are worker count/depth bounded outside model discretion?
8. Are cost limits enforced or merely displayed?
9. Can planner and workers use materially different model tiers?
10. Is evidence independent from generated prose?
11. Are exact source locations retained?
12. Are permissions technical rather than prompt-based?
13. Can untrusted web content gain unintended authority?
14. What happens on DSH death?
15. What happens on Eversor death?
16. What breaks if DSH changes incompatibly?
17. Is the spike too complicated?
18. What generic infrastructure are we unnecessarily rebuilding?
19. What Eversor-specific infrastructure are we mistakenly outsourcing?
20. Are we ready to benchmark DSH against Deep Agents and a managed research API?

Create `RESEARCH-SPIKE-ADVERSARIAL-REVIEW.md`.

Classify findings:
- BLOCKER
- HIGH
- MEDIUM
- LOW

For every BLOCKER/HIGH finding include:
- exact evidence
- consequence
- smallest remediation

Finish with exactly one:
- READY_FOR_BENCHMARK
- READY_AFTER_FIXES
- REWORK_BOUNDARY
- ABANDON_DSH_SPIKE

Do not choose the final production research runtime.
