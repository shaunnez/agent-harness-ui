# Model evaluation checkpoint

Updated: 22 September 2026. **Batch A complete. No active evaluation workers or calls. No model policy promoted. Batch B was not launched.**

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
