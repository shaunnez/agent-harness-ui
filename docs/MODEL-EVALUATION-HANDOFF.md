# Model evaluation handoff — 22 September 2026

## Read this first

Latest authority: Shaun requested one fresh run instead of cancellation/resume handling. `feasibility-v6/F1` started at 15:00 Pacific/Auckland on 22 September after all five exact-base checks and zero-inference admission/permission preflight passed. Same balanced models, H02 case/base/grader and 2h/30M delivery allowance with 1h stage calls; at most one separate 1h/30M Sol High review if independent behavior passes. Source freeze `a1ecaa9` has documentation-only changes since the prior executable freeze. Read [MODEL-EVALUATION-FRESH-BASELINE.md](MODEL-EVALUATION-FRESH-BASELINE.md), private `CURRENT.md`, `feasibility-v6/dispatch.json` and `status.py`. Worker exec session `88663`; inspect durable state before acting and never duplicate it. Cancelled v5 receipts and partial implementation are preserved separately. No cancellation/resume feature work, wider campaign, automatic replacement, model substitution, PR, merge or deployment is authorized.

Latest continuation: Shaun requested the Grill product correction, Frontier UI validation and generous evaluation allowances. **Those fixes are locally qualified; no evaluation or grader is running.** Read [the Grill fix and next-step record](MODEL-EVALUATION-GRILL-FIX.md) first. An isolated fixture-only preview is available on 5174 with its API on 4337. The earlier [blind review closeout](MODEL-EVALUATION-BLIND-REVIEW.md) remains historical evidence: its candidate is still rejected diagnostically and formally ungraded. Do not retry that completed review or rewrite its receipts.

The original goal remains unfinished: establish reliable baseline model/effort groupings for tasks of different difficulty, then optimize cost and latency using repeated real-project tasks. We have demonstrated workflow completion on one Harness case, but the fresh candidate has a confirmed acceptance gap. We have not established an optimal policy, a dependable pass rate across task classes, or cross-project reliability. No production policy was promoted and no benchmark PR was published.

## Working location and identity

| Item | Exact value |
| --- | --- |
| Canonical evaluation checkout | `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui` |
| Branch | `codex/model-evaluation-20260922` |
| Prior blind-review closeout commit | `45875d2aadf0ab33937c1578d851e4cb321e8108`; subsequent Grill/allowance changes are recorded in the linked fix document and current branch history |
| Original offline handoff commit | `614b297facf87171abdd9e38f36f6f2c8d895ba0` |
| Fresh delivery harness freeze | `982894e023e98b07188dd1edd1532c8e5ad08dc2` |
| Main incorporated into that harness | `3878a2419979465a53171cd59a5cff455a6a2646` |
| Original checkout, concurrent edits preserved | `/Users/shaun/projects/agent-harness-ui` at `3878a24` |
| Private evidence root | `/Users/shaun/.codex/model-evaluation/20260922` |
| Fresh campaign | `feasibility-v4/F1` — finished; never restart |
| Fresh candidate | C1 revision 2, `0389a30f502e63fe8cbccac399dcc874a4792afd` |
| Fresh candidate checkout | `/private/tmp/h-eval-f4/F1/w/AH-001/C1` |
| Historical task base | `4b303a8da4fafd7a78149ddad40cbf714411d08b` |

The current harness runs against a historical task base so the target feature is absent at the start. Rebasing the harness onto main does not change that case base. The candidate is an evaluation result, not a patch to apply to current main, where the feature already exists.

Both retained candidates were checked for exact HEAD and cleanliness at the offline handoff. The fresh candidate was checked again before and after the resumed review and diagnostic; it remains unchanged and clean. Preserve all candidate checkouts, commits, ledgers, original receipts, failed slices and diagnostic copies. Temporary paths under `/private/tmp` are retained evidence; do not clean them. Keep reference patches, model inputs, databases and other private evidence out of Git. Main was clean at the start of this continuation. At closeout it has concurrent edits to `src/components/runtime/runtimeCommandPolicy.ts` and `tests/runtime-command-dispatch.test.mjs`; this evaluation did not touch them. Source/evaluation changes are local on the isolated branch, not pushed. No remote CI, merge, deployment or default activation occurred.

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
- Corrected independent behavior checks: **9/9, including browser persistence**. **Fresh independent blind rubric: finished but invalid over its token allowance; raw rejection and confirmed blocking defect.**

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

**The original `feasibility-v4/report.json`, F1 task receipt and original checks intentionally still show the frozen rejection.** Do not silently overwrite them or present that stale raw score as the corrected verdict. The separate versioned replay is `grading-replay-v2/`, including `correction.json`, controls, candidate bindings, original copies and `summary.json`. Corrected formal acceptance remains ungraded because the completed blind review exceeded its allowance. Its raw rejection identifies a context defect confirmed by a separate deterministic diagnostic; do not count the candidate as accepted.

Do not rerun `finalize-trial.mjs` on F1: it already finalized the old checker outcome and its output directory exists. Running `report-batch.mjs` again only reproduces the old receipt. Close out the corrected replay explicitly, retaining original and corrected outcomes plus checker identities. Do not manufacture a second delivery trial or change the original frozen contract to conceal the correction.

## Bounded continuation completed: do not redispatch

One fixed Sol High blind review ran after the user said “continue.” It completed in 118.629 seconds with known usage: 229,204 tokens including 187,904 cached input. It exceeded the frozen 200,000-token allowance, so no valid `grade.json` was emitted. Four successful read-only inspection commands also exceeded the prompt's requested maximum of three. No retry occurred.

The raw verdict was rejection, with P1 missing downstream automatic-answer context and P2 misleading zero-question completion wording. Direct code tracing and a zero-inference diagnostic confirmed the P1: automatic selections persist in `grillSession` but do not enter the specification prompt or context manifest. Manual accepted recommendations do. The original recommended options remain visible as proposals; the actual selection and its provenance are missing.

Evidence: private `grading-replay-v2/closeout.json`, `fresh-rubric/`, `grill-context-diagnostic.json`, and `workflow-evidence-verification.json`. The candidate, delivery receipt, SQLite, original checker result and report remain unchanged. The review ledger is included in `account-usage.py`. Exec session 75384 finished; never resume or redispatch it.

The old pending-review command is intentionally removed from this current handoff. Git commit `614b297` preserves the offline instructions. [MODEL-EVALUATION-BLIND-REVIEW.md](MODEL-EVALUATION-BLIND-REVIEW.md) records the result, diagnostic, runner limitations, and a proposed two-arm comparison with an explicit aggregate budget. The subsequent product fix and review-runner qualification are recorded in [MODEL-EVALUATION-GRILL-FIX.md](MODEL-EVALUATION-GRILL-FIX.md). Independent H02 checker coverage remains the next gate before a new delivery; the earlier comparison proposal is superseded by a single fresh baseline first.

## How far the comparison got

| Work | Result / interpretation |
| --- | --- |
| Historical Batch A (`batch-a-v4`) | Three policies × three repetitions: incumbent, balanced, balanced with Astra Plan. 0/9 accepted under 30m/task, 5M tokens and 15m implementation calls. Failures included limits, ownership and type/caller compatibility. No model winner. |
| Larger-limit feasibility-v1 | Invalid host interruption: laptop slept 21 seconds after S2 started. At least 5,440,742 tokens; one call's usage unknown. |
| feasibility-v2 | Valid ownership failure, 14m00s / 5,079,377 tokens. Plan omitted a coupled fixture. No candidate. |
| feasibility-v3 | Generic planning treatment assembled a qualified candidate, then a frozen-target Git-ref bug stopped Dev Review. Original trial invalid. |
| v3 diagnostic continuation | After the runtime fix, same candidate/policies/original deadline and ledger reached approval after one automatic repair. 29,802,410 cumulative delivery tokens; nine checks and blind rubric passed. Grader used 152,371 separate tokens. Diagnostic only: do not count as clean autonomous delivery. |
| feasibility-v4 | Fresh corrected-harness delivery completed autonomously as described above; corrected behavior passed; blind rubric invalid over budget, raw rejection, blocking context defect independently reproduced. |

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

After the bounded continuation: **155 instrumented provider attempts**, **zero active**, **at least 115,548,362 tokens**, including **109,101,008 cached input tokens** (about 94%). The one new review used 229,204 tokens; the supplemental diagnostic used no model calls. Five settled attempts have unknown usage. Accounting includes failed setup, earlier trials and recorded grading, but excludes this authoring conversation and unrelated shared-account activity. Cached totals are not billed dollars.

The last live Codex usage lookup on 22 September showed 21% weekly usage consumed / 79% remaining **account-wide**; that percentage will drift and cannot be attributed solely to this task. Claude's account allowance was not checked. Do not use this snapshot as a fresh budget authorization.

Prior user authorization covers isolated evaluation with authenticated Codex/Claude subscriptions, and the selected per-task limits persist. The latest continuation completed the one pending review and closeout. It does not automatically start a wider campaign. No purchases/API-key fallback, production activation, PR publication, merges, deployments, user-service restarts or default changes are authorized by writing or reading this document. The bounded grading step is finished and must not be retried automatically; a larger comparison needs an explicit total campaign scope before spending.

On macOS, `caffeinate -is` prevents idle sleep but does not guarantee execution with the lid closed on battery. Record actual host power/sleep conditions. Preserve interrupted trials as such; do not blame the model for host sleep or silently extend the task deadline. No global power settings were changed.

## Evidence map

All following relative paths are under `/Users/shaun/.codex/model-evaluation/20260922`:

- `CURRENT.md`: completed blind-review closeout pointer; no active work.
- `grading-replay-v2/closeout.json`: versioned formal-ungraded/raw-rejected result, confirmed context diagnostic, preserved hashes and incremental usage.
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

## Suggested next-unit prompt (zero inference)

> Read `docs/MODEL-EVALUATION-GRILL-FIX.md`, `docs/MODEL-EVALUATION-BLIND-REVIEW.md` and this handoff in the canonical evaluation worktree. Qualify a new versioned H02 check that verifies automatically accepted answers and their provenance reach the specification prompt and context manifest; use the preserved fresh candidate as a known-bad subject, a reviewed reference, and appropriate controls. The product fix and enlarged review-runner allowance already passed local qualification; preserve them and use the new allowance only for newly frozen work. Preserve every existing candidate and receipt; do not modify candidate code, change production defaults, retry the completed blind review, or launch a delivery campaign. Prepare the acceptance gate for one fresh baseline before any wider model comparison; do not dispatch from this handoff alone.
