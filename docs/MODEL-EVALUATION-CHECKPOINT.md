# Model evaluation checkpoint

**Current resume entry:** [MODEL-EVALUATION-HANDOFF.md](MODEL-EVALUATION-HANDOFF.md). No evaluations or graders are active. The next bounded unit on explicit continuation is the single pending blind review; do not restart a completed slot.

Updated: 22 September 2026. **Rebased onto merged main `3878a24`. The planning treatment assembled the first qualified candidate, then exposed a frozen-target runtime defect before Dev Review. Its original trial is invalid; the diagnostic continuation passed every gate and independent acceptance after one automatic repair. The fresh frozen trial also reached approval autonomously and passed corrected behavior checks; its external blind rubric is still ungraded. No further model calls are running. No model policy promoted. Batch B was not launched.** Inspect the private live brief before dispatch.

## Current continuation

- User-selected allowances: two hours per task, 30M measured tokens including cache reads, one hour per Implement/Repair call. Keep the balanced models and reasoning unchanged.
- `feasibility-v1/F1` is finalized as **invalid: host interruption**. Package S1 passed TypeScript and all 376 tests in about six minutes. S2 began at 08:15:36 NZST; macOS recorded Clamshell Sleep at 08:15:57. Its timeout fired during DarkWake at 09:25:56. S2 has no edits and there is no integrated candidate. This is not evidence of an hour of productive model execution or a valid model-quality failure.
- Original receipt, power-log evidence and adjudication are retained in private `feasibility-v1/F1/apparatus-adjudication/`; normalized receipt history preserves the original failure. Known usage is 5,440,742 tokens; one interrupted call remains unknown. No manual code rescue or replacement was hidden in that trial.
- Pre-rebase source is retained at `codex/model-evaluation-f1-frozen` (`47380d3`). The evaluation branch was rebased onto current `origin/main` (`3878a24`), including merged task-workspace branches. Only duplicated evaluation documents conflicted. Runtime/evaluation script contents match the earlier freeze.
- `feasibility-v2/F1` is finalized: failed in 14m00s, 5,079,377 measured tokens across nine provider invocations, all usage known. The 2h/30M/1h limits were not exhausted. S1 added a required `RuntimeTask.grillPolicy` field and updated its preview object builder, but Plan omitted `src/hostedAtlasPreview.ts` from ownership. The harness stopped before commit/qualification; no integrated candidate or independent acceptance exists.
- A separate diagnostic copy passes S1's typecheck/test commands with the exact retained changes. Removing only the one-line fixture update reproduces TS2741 for the missing required field. Original failed slice and receipts are untouched. Diagnostic qualification is not delivery acceptance. Evidence: private `feasibility-v2/F1/diagnostic-checks/`.
- `feasibility-v3/F1` tested only Plan's generic ownership guidance, without H02-specific path hints. It planned one coherent package including the required fixture. Sonnet completed implementation in 18m26s (beyond the old 15-minute limit); all five package commands passed and candidate `27536111128c85a3e308e23c2f5674dfdbd1c2a8` was assembled. Total recorded usage: 26,899,370 tokens, all known.
- The original v3 trial then stopped at Dev Review: `mergeState` passed the authority's `commit:<SHA>` identity directly to Git as a ref. The new regression test reproduces the failure. The narrow fix resolves only the exact recorded immutable base commit; malformed/mismatched/missing targets and candidate drift still fail, and frozen targets remain ineligible for merging. The original trial is invalid for an apparatus failure, with its SQLite backup, task/ledger/end receipt and candidate branch retained in `feasibility-v3/F1/apparatus-adjudication/` and `evaluation-f3-original-candidate`.
- Diagnostic continuation: `feasibility-v3/F1/diagnostic-continuation/`, using the preserved candidate and same models. The original absolute task deadline and 30M token allowance are not reset. No evaluator edits to candidate code. This continuation changes harness version, so it cannot establish a clean autonomous accepted-delivery rate; retain separate outcomes and require a fresh frozen trial before promotion.
- Diagnostic result: candidate `65f02c6786574a476ce0b33733167919cf67abc3` (revision 2) reached human approval after one automatic Sonnet repair of missing/null legacy attribution. Fresh Dev Review, the full five-command manifest (387 tests and four Sites checks), Test and Final Review passed. All nine independent checks including browser and the fixed blind rubric passed. Delivery: 29,802,410 tokens, 16 provider invocations, all usage known, about 51 minutes including the apparatus interruption. Separate grader: 152,371 tokens. The original trial remains invalid; this is accepted candidate quality, not a clean autonomous trial. Details in [MODEL-EVALUATION-FEASIBILITY.md](MODEL-EVALUATION-FEASIBILITY.md).
- `feasibility-v4/F1` finished autonomously in 42m24s at 23,055,087 tokens, one automatic repair and 19 settled calls. Candidate `0389a30f502e63fe8cbccac399dcc874a4792afd` (C1 revision 2) passed the full manifest (387 tests plus four Sites), fresh review/Test/final gates, and corrected independent behavior checks 9/9. The original frozen checker returned 7/9 because it assumed a root policy snapshot rather than the allowed `agentConfig` layout; its original result is retained. h02-v2 is qualified against base/reference/mutant (1/9, 9/9, 7/9) and replays both retained candidates without edits or inference. Fresh blind rubric is not run; full external acceptance remains ungraded. No further model calls were started after the user requested a usage/status checkpoint.
- Read the campaign's `RUN.md` and inspect SQLite/ledger/delivery-ended receipt before any dispatch. F1 IDs are local to each campaign. No automatic repeat or wider matrix is scheduled.
- Required preflight: rebased harness checks, exact case-base full manifest, native provider confinement and zero-inference task configuration. Do not launch any PlanCheck or MyStrataAssist case until its exact isolated base passes all required quality checks and its reference/grader are qualified. An unexplained existing lint/type/test failure blocks model dispatch.
- Launch the replacement under a task-scoped macOS sleep assertion (`caffeinate -is`). This prevents idle sleep; it cannot guarantee continued execution when the laptop lid is closed on battery. Preserve and invalidate any host-interrupted trial instead of blaming the selected model or silently extending its budget.

The completed Batch A below is historical and remains unchanged.

Read [MODEL-EVALUATION-RESULTS.md](MODEL-EVALUATION-RESULTS.md) for the decision and [MODEL-EVALUATION-FOLLOW-UPS.md](MODEL-EVALUATION-FOLLOW-UPS.md) for concrete next work. Do not rerun the completed slots.

## Source and authority

- Implementation: `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui`, branch `codex/model-evaluation-20260922`, based on `b585649795887356c25559ffd4a9c7f37316ba31`. Resolve current HEAD with Git; delivery freeze is `543d51c743432ec8326f8ad072b28d6d3ff57832` and corrected scorer is `2c4b9e1845bedd9476822fbe56608ce10bc11fe3`. Later documentation commits do not change trial inputs.
- Original dirty Harness checkout, PlanCheck changes and user services were preserved. No production settings, database, merge or deployment changed. No new PR was published. PR #101 was inspected/attached and selected scorer changes reconciled; its branch was not updated.
- Authority remains isolated development/evaluation with existing authenticated Codex/Claude subscriptions. Purchases, separately billed API fallback and production activation remain outside it.

## Completed comparison

Private root: `/Users/shaun/.codex/model-evaluation/20260922`.
Campaign: `batch-a-v4`; retained public trial checkouts: `/private/tmp/h-eval-a4`.

| Policy | Valid final trials | Accepted | Recorded tokens including cache reads |
| --- | ---: | ---: | ---: |
| Incumbent high-risk | 3 | 0 | At least 8,721,635; one interrupted call unknown |
| Balanced | 3 | 0 | 25,628,376 |
| Balanced with Astra Plan | 3 | 0 | 15,024,013 |

One medium Harness UI/API/SQLite case, H02, under high-risk assurance. Equal limits: 30 minutes, 5M measured tokens, 24 agent runs, 40 provider calls. Existing Implement per-call limit: 900 seconds. Frozen role pins prevent capability escalation. In-flight overshoot is possible and recorded; new dispatch is refused. No candidate reached integrated review/Test/approval; passing packages are partial progress only.

A1 failed type/caller compatibility; A3/A7 failed ownership; A2/A4/A5/A6/A9 exhausted token allowance; A8 hit the implementation-stage timeout. A3 also exceeded the token limit. A8's unknown usage was adjudicated without rerun: all calls had ended, the trial remains a valid failure, and A9 proceeded independently under the original freeze. All nine slots are finalized, with no human code rescue or policy drift.

Decision: retain production configuration pending qualification. The raw-token and stage allowances proved inadequate for the intended quality-first comparison. Fix/qualify bounded pre-candidate recovery and coupled-path planning, calibrate achievable limits without ranking models, then run a newly frozen small comparison. No universal model ranking or repository-wide reliability claim is supported.

## Evidence and receipt-only correction

Every trial directory contains frozen config, SQLite/task snapshot, all-attempt provider ledger, delivery-end/finalization receipts, stage/package summaries, failure analysis and available base-to-slice patch/untracked copies. Solutions and grading inputs stay private.

- `batch-a-v4/freeze.json`: original task, policies, model IDs, manifests, environment and limits.
- `report-frozen-543d51c.json`: original frozen scorer result.
- `report-corrected-v1.json` and `report.json`: same receipts scored after requiring a completed workflow and fresh authoritative SHA-bound review/Test/final-review gates.
- `scoring-replay-audit.json`: version, original/corrected hashes and unchanged outcomes. No trial receipt/candidate changed and no inference reran.
- `delivery-summary.json`: final outcome/resource summary; repository copy `evaluations/results/batch-a-v4-summary.json`.
- `accounting-current.json`: at least 51,789,171 tokens across 99 instrumented attempts for preparation and all campaigns; four usage totals unknown. Excludes this authoring conversation/unrelated account use. Actual subscription charges unavailable.
- Earlier v1/v2 setup failures, v3 budget failure/eight cancelled slots and failed reviewer calibrations remain retained and separate. Historical checkpoint narrative is archived privately in `checkpoint-history-through-a9-launch.md`.

No provider calls remain active. Both serial controllers exited; do not resume their exec sessions. Owned evaluator UI servers/browser tabs were closed. Synthetic P04 PostgreSQL container `model-eval-p04-20260922` is stopped, with data retained. Trial checkouts and evidence are deliberately retained.

## Case bank and verification

Twelve historical cases selected: four per repository and difficulty, six development/six held out. Four additional readiness controls selected, not executed.

- H02: nine independent behavior checks, failing base, passing reviewed reference and rejected seeded mutant; all five baseline commands and calibrated blind rubric passed. Only live-qualified delivery case.
- H01: nine behavior checks and complete command-baseline qualification, including real Settings components. Reference 309 tests pass; the base's one existing target-defect failure must be explicitly declared fail-to-pass. Portable runner/grader and rubric remain.
- M01: six checks, actual calendar browser confirmation and frontend baselines (1,402/1,403 tests). Complete backend/E2E/runner/rubric qualification remains.
- P04: ten PostgreSQL/deadline checks, three rejected mutants, backend tests 5,410/5,414 with eight documented skips each. Seven pre-existing mypy errors block its complete delivery manifest; no P04 live model trial occurred.

Latest implementation verification: 761/761 repository tests; 51/51 focused eval tests; lint, formatting, typecheck, production build and Sites 4/4 pass. Expected `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json` exist. Earlier Frontier API 18/18 and browser scorecard qualification are retained. Logs: implementation `.data/evaluation-preflight/final-*.log`. No remote CI was run.

## Continuation

1. Review the results and prioritized follow-up issue specifications. The next unit is workflow reliability and allowance feasibility, not 24 more held-out runs.
2. Keep completed receipts and failed slices intact. A changed model, prompt, context, recovery policy, environment or limit needs a new campaign/version.
3. Use [evaluations/README.md](../evaluations/README.md) for runner scope and commands. The current runner is H02/macOS-specific; do not substitute another case ID and claim qualification.
4. Before any new run, refresh repository/service state and actual model/provider availability. Declare total-task and stage limits and grade exact final candidates. Promotion remains explicit and evidence-based.
