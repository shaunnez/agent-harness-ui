# Active continuation — feasibility F1

Updated 22 September 2026. The user has now authorized increasing the evaluation to **2 hours/task, 30M total tokens, 1 hour/Implement or Repair call**. One trial of the unchanged balanced configuration is running. No repeat is scheduled.

Live run brief: [/Users/shaun/.codex/model-evaluation/20260922/feasibility-v1/RUN.md](/Users/shaun/.codex/model-evaluation/20260922/feasibility-v1/RUN.md).
Frozen implementation: `47380d366b08ff68158671215ffb77ea012f788d`. Worker session `7238`. Do not rerun F1 or mutate frozen source. Inspect the SQLite/provider ledger first after compaction. The earlier completed Batch A and its findings below remain intact.

---

# Model evaluation continuation pointer

Updated: 22 September 2026. **Batch A complete: all three policies delivered 0/3 accepted candidates.** No active evaluation workers remain; no production policy changed. The 24-run held-out campaign was not launched because this screen did not justify it.

Canonical implementation: `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui`
Branch: `codex/model-evaluation-20260922`
Final local commit: `789f0a1a3dda8a20d372422bc70a8ae2d5d1d40f` (not pushed).

- [Results and recommendation](/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui/docs/MODEL-EVALUATION-RESULTS.md)
- [Prioritized follow-up issues](/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui/docs/MODEL-EVALUATION-FOLLOW-UPS.md)
- [Complete checkpoint, receipts and continuation](/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui/docs/MODEL-EVALUATION-CHECKPOINT.md)
- [Runner scope and commands](/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui/evaluations/README.md)

Next work is bounded package recovery, compatible path ownership and feasible task/stage allowances before a new frozen comparison. Do not rerun completed A1–A9 or treat passing slices as successful deliveries. Twelve cases are selected; H02 alone is live-qualified, with partial preparation for H01/M01/P04.

Final local checks: 761 repository tests, 51 focused eval tests, lint, formatting, typecheck, build and 4 Sites tests passed. Existing source changes in this checkout and the other projects remain preserved.

Private evidence: `/Users/shaun/.codex/model-evaluation/20260922`. Earlier checkpoint history is retained there in `checkpoint-history-through-a9-launch.md`. All trial failures, unknown usage, historical campaigns and frozen/corrected scorer reports remain intact.
