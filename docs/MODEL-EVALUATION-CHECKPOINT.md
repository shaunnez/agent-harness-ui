# Evaluation checkpoint

Updated: 22 September 2026. Phase: Batch A ready to prepare. No delivery trials or production changes.

## Authority and location

- Implementation worktree `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui`, branch `codex/model-evaluation-20260922`, starting base `b585649795887356c25559ffd4a9c7f37316ba31`. Foundation is being committed; inspect Git before editing or preparing the campaign.
- PR #101 remains open at `272c99e3c615de26b276cddf41dd0c7e529fade1`. Ported only evaluation scorer/decision/scorecard/types/styles/tests, then corrected their integrity gaps. No historical results or unrelated runtime patches merged.
- Original dirty main, PlanCheck dirty files and user services preserved. Authority covers isolated existing subscription runtimes; no purchases, API-key fallback, production activation, merges or deployment.

## Foundation qualified

- Count pre-candidate failures, require exact candidate and complete frozen command definitions, reject divergent policies, retain invalid/pending/cancelled/ungraded trials, bind independent grades and scores to the final candidate.
- Resource accounting includes failed calls and Claude adapter probes via a private provider ledger. Missing usage/cost stays unknown, never a fabricated zero/comparable price.
- Atomic agent reservation checks task limits. Provider wrapper enforces call/time/measured-token limits, refuses further dispatch on unknown prior usage, and protects reference files. Normal provider sandbox/auth remains active. Existing evaluation metric default and production model defaults are unchanged; this campaign explicitly selects independent autonomous accepted delivery rate.
- Latest `npm test`: **749/749 passed**. Typecheck/lint/format/build passed; Sites 4/4; Frontier API 18/18 with process-scoped Git signing disabled. Logs `.data/evaluation-preflight/`. Native dependency installation is local, not shared with the dirty checkout.
- Model IDs and reasoning checked against the local catalog. Codex uses ChatGPT authentication. Claude subscription status was verified with API-key variables removed from the status subprocess; runtime's normal environment already strips them. No keys read or supplied.

## Cases and qualification

- `evaluations/cases/delivery-v1.json`: 12 selected historical cases, four per repo/difficulty, six development/six heldout. Only **H02 is qualified**; other cases remain selected, not ready-to-run golden cases. Four readiness controls are separate.
- H02: manual/opt-in Grill, base `4b303a8da4fafd7a78149ddad40cbf714411d08b`, reviewed change `a798c913988579149a77318db97faf7a850160bb`. Frozen public wire contract in `evaluations/cases/h02-public-contract.md` avoids undisclosed field-name grading.
- Private references `/Users/shaun/.codex/model-evaluation/20260922/evaluator/H02/{base,reference,mutant}`. Reference HEAD `a85aed7dc30bd101dc5dd879904dd7db511ae9eb`, seeded snapshot mutant `804953140a036a5b55858798a772749c73e7baed`.
- Nine independent behavior checks: reference 9/9, unchanged base fails eight, snapshot mutant fails task-snapshot and automatic-provenance while its UI passes. Public task-creation policy override also checked. Baseline regressions 371/371, reference regressions 374/374, both lint/typecheck/build/Sites pass.
- Reference grader passes all nine under the real evaluation OS isolation profile, with a copied Playwright 1.61.1 outside source repositories. Module `/Users/shaun/.codex/model-evaluation/20260922/tools/node_modules/playwright/index.mjs`.
- External fixed Sol High rubric **delivery-rubric-v3** calibrated: `rubric-reference-v4/grade.json` passes in 143,744 tokens; `rubric-mutant-v1/grade.json` rejects the seeded defect in 136,719 tokens. Separate grading ceiling 5 minutes/200,000 tokens/one call. Prior calibration retained: initial wrapper cwd failure, false public-API finding, then a 130,375-token reference pass that exceeded its older 100,000-token limit and is not a valid budget-qualified grade. Calibration changed before any delivery trial.

## Prepared execution tools

- `prepare-batch.mjs <new-private-root> <new-public-root> <source-repo>` requires clean committed harness, reads EVAL_PLAYWRIGHT_MODULE, prepares isolated shallow repos and freezes all nine slots, policy pins, case/grader/harness/environment versions and budgets.
- `trial-worker.mjs <trial/config.json>` runs under its generated worker.sb. Normal API task creation/orchestration, isolated SQLite, fixed simulated benchmark-user answers, ordinary repair limits and no model escalation. Stops at quiescent terminal/wait state or ceiling; never approves/publishes a PR.
- `finalize-trial.mjs <private-trial-directory>` checks candidate SHA/cleanliness, executes private checks and calibrated external rubric, then records the bound receipt. `report-batch.mjs <campaign-root>` includes unlaunched scheduled slots as pending and cannot rank an incomplete batch.
- `provider-guard.py` wraps existing CLIs and counts helper calls. The outer worker sandbox also confines repository tests; the inner provider sandbox denies source repos, evaluator vault, sibling trials, memories/history and implementation checkout. Verified nested sandbox denial. Codex child cwd must use its explicit --cd (regression tested).
- Dry-run `/Users/shaun/.codex/model-evaluation/20260922/dry-run-1`, public `/private/tmp/h-eval-dry1`: A1/A2 API snapshots pass with zero inference. A3 contains an anonymous reference for isolated grader preflight. These are **not delivery samples**.

## Next actions

1. Finish/inspect foundation commit and clean state. Prepare actual campaign `/Users/shaun/.codex/model-evaluation/20260922/batch-a-v1`, public `/private/tmp/h-eval-a1`, from original harness repo with EVAL_PLAYWRIGHT_MODULE set to the copied module above.
2. Run A1 under its worker.sb, inspect telemetry/receipts before any retry. Then grade and proceed through the frozen rotating nine-slot order, one delivery at a time. If apparatus fails, retain/adjudicate it and version any correction; do not pool incompatible runs or manually rescue a model arm.
3. Equal delivery limits: **30 minutes, 600,000 tokens, 24 agent runs, 40 total provider calls**. One trial/implementation package at a time; ordinary bounded scouts may overlap. In-flight token overshoot is recorded and disqualifies an over-budget arm. External grading consumption is separate.
4. All arms use high-risk assurance for this policy/provenance change. Control is actual incumbent **high-risk** role matrix. Balanced: Luna High facts, Sol High reasoning/reviews, Sonnet High implement/repair, Luna Medium Test. Astra variant changes only Plan to Astra High. All ten roles pinned; same-provider repair escalation suppressed.
5. Do not start 24 heldout runs unless Batch A justifies it. Report actual outcomes and limitations, not a model winner from calibration or setup. Production routing changes remain separate.

No owned persistent server is running. Calibration finished. No Batch A campaign has been prepared at this checkpoint; inspect durable state after any compaction before rerunning work.
