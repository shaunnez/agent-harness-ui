# H02 v7: fresh baseline with automatic package repair

Shaun authorized one fresh H02 baseline on 22 September 2026 after PR #119 merged. This unit includes reconciliation with main, full preflight, one delivery and at most one blind review if independent behavior checks pass. No wider campaign, model substitution, candidate rescue, PR publication, merge, deployment or user-service restart is included.

## Frozen configuration

- Harness source: `codex/model-evaluation-h02-v7`, rebased on merged main `a4dba4246e1c21f623d5596d72b9e47ebeeed977`. The original evaluation branch remains at `16760bd`; historical receipts and candidate worktrees are preserved.
- Task: unchanged H02 v2 public contract and historical base `4b303a8da4fafd7a78149ddad40cbf714411d08b`. Independent h02-v3 grader has eleven checks. Using current main as the task base would change the case.
- Balanced policy: Luna High Triage/scouts; Sol High Grill/Specification/Plan/Dev Review/Final Review; Sonnet 5 High Implement/Repair; Luna Medium Test narrative. Harness verification executes commands independently.
- Delivery: two hours, 200M total tokens including cached input, one hour per stage call, 100 agent runs / 1,000 provider invocations. These are safeguards, not usage targets. Single-trial feasibility preparation alone receives the larger token allowance.
- Automatic Repair enabled. Two additional automatic corrections per package; three shared candidate repairs for the high-risk profile. Settings and numeric limits are frozen and checked on the isolated task before inference.
- Conditional independent blind review: one Sol High invocation, one hour / 30M tokens, delivery-rubric-v5. Grading usage remains separate.
- Manual benchmark Grill uses the unchanged frozen answer sheet; automatic Grill behavior is tested by independent acceptance. No human advice or candidate edits during delivery.

## Reconciliation and preflight

Main and the older runner both changed evaluation scoring and frozen target resolution. The reconciled branch keeps main's deterministic-delivery default while the H02 campaign explicitly selects independent autonomous acceptance. Completed failed trials remain in the evaluation denominator. Frozen targets must match the candidate's exact recorded base. Merged automatic repair, Linear integration and Frontier tests remain present.

Zero-inference harness qualification passed: 866 core, 167 Frontier, 18 Frontier API and four Sites tests; lint, formatting, types, both builds and manifest coverage. An earlier focused suite passed 113 checks. Logs are under `/Users/shaun/.codex/model-evaluation/20260922/preparation-v7`.

Before delivery: qualify the exact isolated task base's complete manifest; rerun independent grading controls; verify API admission, task-snapshotted repair/time/token limits, native confinement, provider availability, clean source/case and no duplicate worker. Use a process-scoped idle-sleep assertion. Power was initially on battery; check adequate power before dispatch.

Private fresh campaign: `/Users/shaun/.codex/model-evaluation/20260922/feasibility-v7`. Public isolated candidate root: `/private/tmp/h-eval-f7`. `CURRENT.md` in the private evidence parent records the latest status. No delivery result is claimed by this preparation record.
