# Model evaluation handoff — 22 September 2026

## Read this first

Shaun requested this handoff before going offline, after expressing concern about time and usage. **No evaluations or model graders are running. Do not launch anything from this document alone.** On an explicit continuation, the first bounded unit is one independent blind review of the retained fresh candidate, followed by an honest closeout. Do not restart delivery or launch a comparison matrix as part of that unit.

The original goal remains unfinished: establish reliable baseline model/effort groupings for tasks of different difficulty, then optimize cost and latency using repeated real-project tasks. We have demonstrated end-to-end delivery on one Harness case. We have not established an optimal policy, a dependable pass rate across task classes, or cross-project reliability. No production policy was promoted and no benchmark PR was published.

## Working location and identity

| Item | Exact value |
| --- | --- |
| Canonical evaluation checkout | `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui` |
| Branch | `codex/model-evaluation-20260922` |
| Latest code commit before this handoff | `33e3c53d3930bf6415081b32d72fd47f395860a6` |
| Fresh delivery harness freeze | `982894e023e98b07188dd1edd1532c8e5ad08dc2` |
| Main incorporated into that harness | `3878a2419979465a53171cd59a5cff455a6a2646` |
| Original checkout, clean at handoff | `/Users/shaun/projects/agent-harness-ui` at `3878a24` |
| Private evidence root | `/Users/shaun/.codex/model-evaluation/20260922` |
| Fresh campaign | `feasibility-v4/F1` — finished; never restart |
| Fresh candidate | C1 revision 2, `0389a30f502e63fe8cbccac399dcc874a4792afd` |
| Fresh candidate checkout | `/private/tmp/h-eval-f4/F1/w/AH-001/C1` |
| Historical task base | `4b303a8da4fafd7a78149ddad40cbf714411d08b` |

The current harness runs against a historical task base so the target feature is absent at the start. Rebasing the harness onto main does not change that case base. The candidate is an evaluation result, not a patch to apply to current main, where the feature already exists.

Both retained candidates were checked again for exact HEAD and a clean working tree when writing this handoff. Preserve all candidate checkouts, commits, ledgers, original receipts, failed slices and diagnostic copies. Temporary paths under `/private/tmp` are retained evidence; do not clean them. Keep reference patches, model inputs, databases and other private evidence out of Git. The main checkout was left clean; source/evaluation changes are local on the isolated branch, not pushed. No remote CI, merge, deployment or default activation occurred.

## What the fresh run actually did

Case H02: **Make Grill manual by default with explicit automation opt-in.** A real, medium Harness UI/API/SQLite feature replay under high-risk assurance:

- Persist a Settings choice between manual and automatic recommendation acceptance, and snapshot it when each task is created.
- Pause for material questions in manual mode; allow zero-question sessions to continue.
- Implement automatic acceptance inside orchestration, preserving trustworthy answer/completion provenance.
- Require explicit operator provenance at answer/finish API boundaries.
- Preserve old answers/reasons and label uncertain legacy attribution.
- Add accessible Settings radios, save confirmation and persisted reload behavior.

| Role | Frozen selection |
| --- | --- |
| Triage and selected scouts | GPT-5.6 Luna High |
| Grill, specification and Plan | GPT-5.6 Sol High |
| Implement and Repair | Claude Sonnet 5 High |
| Dev Review and Final Review | GPT-5.6 Sol High |
| Test narrative | GPT-5.6 Luna Medium |

The harness executes deterministic repository checks separately from the Test model's narrative. Claude adapter probes use Haiku and are included in all-attempt accounting; they are not additional delivery roles. No role/model escalation or evaluator candidate-code edits occurred.

User-selected allowances: **2 hours per task, 30M measured tokens including cache reads, 1 hour per Implement/Repair call**. Other existing stage timeouts stayed unchanged (ordinary calls six minutes; Plan/reviews ten minutes). Limits also include 24 agent runs and 40 provider invocations. Dispatch checks known usage; an in-flight call can overshoot. These are feasibility allowances, not optimized defaults.

### Fresh outcome

- Started `2026-09-21T23:38:18.070Z`; ended `2026-09-22T00:20:41.767Z`: **42m23.697s**.
- **23,055,087 tokens**, including **22,109,734 cached input tokens**; 19 provider invocations, all settled with known usage. Thirteen stage runs.
- Two sequential packages: S1 backend policy/provenance, S2 Settings/client/display. Both qualified and integrated.
- S2 initially edited two unowned stylesheets but reverted those edits itself before submission. Do not report an ownership failure or evaluator rescue for this run.
- Sol review found that `createTaskRecord` allowed `input.grillPolicy` to override Settings. One ordinary Sonnet repair made Settings the sole source and updated tests.
- Exact repaired candidate passed fresh Dev Review, Test and Final Review. Full manifest: lint, typecheck, **387 repository tests**, build and **four Sites tests**.
- Final state: **awaiting-human-approval**. This is workflow completion for the benchmark, not PR publication or full external acceptance.
- Corrected independent behavior checks: **9/9, including browser persistence**. **Fresh independent blind rubric: NOT STARTED.**

### Remaining nonblocking issue

`src/components/runtime/RuntimeGrillPanel.tsx:14` displays “Completed automatically under the auto-accept policy” for a manual-policy session with zero questions. Automatic continuation is allowed, but that label incorrectly implies auto-accept was enabled. Review and Final Review retained this as advisory P2. It remains unfixed. Do not edit the evaluation candidate to remove it before grading. The frozen rubric permits P2/P3 advice alone; the independent reviewer must still assess the public requirements without being told prior findings or verdicts.

## Independent checker correction: preserve both records

The frozen h02-v1 checker returned **7/9** for the fresh candidate. `task-snapshot` and `legacy-evidence` assumed a root `task.grillPolicy`; this candidate uses the existing `task.agentConfig.grillPolicy`. The public contract requires a per-task snapshot but does not prescribe its nesting. This potential mismatch was recorded in `feasibility-v4/prospective-grader-note.json` before grading.

Commit `33e3c53` adds a narrow h02-v2 checker correction: recognize either task snapshot location and remove both when constructing a legacy fixture. Enum, snapshot immutability, provenance, API and browser assertions remain. Qualification used zero model calls:

| Subject | Corrected behavior checks |
| --- | ---: |
| Historical base | 1/9 — rejected |
| Reviewed reference | 9/9 — passed |
| Known-bad mutant | 7/9 — rejected |
| Fresh final candidate | 9/9 — passed, exact SHA unchanged |
| Earlier diagnostic final candidate | 9/9 — passed, exact SHA unchanged |

Old checker SHA256: `c8b65e79c02e46f95fe18d2716f27507a852bf819e88778ab6467abd18c2a644`.
New checker SHA256: `667c8bef2abcd699103965158a2e780d06163f01a6da748b114e0504689c0674`.

**The original `feasibility-v4/report.json`, F1 task receipt and original checks intentionally still show the frozen rejection.** Do not silently overwrite them or present that stale raw score as the corrected verdict. The separate versioned replay is `grading-replay-v2/`, including `correction.json`, controls, candidate bindings, original copies and `summary.json`. Corrected full acceptance remains ungraded until the fresh blind rubric finishes.

Do not rerun `finalize-trial.mjs` on F1: it already finalized the old checker outcome and its output directory exists. Running `report-batch.mjs` again only reproduces the old receipt. Close out the corrected replay explicitly, retaining original and corrected outcomes plus checker identities. Do not manufacture a second delivery trial or change the original frozen contract to conceal the correction.

## First action on explicit resume: one blind review

This is a single fixed **Sol High** read-only external grading call: maximum **5 minutes, 200,000 tokens, one provider invocation**. It uses an anonymous archive, original public brief and base-to-candidate diff, excludes Git history/model labels/reference solutions, and records grading overhead separately. It is not another implementation run.

1. Read this document, private `CURRENT.md`, `feasibility-v4/RUN.md` and `grading-replay-v2/summary.json`. Inspect durable ledgers and output directories before dispatch. All earlier workers/finalizers/replays are finished; do not resume their old exec sessions.
2. Check source branch/HEAD, dirty state and current remote main. Preserve the historical delivery freeze. If main advanced, rebase and requalify before a **future delivery campaign**; do not mutate or rebase retained candidates or rerun their successful tests solely because current main changed.
3. Verify the fresh candidate is still clean at the exact SHA above. If it is missing or dirty, stop and recover from retained Git/evidence; do not substitute a new candidate or patch it manually.
4. Verify `evaluations/rubric-v1.json`, `evaluations/cases/h02-public-contract.md`, `scripts/evaluation/grade-rubric.mjs`, `scripts/evaluation/provider-guard.py` and the Codex runtime have not drifted from the qualified source behavior. The h02-v2 behavior correction is separate from this unchanged blind rubric. Confirm the installed CLI and fixed model/effort are still available; never silently substitute.
5. Before dispatch, ensure proposed output `grading-replay-v2/fresh-rubric/` does not exist. If it exists, inspect its ledger/results rather than rerunning. Add this new output's ledger to the private `account-usage.py` accounting patterns (currently it covers `independent-grade/rubric` paths, but not this proposed replay path), classifying it as grading and deduplicating invocation IDs.
6. On resume, from the canonical checkout, run the command below exactly once. Use a process-scoped sleep assertion and preserve any interruption; do not reset budgets or silently retry a failed/unknown grader.

```sh
caffeinate -is node scripts/evaluation/grade-rubric.mjs \
  /private/tmp/h-eval-f4/F1/w/AH-001/C1 \
  4b303a8da4fafd7a78149ddad40cbf714411d08b \
  /Users/shaun/.codex/model-evaluation/20260922/grading-replay-v2/fresh-rubric
```

7. Require a settled ledger with known usage, successful candidate-file inspection, a valid output contract within the rubric allowance, exact matching `headRevision`, and unchanged candidate HEAD/cleanliness afterward. Preserve failure or unknown usage as ungraded; do not call it zero cost or an accepted result.
8. Combine that verdict with the existing nine corrected checks and fresh candidate-bound full-manifest/gate evidence in an explicitly versioned replay closeout. A passed rubric would establish **one corrected independently accepted autonomous delivery, with one repair**. It would not establish first-pass success, an optimal model policy or a reliable population success rate. A rejection remains a rejection; do not repair the candidate merely to improve the benchmark score.
9. Update private accounting and the handoff/checkpoint/results. Report the result and incremental grading usage. **Do not roll straight into another campaign.** Present the smallest next comparison and its total run/call budget for Shaun to decide after the usage checkpoint.

The command above has not been run. No automation, delayed job or new task was created to run it while Shaun is offline.

## How far the comparison got

| Work | Result / interpretation |
| --- | --- |
| Historical Batch A (`batch-a-v4`) | Three policies × three repetitions: incumbent, balanced, balanced with Astra Plan. 0/9 accepted under 30m/task, 5M tokens and 15m implementation calls. Failures included limits, ownership and type/caller compatibility. No model winner. |
| Larger-limit feasibility-v1 | Invalid host interruption: laptop slept 21 seconds after S2 started. At least 5,440,742 tokens; one call's usage unknown. |
| feasibility-v2 | Valid ownership failure, 14m00s / 5,079,377 tokens. Plan omitted a coupled fixture. No candidate. |
| feasibility-v3 | Generic planning treatment assembled a qualified candidate, then a frozen-target Git-ref bug stopped Dev Review. Original trial invalid. |
| v3 diagnostic continuation | After the runtime fix, same candidate/policies/original deadline and ledger reached approval after one automatic repair. 29,802,410 cumulative delivery tokens; nine checks and blind rubric passed. Grader used 152,371 separate tokens. Diagnostic only: do not count as clean autonomous delivery. |
| feasibility-v4 | Fresh corrected-harness delivery completed autonomously as described above; corrected behavior passed, blind rubric outstanding. |

The v3 cumulative total includes its original delivery; never add those two components twice. The v3 diagnostic final candidate is `65f02c6786574a476ce0b33733167919cf67abc3` in `/private/tmp/h-eval-f3/F1/w/AH-001/C1`.

The enlarged-budget runs used only the balanced grouping, with harness/prompt changes between development probes. They are not a controlled model comparison. No usable comparison has yet been run under the larger limits, across difficulties or across projects. No difficulty router, escalation-policy comparison, open-source-model comparison or default promotion has been completed. Batch B's 24 runs were never launched.

## Work delivered and preflight evidence

- Rebased the isolated evaluation branch onto merged main `3878a24`; only duplicated evaluation documents conflicted. Original main stayed clean.
- Generic Plan guidance (`02a4bb7`) traces coupled type/schema/interface changes into callers, adapters, mocks/fixtures and test registration, encouraging packages that can qualify independently. No case-specific solution hints.
- Frozen-target fix (`2d4f24f`) lets `mergeState` resolve the exact recorded `commit:<SHA>` authority for gate admission. Malformed/mismatched/missing targets and candidate drift still fail; immutable experiment targets remain ineligible for merging. Real-Git regression failed before the fix and passed afterward.
- Qualified runtime fix: 38 focused tests, 762 core tests, lint, format, types, build, Sites and manifest passed. Rebased frontend checks earlier passed 164 Frontier and 18 Frontier API tests; subsequent runtime/checker changes did not touch the frontend.
- Each fresh live case base passed its complete five-command manifest under isolation, plus zero-inference API/store configuration and native provider permission checks. Logs are in the campaign and source `.data/evaluation-preflight/`.
- Checker-only correction was verified through the actual base/reference/mutant and both retained candidates. No broad runtime suite rerun was needed for those isolated checker/documentation changes. No remote CI claim.

Some preparation invocations failed before checks (incorrect direct verifier input or protected-file stdio). Logs were preserved and corrected invocations passed. Those were zero-inference setup errors, not model delivery failures. Do not erase them or infer a failed baseline from them.

## Other projects: mandatory gates before any model call

Read private `CROSS-PROJECT-PREFLIGHT.md`. Shaun explicitly requires healthy **exact isolated case bases**, not merely a healthy current main or frontend-only pass.

- **PlanCheck P04:** historical base `a4da4771802abc024f844b60543c6561317659b2`. Ten independent behavior checks and three rejected mutants qualified; backend base/reference tests 5,410/5,414 with eight documented skips per side. Seven existing mypy errors in `scripts/report_uplift_join.py` and `scripts/diagnose_worksheet_provider.py` block the complete historical manifest. Portable environment/grader and rubric qualification also remain. No model trial ran. The synthetic PostgreSQL container `model-eval-p04-20260922` was stopped, data retained. Preserve the user's dirty PlanCheck checkout; refresh its state before any work. These historical errors are not a claim about current main.
- **MyStrataAssist M01:** historical base `58cc69098fc99f2381b89b3449ab75a5a6b34ecf`. Frontend base/reference tests 1,402/1,403 and six independent behavior checks qualified; actual calendar browser behavior checked. Complete backend/OpenAPI/real-backend E2E/tooling/environment checks, portable grader and rubric remain. No model trial ran.
- H01 has partial preparation but still needs portable grader/rubric and explicit target-defect fail-to-pass classification.

The selected bank has 12 historical cases and four readiness controls; selection is not qualification. The checked-in runner is H02/macOS-specific. Do not substitute another case ID and claim general support. Repairing a broken baseline requires a new recorded bootstrap/base and preservation of the intended target defect, not waived lint/type checks. Do not run unrelated large verification suites during timed delivery trials.

## Usage and authority

At handoff: **154 instrumented provider attempts**, **zero active**, **at least 115,319,158 tokens**, including **108,913,104 cached input tokens** (about 94%). Five settled attempts have unknown usage. Accounting includes failed setup, earlier trials and recorded grading, but excludes this authoring conversation and unrelated shared-account activity. Cached totals are not billed dollars.

The last live Codex usage lookup on 22 September showed 21% weekly usage consumed / 79% remaining **account-wide**; that percentage will drift and cannot be attributed solely to this task. Claude's account allowance was not checked. Do not use this snapshot as a fresh budget authorization.

Prior user authorization covers isolated evaluation with authenticated Codex/Claude subscriptions, and the selected per-task limits persist. The latest instruction is this handoff before offline time. It does not start further work. No purchases/API-key fallback, production activation, PR publication, merges, deployments, user-service restarts or default changes are authorized by writing or reading this document. On explicit continuation, complete the bounded pending grading step without reopening settled choices; a larger comparison needs an explicit total campaign scope before spending.

On macOS, `caffeinate -is` prevents idle sleep but does not guarantee execution with the lid closed on battery. Record actual host power/sleep conditions. Preserve interrupted trials as such; do not blame the model for host sleep or silently extend the task deadline. No global power settings were changed.

## Evidence map

All following relative paths are under `/Users/shaun/.codex/model-evaluation/20260922`:

- `CURRENT.md`: current dispatch pointer; no active work.
- `feasibility-v4/freeze.json`, `preflight-summary.json`, `baseline-verification.json`: fresh frozen inputs and preflight.
- `feasibility-v4/F1/{config.json,tasks.sqlite3,task.json,provider-ledger.json,delivery-ended.json}`: authoritative fresh delivery and original frozen acceptance.
- `feasibility-v4/F1/{stage-summary.json,package-summary.json}` and `feasibility-v4/diagnostics.json`: derived summaries; these retain the original checker rejection.
- `feasibility-v4/prospective-grader-note.json`: checker concern recorded before the result.
- `grading-replay-v2/{correction.json,summary.json,fresh-checks.json,fresh-binding.json,diagnostic-checks.json}`: corrected checker identity, qualification and exact candidate bindings. Original result copies and h02-v1 source are alongside them.
- `feasibility-v3/F1/apparatus-adjudication/`: original invalid delivery, SQLite backup and retained initial candidate evidence.
- `feasibility-v3/F1/diagnostic-continuation/`: resumed diagnostic evidence; its `independent-grade/rubric/grade.json` is the already-completed blind review of the **different** candidate.
- `accounting-current.json`, `account-usage.py`: all-attempt accounting and known coverage limits.
- `CROSS-PROJECT-PREFLIGHT.md`, `evaluator/{H01,H02,M01,P04}/`: private case qualification; never expose reference solutions to delivery agents.

Repository companions: [feasibility results](MODEL-EVALUATION-FEASIBILITY.md), [checkpoint](MODEL-EVALUATION-CHECKPOINT.md), [historical Batch A results](MODEL-EVALUATION-RESULTS.md), [follow-ups](MODEL-EVALUATION-FOLLOW-UPS.md), [method and proposed policies](MODEL-BASELINE-AND-EVALUATION.md), [runner scope](../evaluations/README.md). The older execution brief is historical programme context; this handoff supersedes its dispatch instructions and starting-state snapshot.

## Copyable continuation prompt

> Resume from `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui/docs/MODEL-EVALUATION-HANDOFF.md`. First verify the saved state and that no work is active. Finish only the pending independent blind review of fresh feasibility-v4 candidate `0389a30f502e63fe8cbccac399dcc874a4792afd`, using the fixed Sol High rubric with its existing five-minute/200k-token/one-call allowance. Preserve original checker results and record the corrected acceptance as a versioned replay; do not edit or rerun the candidate. Include the grading call in accounting, update the checkpoint, and report the verdict and incremental usage. Do not launch another delivery campaign, other-project evaluation or production change. Then propose the smallest useful model comparison with an explicit total run and usage budget.
