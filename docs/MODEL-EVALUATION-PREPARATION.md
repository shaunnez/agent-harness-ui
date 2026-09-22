# Next evaluation preparation — 22 September 2026

**No new delivery or reviewer model calls were made. H05 is the proposed next single trial, but it is not ready for dispatch.** Wait for the retained-package failure activity/repair-admission fix owned by the other agent, reconcile it with this source, then create a new committed freeze. This continuation authorized preparation; a clear instruction to run the prepared trial is still required.

## Source and ownership

- Work only in `/Users/shaun/.codex/worktrees/model-evaluation/agent-harness-ui`, branch `codex/model-evaluation-cross-project-prep`.
- The closed branch `codex/model-evaluation-h02-v7` remains at `64272d3672a94065e38f31eaf2060fe01564c377`. Its candidate, receipts and reports were preserved. H02 repair remains parked; Final Review improvement remains deferred to [ENG-977](https://linear.app/eversor-ai/issue/ENG-977/harness-make-final-review-assess-acceptance-independently-of-earlier).
- Preparation was rebased cleanly onto `146f18065f3505bfaf616480d418bdeabb566a58`, including PRs #123 and #124. All 26 replayed patches were unchanged under range comparison.
- Preparation was then rebased cleanly onto latest main `09737b70d646edf22c472d9f6422272f87ed8331`; all 27 replayed patches remained equivalent. That commit makes retained requalification check the current plan base rather than the original package base. This is a separate correction from the missing failure event/repair admission Shaun reported. Do not mistake it for completion of that follow-up.
- User project checkouts and services were left alone. The temporary MyStrata synthetic PostgreSQL container was stopped and removed; its recorded database URLs no longer refer to a running service.
- All private receipts are under `/Users/shaun/.codex/model-evaluation/20260922/cross-project-prep-v1`. Start with `readiness-final.json`; preserve every failed diagnostic and original result.

## Case readiness

| Case | Result | Consequence |
| --- | --- | --- |
| M01, MyStrata overdue task dates | Frontend passed; exact historical backend has a stale disclosure-template assertion | Blocked before model dispatch. Do not hide the failure or treat it as agent performance. |
| P03, PlanCheck quantity/allowance editing | Exact historical base has 12 formatting failures and seven type errors | Blocked before model dispatch. Reference and full acceptance qualification remain unfinished. |
| H01, configured model visibility | Its historical suite already contains a failing target-defect assertion | Parked. No waiver or general fail-to-pass framework was added. |
| H05, discovered model selection | Base/reference regression manifests pass; independent behavior/browser grader qualified | Best next small trial after source reconciliation, fresh freeze and dispatch preflight. |

These are development cases. Held-out cases were not used. This preparation establishes test apparatus and baseline health, not model quality, pass rate or model equivalence.

### M01 evidence and limits

Base `58cc69098fc99f2381b89b3449ab75a5a6b34ecf`; reviewed source `54f6ec80b08c7add19d22333235af2af3582ddd3`. Fresh isolated dependencies and synthetic database suites were used. Frontend lint/build/types and **1,402 tests** passed, as did backend lint, formatting, types, compilation/import and the ancillary static guards.

The first backend run produced **4,835 passed, three failed, seven skipped**. Two storage matrix failures were caused by preparation's local-runtime environment overrides. All 15 storage tests passed after those overrides were removed to match CI. The disclosure failure reproduced in that corrected environment. There was no clean full backend rerun.

`tests/unit/test_disclosure_pack_postgres.py:1882` expects template hash `b41b96745a24c2c696cf192f842d69948363961ba15b06a387b30f63de25e7af`; the implementation and actual tracked DOCX both use `84bd3f7966593a92d0294384aaf8a48e9bd00635265273ddc867898368cd0ffb`. That stale assertion is unrelated to the calendar task. Six skips are intentional rule-owner exemptions; one requires a real disposable Azure Blob account. No PostgreSQL suite was silently skipped.

Remaining tooling/policy follow-ups, OpenAPI generation stability, E2E, container packaging and full reference qualification were not completed after this blocker. Reprovision synthetic databases before any future attempt. See `M01/base-checks.json`, `static-checks.json`, `backend-tests.xml` and `baseline-failure-diagnostic.xml`.

The portable `evaluations/graders/m01.mjs` checks the pure calendar model only. Its six checks reject the base (3/6) and a mutant that stops overdue obligation sweeping (3/6), while accepting the reference and an alternative valid implementation (6/6 each). `M01/model-grader-qualification-v2.json` binds the final grader hash. It does not qualify browser behavior, backend health or cross-project execution.

### P03 evidence and limits

Base `21c20c8ffeeb2b8a4a19ccff6be286d23a2dbad3`; reviewed source `0acef6ba5f61eb1426424b5a7de29adf1d12723d`. Backend lint passed. Pinned Ruff formatting rejects 12 files; mypy reports seven errors in `scripts/report_uplift_join.py` and `scripts/diagnose_worksheet_provider.py`. See `P03/quality-checks.json` and its logs for exact commands and locations.

Do not describe this replay as proven backend/database implementation coverage: the selected reviewed patch changes frontend editing and translations. No model calls, source repair, frontend/full-suite continuation or reference grader qualification followed the baseline failure. Do not silently substitute P04; it has the same known typing barrier.

### H05 contract and qualification

Base `56524724e31d17968383d1e24a2b1c70a0a46ca9`; reviewed source `f105a0b8a0498a3fc2c9b38a2f4bcf2f89cb2908`. Reconstruct only `server/model-catalog.mjs` and `tests/claude-runtime.test.mjs`; exclude onboarding-provider routing from that source commit.

The task keeps a discovered Claude entry selectable when defaults, allowlists or stage policies reference it. It must preserve discovered Codex behavior, unknown configured models as visible/non-editable, catalog metadata, uniqueness and input immutability. The complete public brief is `evaluations/cases/h05-public-contract.md`.

All five historical verification-manifest commands passed on both fresh base and reference: lint, types, repository tests, build and Sites tests. Repository counts were **282 base / 283 reference**, plus four Sites tests each. This historical manifest has no separate formatting command.

`evaluations/graders/h05.mjs` has seven independent checks, including actual `SettingsScreen`/`AgentPolicyEditor` selection with a synthetic catalog in Chromium. Results: base **3/7**, reference **7/7**, unsupported-model-selectable mutant **6/7**, alternative valid implementation **7/7**. The reference also passed **7/7 under the actual grading filesystem restrictions**, with candidate cwd and piped output, matching the finalizer. Earlier manual sandbox probes failed because their log descriptors pointed into denied private evidence; those are retained apparatus diagnostics, not task failures. See `H05/qualification.json` and `H05/sandbox-control-grade-v3.log`.

This is a historical benchmark UI, not a current Frontier feature change or current Frontier visual acceptance. No product UI was edited.

## Runner changes and proposed configuration

The runner now explicitly supports **H02 and H05 only** through `scripts/evaluation/case-contract.mjs`. H02's public brief, rubric, profile and default CLI behavior are preserved. Unqualified/cross-project case IDs fail before invocation. H05 has its own acceptance contract and rubric and permits only one balanced trial; no comparison campaign was added.

H05 uses the **standard** workflow profile, rather than forcing a small catalog task through high-risk depth. Its provisional model grouping remains unchanged:

| Role | Model / reasoning |
| --- | --- |
| Triage and selected scouts | Luna High |
| Grill, Specification, Plan | Sol High |
| Implement and Repair | Sonnet 5 High |
| Dev Review and Final Review, when model-owned | Sol High |
| Test narrative | Luna Medium |

Keep **two hours / 200M total delivery tokens including cached input**, one hour per model call, two automatic corrections per package and two shared standard-profile candidate repairs. Independent review remains at most one Sol High call after deterministic acceptance passes, separately **one hour / 30M tokens**. These are inherited safeguards, not a spending target. The retired 200k review allowance was not reintroduced.

The zero-inference task-admission exercise created one queued AH-001 task and **zero provider invocations**. Its private root is `cross-project-prep-v1/h05-runner-preflight`, public root `/private/tmp/h-eval-h05-preflight-v1`. **Never start that worker as a paid trial.** It used uncommitted preparation source and nested dry-run directories; it is apparatus evidence only. The next live preparation must use a fresh campaign directly under `/Users/shaun/.codex/model-evaluation/20260922/`, so the existing sibling-path protections include earlier campaigns, and must explicitly verify all private reference and prior-candidate paths are inaccessible. Do not resume or overwrite this dry-run configuration.

## Harness checks

The new runner/guard suite passed **47/47**, using fake provider CLIs only. Review tests cover both cases and consumption above the retired 200k cap; they do not demonstrate real model quality.

Lint, formatting, types and manifest validation passed. The complete core suite passed **874/874 with test concurrency two** on committed source `1c7fe09fdb48ed18d2e73432e331f2aec7ecd2c2` after the final rebase, including the new retained-base regression. Earlier in this preparation the default-concurrency suite hit one existing timing-sensitive research test: its 1.5-second fake run deadline expired before the fake search started. That same test passed alone, and the complete suite passed at concurrency two. No timeout or assertion was changed to conceal it.

Before the final evaluation-only edits, Frontier tests **167/167**, Frontier API **18/18**, Sites **4/4**, production build and Frontier build passed. They were not repeated after those evaluation-only edits. The only unrelated source edit was formatting one assertion in `tests/orchestrator-planning-correction.test.mjs` that made merged main's format check fail.

Private `harness-post-rebase/harness-checks.json` records the final committed-source core/static checks. Its initial focused command accidentally included a nonexistent extra filename; Node ran the 11 planning tests, and the subsequent complete 874-test run supplied the full core coverage. Earlier `harness-final/`, `harness-bounded/` and `runner-integration-tests-v2.log` retain their original commands/results against the parent revision plus the then-uncommitted preparation patch. The next live campaign still requires a new clean committed freeze after the pending fix.

## Resume in order

1. Inspect the current branch, dirty state, origin/main, processes and durable task/ledger state. Preserve all receipts and retained candidates; never infer inactivity solely from a missing terminal.
2. Confirm the other agent's retained-package failure event/repair-admission fix has merged. Inspect the actual diff and regression coverage. Rebase this preparation branch onto it; do not duplicate its implementation or mistake `09737b7` for that separate fix.
3. Rerun affected retained-package, repair, planning and evaluation integrity checks, then the required Harness quality checks. If a regression fails, resolve or report it before inference.
4. After a clear instruction to run H05, prepare a **new** direct-date-root single-trial campaign from clean committed source with `prepare-batch.mjs ... feasibility H05`. Freeze source/case/grader/rubric/environment hashes and the configuration above. Repeat exact public checkout baseline, native permissions and task-admission checks. Check Claude/Codex availability without silently substituting models.
5. Dispatch one worker only. Complete its deterministic grading and at most one independent blind review; record delivery, behavior and review separately, including repairs, time and all-call token/cache usage. Stop on apparatus uncertainty, unknown active usage or a completed result. No automatic replacement, next case, policy promotion, PR, merge or deployment.

Suggested continuation: “Continue from `docs/MODEL-EVALUATION-PREPARATION.md`. Confirm the retained-package failure-routing fix is merged, rebase and requalify. Prepare the single H05 trial with the frozen balanced policy and existing generous allowances; do not dispatch until I explicitly ask to run it.”
