# Fresh blind review closeout — 22 September 2026

**The fresh candidate is not accepted.** Its workflow and nine corrected behavior checks passed, but the blind reviewer identified a missing downstream handoff. A deterministic diagnostic confirms that automatically accepted Grill answers do not enter the specification agent's decision context. No candidate code was changed.

The formal blind grade is **ungraded**: the single review consumed 229,204 tokens against its frozen 200,000-token allowance. Its raw verdict was rejection, not a pass lost solely to the limit. Preserve the invalid grading attempt and the confirmed defect separately; neither justifies another delivery run or an automatic grading retry.

## Result and evidence

| Item | Observed result |
| --- | --- |
| Exact candidate | `0389a30f502e63fe8cbccac399dcc874a4792afd`, C1 revision 2; unchanged and clean |
| Fresh delivery | 42m24s, 23,055,087 tokens, one automatic repair, 19 provider calls |
| Internal gates and full manifest | Fresh Dev Review, Test and Final Review PASS; lint, types, 387 tests, build and four Sites tests passed |
| Original frozen behavior checker | 7/9, rejection retained unchanged |
| Corrected h02-v2 behavior checker | 9/9; narrow snapshot-layout correction and controls retained |
| External review | Sol High, one call, 118.629s, 229,204 tokens including 187,904 cached input; all usage known |
| Raw external findings | P1 missing automatic-answer decision context; P2 incorrect zero-question completion wording |
| Formal external grade | Invalid token overrun; `grade.json` was not produced. Four successful inspection commands also exceeded the prompt's requested maximum of three |
| Supplemental diagnostic | Real candidate orchestration and prompt builder, synthetic SQLite, mocked providers: context omission reproduced, manual control passed, zero model calls |

The retained candidate's `server/orchestrator.mjs:1147` sets answers and automation provenance on `grillSession`, then starts specification. It does not add those selections to `task.decisions`. `server/prompts.mjs:117` supplies decisions and the original Grill artifact; it does not supply the completed session. The operator path at `server/orchestrator.mjs:589` does populate decisions.

The diagnostic captured the actual dispatched specification prompt. Automatic selection produced zero decisions and no decision source in the context manifest. Changing the resolved session's answer and attribution left the prompt and manifest identical. The manual accept-remaining control produced one decision and included it downstream. Proposed recommendations remain in the original artifact; the missing information is their authoritative selection and automation provenance. This proves missing context, not what a particular model would infer or generate.

The smallest correction would supply resolved Grill answers and their true source to the downstream prompt and context manifest. Simply appending automated answers to records labelled “human decisions” would create another provenance defect. The evaluation candidate remains untouched; a product fix is separate work, and this historical candidate is not a patch for current main.

## What this changes

The workflow can execute end to end with the larger limits. Its review and test coverage still missed a consequential handoff defect. Therefore this is not an independently accepted fresh delivery, a demonstrated reliable baseline, or a model-policy winner. The earlier diagnostic candidate's recorded pass concerns a different commit and does not validate this candidate or establish suite completeness.

The nine deterministic checks verified persistence, attribution and stage progression, but did not inspect the specification's received decision context. Add this focused regression to a new checker version, qualify it against the base/reference and a context-loss mutant, and retain all earlier results. Do not change the original nine-check score after seeing the finding.

The grading allowance also needs qualification before another campaign. The review finished in under two minutes; time was not the issue. Repeated cached input contributed 82% of its tokens. Do not rerun the 42-minute delivery to resolve a grading problem, or silently increase this completed attempt's allowance.

## Proposed next work — not launched

First complete the zero-inference checker coverage and review-runner qualification above. That is the next useful unit; further model comparison should wait for a trustworthy acceptance gate.

The smallest subsequent comparison is two fresh H02 deliveries: the balanced policy with Sol High Plan versus the same policy with Astra High Plan. Freeze the same brief, historical base, prompts, environment, new checker and rubric before either run; change only Plan. Randomize arm order, run serially, and use autonomous independently accepted delivery as the sole decision metric. Repairs, tokens, latency and first-pass gates remain diagnostics. One attempt per arm is a screening experiment, not enough to name a winner or promote defaults; agree repeats separately after inspecting it.

Proposed total scope: **two delivery runs, four hours of delivery allowance, 60M delivery tokens and at most 80 provider calls**, retaining the user's 2h/30M/1h per-task/Implement limits. Reserve at most two external grading calls, each with a newly qualified 10-minute/1M-token allowance: **4h20m, 62M tokens and 82 calls in aggregate**. These are proposed allowances, not expected usage or a guaranteed hard token cutoff: in-flight token overshoot remains possible with the existing runner. No silent replacements, automatic campaign repeats or promotion. This proposal has not been dispatched.

## Preservation and accounting

Private evidence root: `/Users/shaun/.codex/model-evaluation/20260922/grading-replay-v2/`.

- `closeout.json`: versioned result, identities, allowances, hashes and accounting.
- `fresh-rubric/{raw.txt,provider-ledger.json,commands.json,error.txt}`: the single invalid grading attempt; no `grade.json` exists.
- `grill-context-diagnostic.json`, `diagnose-grill-context.mjs`, `diagnostic-*-spec-prompt.txt`: reproducible zero-inference confirmation and manual control.
- `workflow-evidence-verification.json`: current derivation of candidate-bound gates and full-manifest evidence from the retained receipt; no tests were rerun.
- `blind-review-preflight.json`: unchanged source/candidate checks and a recorder correction. An initial recorder assertion confused the raw rubric file hash with the freeze's compact-JSON hash; the shell continued to the one requested review. Source equality had already been checked before dispatch and was reverified afterward. No rubric drift or second invocation occurred.

All original delivery receipts, SQLite, provider ledger, original checker result and batch report retain their recorded hashes. The candidate remains exact and clean. The private accounting script now includes replay-review ledgers and checks duplicate invocation IDs.

Incremental usage: **one provider attempt, 229,204 tokens**. Cumulative instrumented usage: **at least 115,548,362 tokens**, including **109,101,008 cached input**, across **155 attempts**, with five historical unknown-usage attempts and **zero active**. This excludes the authoring conversation and unrelated account activity; it is not a billed charge.

No delivery campaign, candidate repair, other-project evaluation, production policy change, PR publication, merge or deployment was started during this continuation.
