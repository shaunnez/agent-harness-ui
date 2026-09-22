# GPT-6 H05 migration comparison — 23 September 2026

## Result

Both Codex-only H05 arms delivered their first candidate without code repair, passed the Harness Dev Review, Test and Final Review gates, passed all seven independent behavior checks, and passed one blind Sol 5.6 High review with no findings. The declared acceptance metric is tied at 1/1 per arm. This is one small-task pair, not a pass-rate estimate or evidence that GPT-6 is generally better than GPT-5.6.

| Arm | Implement / Repair | Delivery | Independent checks | Blind review | Gate reruns | Elapsed | Delivery tokens | Reviewer tokens | API-rate estimate |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | GPT-6 Sol High | Accepted, C1 | 7/7 | Pass, no findings | 0 | 10m 51.5s | 2,079,557 | 318,079 | $1.317913 |
| B | GPT-6 Luna High | Accepted, C1 | 7/7 | Pass, no findings | 1 Dev Review | 10m 35.3s | 2,024,754 | 117,910 | $0.818543 |

Delivery usage counts **every provider invocation**, including B's same-candidate Dev Review rerun after a candidate-scope inspection command failed. B made 11 calls, A made 10; all calls settled with known usage. Neither candidate needed a package correction or candidate repair. A used 2,051,339 input tokens, including 1,809,280 cached, and 28,218 output. B used 1,997,910 input, including 1,672,960 cached, and 26,844 output. Cached input is already included in input and total. Review usage is separate. Dollar values are calculated API-rate estimates, not attributable Codex subscription charges.

Both arms ran concurrently on one Mac. Luna's observed delivery was 2.5% faster, used 2.6% fewer tokens and had a 38% lower API-rate estimate. The near-tied elapsed time is shared-host throughput; B's review rerun also affects it. There is no quality winner. The result supports keeping Luna High as a provisional small-task Implement/Repair option behind Sol planning and reviews, with the existing review and test gates. It does not justify a global policy change.

## Candidate and evidence

- Frozen harness source: `a172c520d8239ab12f69fdabc04a91d88412d2f8`, rebased on main `717e51b`; historical H05 base: `56524724e31d17968383d1e24a2b1c70a0a46ca9`.
- A candidate: `519760f5b9c352f59f499d28363b6dfe038b39fe`, three files changed, 165 insertions and two deletions. B candidate: `36cec44bfb0f4b78b2f783072633c4454e17c40f`, two files changed, 99 insertions and two deletions. Both worktrees were clean at grading.
- Each fresh base passed the complete five-command manifest through the real isolated verifier: lint, typecheck, repository tests, build and Sites tests. Native probes confirmed that each arm could read its own repo but could not read its sibling, prior public candidates, current private freeze or earlier private evidence. Zero-inference admission froze only `gpt-6-sol` and `gpt-6-luna`, manual Grill, the role matrix and repair limits; provider ledgers were empty before dispatch.
- Both deliveries used two-hour / 200M-token allowances, one-hour model-call limits, two package corrections and two shared standard-profile candidate repairs. No Claude or Astra calls, human candidate rescue, PR, merge, deployment or production policy change occurred.
- Private campaign and machine report: `/Users/shaun/.codex/model-evaluation/20260923/h05-codex-6-migration-v1`. Public candidate root: `/private/tmp/h-eval-h05-codex-6-v1`.

## Grader apparatus correction

The new whole-evidence-root sandbox deny correctly hid prior evaluation data, but it also hid the Playwright package previously stored below that root. A's first independent grade passed six behavior checks and could not run the browser check. That receipt is retained as `A/independent-grade-apparatus-invalid-v1`; it is an evaluator setup failure, not a candidate failure.

The Playwright 1.61.1 package was copied byte-for-byte outside the protected evidence tree. Its import was proved inside the grading sandbox, then the **unchanged** A candidate was regraded and B was graded using the same copy. Both passed 7/7. The original trial configurations, task snapshots and A's first grade are retained alongside `grader-dependency-relocation.json`; only the grader dependency path changed. Therefore the accepted grades are an explicitly amended apparatus result, not untouched first-grade receipts. A subsequent runner guard rejects a Playwright path under denied evidence before creating a campaign.

## Interpretation and next case

The earlier GPT-5.6 H05 pair also accepted 1/1 per arm, so this migration check found no H05 regression. It cannot establish an intelligence gain, and the changed harness source and separate concurrent runs do not support a controlled 5.6-versus-6.0 latency comparison.

H03 was previously described as a medium candidate in conversation; the case bank actually marks it **hard and held out**. Keep it untouched for later validation. H02 is the qualified medium development task covering Frontier UI, API and SQLite behavior. The follow-on GPT-6 Sol-versus-Luna Implement/Repair comparison is now recorded in [MODEL-EVALUATION-H02-CODEX-6-RESULT.md](MODEL-EVALUATION-H02-CODEX-6-RESULT.md). Its earlier Sonnet-based run passed behavior but failed blind review on a Settings save-scope defect, so internal green gates alone are insufficient.
