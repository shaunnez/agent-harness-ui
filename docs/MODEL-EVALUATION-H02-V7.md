# H02 v7: delivery completed; independent review rejected the candidate

Updated 22 September 2026. **This bounded evaluation is closed. No worker or reviewer remains active.** The harness reached human approval on its first candidate in **36m40.552s**, with all internal gates passing and no repairs. Independent behavior checks passed after a qualified checker correction. The single blind reviewer found a Settings save-scope defect, subsequently reproduced in the browser. The final result is **not accepted**.

## Result and evidence

| Measure | Observed result |
| --- | --- |
| Campaign / task | `feasibility-v7b/F1`, `AH-001` |
| Delivery | `2026-09-22T05:29:11.047Z`–`06:05:51.599Z` (17:29–18:05 Pacific/Auckland) |
| Candidate | C1, `8fe118daa8a58628cda006b5b4154a90b58b17a1`, unchanged and clean |
| Package attempts / repairs | One package attempt; zero package corrections and zero candidate repairs |
| Package qualification | Lint, types, 385 tests, build and four Sites tests passed |
| Integrated candidate | Dev Review PASS, all five Test commands PASS, Final Review PASS |
| Independent behavior | Original h02-v4: 9/11; corrected and qualified h02-v5: 11/11 |
| Independent blind review | Sol High, one invocation, 3m32s; rejected with one P1 |
| Delivery usage | 46,256,929 tokens: 46,116,438 input (45,397,607 cached), 140,491 output |
| Review usage, separate | 608,781 tokens: 603,863 input (539,648 cached), 4,918 output |
| Allowance | Both delivery and review within their agreed time/token allowances |
| Calls | Twelve delivery provider invocations, including two Claude adapter probes; one external review; all settled with known usage |

Usage includes repeated cached input and excludes this authoring conversation and unrelated account activity. It is not an attributable subscription charge. Delivery comprised ten harness agent runs. The retained candidate is `/private/tmp/h-eval-f7b/F1/w/AH-001/C1`; do not edit or clean it.

Private evidence is under `/Users/shaun/.codex/model-evaluation/20260922/feasibility-v7b`. Start with `closeout.json` and `adjudicated-report.json`. `F1/task.json`, `F1/provider-ledger.json`, `F1/delivery-ended.json`, the original `report.json` and freeze remain intact. `CURRENT.md` in the parent records this terminal state. All 51 fingerprinted v5/v6 historical receipts remained unchanged.

## Confirmed rejection

In the benchmark candidate, both Settings save handlers submit the whole editable form. An operator can select automatic Grill without saving that section, then click **Save model policy**, which silently persists the automatic Grill choice as well. The reverse handler also submits unsaved model-policy fields.

The blind finding is at `src/components/SettingsScreen.tsx:79` and `:100`, with the submitted interaction payload at `:106`. The executable browser diagnostic confirmed the consequential direction: persisted Grill policy changed from `manual` to `auto-accept-recommendations` after clicking only **Save model policy**. It used synthetic settings and no model calls. See `F1/settings-cross-save-diagnostic-v2.json` and its screenshot. The first diagnostic could not exercise an alternative reasoning selection in its fixture; that attempt remains separately retained and is not claimed as verification of the reverse direction.

Internal Dev Review and Final Review missed this behavior; therefore neither requested a repair. Automatic repair was configured but **not exercised by this trial**. The independent grader is outside the delivery loop: its finding was not fed back into the completed task, and the evaluator did not fix the candidate. A later repair of this retained candidate would be a separately labelled continuation, not an unassisted first-pass result.

The smallest correction is to scope each save action to its labelled settings, preserve the other section's persisted values, and prevent overlapping saves from overwriting one another. Add regression coverage for both directions and the relevant save concurrency behavior. This concerns the historical benchmark candidate; it is not a diagnosis or modification of the current Frontier runtime.

## Checker correction, fully retained

The original h02-v4 result rejected both specification-context checks because the prompt used readable source labels instead of the literal enum strings. The selected answers, recorded source values and supplied-context manifest were present. A zero-inference diagnostic confirmed the handoff and answer counterfactuals. The contract requires truthful provenance without prescribing the prompt serialization; treating these labels as missing provenance was a checker false negative.

Grader h02-v5 at source commit `8fa39c089d3e80773c9375872fbe458b97bb5e7a` accepts the explicit equivalent labels bound to each answer. It also changes only recorded provenance and asserts that the supplied source changes correctly, rejecting stale or constant attribution. No candidate or public case contract was changed.

Zero-inference qualification at `grader-v5-qualification/qualification.json`:

| Control | Result |
| --- | --- |
| Original valid reference | 11/11 |
| Independently prepared readable-label reference | 11/11 |
| Historical base | 1/11; rejected |
| Missing answer-context mutant | 9/11; rejected |
| Missing provenance mutant | 9/11; rejected |
| False human-attribution mutant | 9/11; rejected |

The unchanged candidate then passed 11/11 in `F1/independent-grade-v5/checks.json`. Only then was the one authorized blind review dispatched. Its original rubric, public brief and anonymous candidate/diff were unchanged; it received no model identity, reference solution or previous grades. It returned a real Settings finding rather than a provenance complaint. See `F1/independent-grade-v5/rubric/grade.json`.

The original frozen v4 task/report/receipts still record rejection; the versioned adjudicated report records the corrected behavior pass and confirmed blind-review rejection. Do not rewrite the original freeze or present this as an untouched frozen-grader experiment. Any future model comparison must apply the same qualified grader to every arm.

## Frozen delivery configuration

Shaun authorized one fresh H02 baseline after PR #119 merged. Delivery source was `1ff36d39ab4d1753e7ca141ebb947c1696694705` on branch `codex/model-evaluation-h02-v7`, reconciled with merged main `a4dba4246e1c21f623d5596d72b9e47ebeeed977`. Original evaluation branch `codex/model-evaluation-20260922` remains preserved at `16760bd4162126d47ff87e00ca81382a8c9aeccc`.

- Unchanged H02 v2 public contract and historical base `4b303a8da4fafd7a78149ddad40cbf714411d08b`; using current main as the case base would change the task.
- Balanced policy: Luna High Triage/scouts; Sol High Grill/Specification/Plan/Dev Review/Final Review; Sonnet 5 High Implement/Repair; Luna Medium Test narrative. Roles were pinned as task overrides, with no model substitution or escalation.
- Delivery: two hours, 200M total tokens including cached input, one hour per stage call, 100 agent runs / 1,000 provider invocations. These are safeguards, not usage targets.
- Automatic Repair enabled. Two additional corrections per package and three shared candidate repairs for high-risk tasks. Settings and limits were snapshotted and checked before inference.
- Separate conditional blind review: one Sol High invocation, one hour / 30M tokens, delivery-rubric-v5.
- Manual benchmark Grill used the unchanged fixed answer sheet. Independent acceptance exercised automatic behavior. No dynamic human advice or candidate edits occurred.

## Preflight and preparation

Reconciliation retained merged automatic repair, Linear integration and Frontier tests, main's deterministic-delivery default, and strict frozen target binding. H02 explicitly selected independent autonomous acceptance as its decision metric. Historical failed trials remain in the denominator.

Before dispatch, harness qualification passed 866 core, 167 Frontier, 18 Frontier API and four Sites tests, plus lint, formatting, types, both builds and manifest coverage. A later focused 52-test suite covered final evaluator/admission changes; these overlap the broader suite and are not additional unique tests. Logs are under the private `preparation-v7` directory.

The exact historical case base passed all five full manifest commands, including 371 repository tests and four Sites tests. API admission, task-snapshotted limits, native confinement, provider availability, clean source/base and absence of duplicate workers were checked. Original grader-v4 controls accepted the reference and rejected the base and context-loss mutant. The laptop was on AC at dispatch; worker and review used process-scoped `caffeinate -is`.

Preparation caught two zero-inference apparatus problems: the API's old 100M validation cap rejected the authorized 200M allowance, and Vite `port: 0` fell through to occupied-port fallback at 5175, outside the historical API's allowed origins. The validator now admits 200M; the grader binds strictly to the allowed 4173 origin. Failed preparation/control receipts remain in `feasibility-v7` and `preparation-v7/grader-controls`. Fresh model execution occurred only in `feasibility-v7b`; neither preparation failure invoked a model.

## Next bounded step

Use the retained Settings finding as a save-isolation regression and repair scenario before spending another complete H02 run. First establish the failing behavior deterministically, then exercise the normal repair path and rerun the affected gates if separately authorized. Preserve the original autonomous result. Freeze the improved acceptance checks before another model comparison.

Keep the balanced grouping provisional. One case cannot establish a model winner, a dependable task-class pass rate, or cross-project reliability; this run provides no live evidence of repair effectiveness because repairs were unnecessary inside the harness. No new campaign, candidate rescue, PR, push, merge, deployment, user-service restart or production policy promotion occurred. PR #123 was explicitly left to the other agent.
