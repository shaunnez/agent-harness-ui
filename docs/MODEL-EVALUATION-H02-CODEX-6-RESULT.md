# GPT-6 H02 medium-task comparison — 23 September 2026

## Result

The paired Codex-only H02 run is finalized. With every other stage held to the same policy, GPT-6 Sol High Implement/Repair produced an independently accepted candidate; GPT-6 Luna High Implement/Repair did not. This is one UI/API/SQLite task per arm, so it is evidence for this task, not an estimated general pass rate or a reason to change production policy automatically.

| Arm | Implement / Repair | Harness delivery | Independent behavior | Blind review | Supplemental Settings probe | Repairs | Elapsed | Delivery tokens | API-rate estimate |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| A | GPT-6 Sol High | Awaiting Human Approval, full manifest passed | 11/11, accepted | Pass, no findings | Pass | 1 Dev Review | 27m 7.3s | 8,877,205 | $6.067948 |
| B | GPT-6 Luna High | Awaiting Human Approval, full manifest passed | 9/11, rejected | Not run after behavior failure | Pass | 1 Dev Review + 1 Test | 30m 20.2s | 7,887,925 | $2.092732 |

The failed Luna checks were `automatic-specification-context` and `manual-specification-context`. The candidate supplies resolved Grill answers to Specification, but its prompt formatter reads attribution from the duplicate `task.decisions[].answerSource` record. The frozen grader changes the authoritative resolved question's `answerSource` and checks that the dispatched Specification prompt changes with it; Luna's prompt retains stale provenance. This is a qualified information-flow check, not an observed drift in an ordinary task. Sol's formatter reads the resolved question and passes the same check. The internal Dev Review and Test gates did not catch this discrepancy.

Both arms passed the predeclared, separate browser regression probe: clicking **Save model policy** did not persist an unsaved automatic Grill selection. That probe was frozen before either candidate completed and is not retroactively part of the 11-check primary score. Sol's independent blind review used GPT-5.6 Sol High with fresh context and 846,133 additional tokens; those reviewer tokens are excluded from delivery consumption. Luna received no blind review because its behavior checks failed.

## Controlled setup and evidence

- Frozen harness source: `570cf2cdbc35d7cdd80d2dd5cfd0ab3c9e99e41b`, rebased on main `717e51bf9b6a11774c53ea514986dc2e36815c8b`. Both candidate repositories started from the same H02 base `4b303a8da4fafd7a78149ddad40cbf714411d08b`. The exact base passed lint, typecheck, repository tests, build and Sites tests in both isolated workers before dispatch.
- The two task briefs, fixed manual Grill answers, acceptance contract, five-command manifest, high-risk workflow, allowances and all other roles were identical. Triage/scouts used Luna High, Grill/Specification/Plan/Dev Review/Final Review used Sol High, and Test used Luna Medium. There were no Claude or Astra calls.
- The generous bounds were two hours and 200 million delivery tokens per arm, one hour per model call, two package corrections and three shared high-risk candidate repairs. Both completed inside bounds, without human candidate rescue. All 13 Sol and 18 Luna delivery provider invocations settled with known usage. Sol used 8,806,129 input tokens (8,138,880 cached) and 71,076 output; Luna used 7,810,560 input (7,151,744 cached) and 77,365 output. Cached input is already included in input and total. Dollar values are API-rate estimates, not attributable Codex-plan charges.
- Sol candidate C1 revision 2: `a120292679628dad82534d25032321b1db1d2311`. Luna candidate C1 revision 3: `4742783459eca197ec5c08484efb4841c0a45103`. Both worktrees remained clean and at those exact heads after grading. No PR, merge, deployment or production model-policy change occurred.
- Private campaign, frozen configuration, ledgers, independent checks, blind review and supplemental probe receipts: `/Users/shaun/.codex/model-evaluation/20260923/h02-codex-6-comparison-v1`. Public isolated candidate root: `/private/tmp/h-eval-h02-codex-6-v1`. Machine summary: `report.json` in the private campaign.

## Decision

Keep Sol High as the provisional medium-task Implement/Repair baseline. Luna High's lower API-rate estimate did not buy an accepted delivery on this H02 trial; the one-task result is too small to conclude it is unsuitable for all medium work. The next useful comparison is another distinct medium task with the same frozen role matrix and independent acceptance, followed by the held-out hard H03 only after choosing a policy to validate. Do not use H03 for tuning.
