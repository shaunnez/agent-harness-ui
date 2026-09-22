# Resume with Sol: two H05 comparison runs

> **Terminal:** the authorized pair was launched on 22 September 2026 and both attempts were invalidated by a coordinator-side SQLite monitoring error before Implement. Do not resume or reuse that campaign. Read `docs/MODEL-EVALUATION-CODEX-COMPARISON-RESULT.md` for the adjudicated result and replacement boundary.

## Latest user decision

Shaun accepted two parallel Codex-only H05 runs, comparing Sol High against Luna High for implementation and repair. His Claude allowance is exhausted. He wants to compact before execution and use Sol as the coordinating agent because Astra is expensive. **Do not launch while writing this handoff. After compaction, his continuation instruction starts this bounded comparison without another permission loop.** The coordinating thread's model is selected separately in Codex; this file does not change it.

This supersedes the previous single mixed-provider trial proposal and the recommendation to wait for a separate retained-package failure-routing fix. That follow-up is not a prerequisite. The actual stale-base fix, `09737b7`, is already included. Do not implement unrelated harness improvements. Do not touch AH-094 or AH-096, user services or user project checkouts. H02 and its repair exercise remain parked; ENG-977 remains deferred.

## Source and existing evidence

Use `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui`, branch `codex/model-evaluation-cross-project-prep`. Before this handoff, HEAD was `009e4cf2db85374d985180f3d3ca17f995d6694b`, based on main `09737b70d646edf22c472d9f6422272f87ed8331`. Refresh Git/process/ledger state, preserve dirty work and rebase if main has advanced. Do not change a frozen campaign's source afterward.

Read `docs/MODEL-EVALUATION-PREPARATION.md` for qualification evidence, not its superseded execution proposal. H05 replays a small catalog bug: discovered models must stay selectable when configured; unsupported models remain disabled. Its exact base, scoped reference, public brief and seven-check grader are already qualified. Base/reference full manifests passed; the reference and alternative valid control passed 7/7, while the base and a defective mutant were rejected. The grader passed under the actual grading sandbox. Do not redo that entire preparation unless source/grader changes invalidate it.

Private evidence: `/Users/shaun/.codex/model-evaluation/20260922/cross-project-prep-v1`. Latest code verification: 874 core tests at concurrency two plus lint/format/types/manifest passed. An earlier default-concurrency timing failure is documented; don't change test deadlines. Current Strata already contains the corrected disclosure assertion: its recorded failure was on an old benchmark base. M01/P03 remain out of scope.

## Frozen comparison

Use H05, standard profile, identical task/public answers, initial base, manifest, graders and repair limits in both arms. Only Implement and Repair differ:

| Role | A: Sol implementation | B: Luna implementation |
| --- | --- | --- |
| Triage / scouts | Luna High | Luna High |
| Grill / Specification / Plan | Sol High | Sol High |
| Implement / Repair | **Sol High** | **Luna High** |
| Dev Review / Final Review, when model-owned | Sol High | Sol High |
| Test narrative | Luna Medium | Luna Medium |
| Independent blind review, only after behavior passes | Sol High | Sol High |

IDs are `gpt-5.6-sol` and `gpt-5.6-luna`. No Claude calls, Claude availability probes involving inference, Astra calls or silent substitutions. Enforce the provider restriction at dispatch, not merely in prompt wording. Keep independent review blind to arm/model and other results. It is a common evaluator, not a claim of model-family independence.

Exactly two delivery trials total, maximum two concurrent; package concurrency one per trial. Per trial retain two hours / 200M total tokens including cached input, one hour per model call, two package corrections and two shared standard-profile candidate repairs. Each eligible independent review has one hour / 30M tokens and at most one invocation. No automatic replacement, additional repeats or model escalation. This is a first comparison sample, not an established ranking or reliable pass-rate estimate.

## Ordered execution

1. Inspect durable state before starting. No new evaluation providers had run when this handoff was written. Never restart a worker merely because its terminal is missing; check its task, ledger and process identity first.
2. Make the smallest runner adaptation for this explicit two-arm mode. `prepare-batch.mjs` currently supports only one balanced H05 trial, with Sonnet implementation; **do not launch it unchanged**. Freeze both Codex-only matrices, `trialConcurrency: 2`, separate stores/ledgers/workspaces, and ensure each arm cannot read the other's files or outputs. Keep H02 behavior intact. Test the matrix, provider restriction, limits and sibling isolation without real inference; run relevant quality checks. Commit before freezing.
3. Prepare a NEW private campaign directly under `/Users/shaun/.codex/model-evaluation/20260922/`, with a NEW `/private/tmp/h-eval-...` public root. Do not reuse the nested `cross-project-prep-v1/h05-runner-preflight` bundle. Prepare both arms before either dispatches, so sibling deny paths cover both. Verify reference fixes, prior candidates, private graders/history and sibling trials are inaccessible using native provider controls. Check current Codex availability; stop if exhausted rather than substituting providers.
4. Run the exact frozen repository baseline and zero-inference task admission for both public checkouts. Check no external integrations or publishing are enabled. Historical receipts alone don't qualify a new checkout. All required gates must pass before starting a worker.
5. Launch both workers with process-scoped idle-sleep prevention and capture independent immutable receipts. Model inference is remote; this M5 has 24 GiB RAM. Cap local verification concurrency consistently in both arms if needed and record it before dispatch. Parallel timing is observed throughput under shared host load, not a precise standalone latency comparison.
6. Monitor with brief updates and bounded polling. Don't modify prompts, models or source mid-trial. Stop for apparatus uncertainty or unknown active consumption; preserve the evidence. No manual candidate rescue. Do not add a third trial if one fails.
7. Finalize each terminal trial. Run its seven-check grader, then at most one blind review if eligible. Serial finalization is fine. Check every provider receipt settles and reconcile all usage, including repairs and helper calls.
8. Save a concise results table: arm, workflow result, independent behavior, review verdict, first-attempt/eventual acceptance, repairs, time, input/cached/output/total tokens, and intervention. Label apparatus failures separately from candidate defects. Explain what the two observations support and what remains uncertain. Update the private CURRENT pointer and repository result/handoff; stop. No PR, merge, deployment, policy promotion, H03 or cross-project campaign.

## Copyable continuation

Continue from `docs/MODEL-EVALUATION-CODEX-COMPARISON.md`. Run the authorized two-arm H05 comparison: Sol High versus Luna High for Implement/Repair, Codex-only throughout, maximum two trials in parallel, existing generous allowances. Reconcile main and complete the small runner/preflight work first. Do not wait for the unrelated retained-package follow-up, touch AH-094/AH-096, or launch extra trials. Finish independent acceptance and report the comparison.
