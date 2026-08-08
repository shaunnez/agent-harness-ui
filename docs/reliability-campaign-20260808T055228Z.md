# Agent Harness reliability campaign 20260808T055228Z

## Outcome

The bounded Eversor MyStrata Assist dogfood suite completed. E1, E2, E3, and E4 reached Human Approval with clean, exact-revision candidates and fresh Development Review, Focused Test, and Final Review evidence. No Eversor candidate was approved or merged.

The confirmation rule passed on harness code commit `f45c5b4bce46c62f13fefe590b5eaaecd35775e7`:

- Easy confirmation AH-011 started from Triage after the final harness fix and reached Human Approval without a harness-class failure.
- Genuine multi-package confirmation AH-013 started from Triage after the final harness fix and reached Human Approval without a harness-class failure.
- AH-012 also reached Human Approval, but INC-0036 correctly disqualified it from confirmation. Its evidence was retained and AH-013 replaced it.

The campaign found and repaired twelve harness defects, reaching the authorized ceiling of twelve harness-code fix attempts. A thirteenth harness defect, INC-0036, was preserved without a code change and avoided through the required fresh replacement confirmation. Agent Harness is consistent for the tested paths on `f45c5b4`; this is not a claim that INC-0036 or untested paths are fixed.

## Repository and runtime identity

| Item | Value |
| --- | --- |
| Harness source `main` | `1d9a84780dcfc3a856659cb2e41769724de95f05` |
| Harness campaign branch | `codex/harness-reliability-20260808T055228Z` |
| Harness campaign worktree | `/Users/shaun/projects/.worktrees/agent-harness-reliability-20260808T055228Z` |
| Final harness code commit | `f45c5b4bce46c62f13fefe590b5eaaecd35775e7` |
| Eversor source `main` and campaign base | `0e4e4505c2fb8856b08be57a67b90874c4ba3be0` |
| Eversor campaign branch | `codex/harness-target-20260808T055228Z` |
| Eversor campaign-base worktree | `/Users/shaun/projects/.worktrees/eversor-harness-target-20260808T055228Z` |
| Campaign evidence | `/Users/shaun/projects/agent-harness-ui/.data/reliability-campaigns/20260808T055228Z/` |
| Campaign task store | `.../20260808T055228Z/tasks.json` |
| Campaign worktree root | `/Users/shaun/.ah/reliability-campaigns/20260808T055228Z/worktrees` |
| Local UI | `http://127.0.0.1:4173` |
| Local API | `http://127.0.0.1:4310` |

At close-out the API was healthy, Codex was authenticated through ChatGPT, no API key was requested or forwarded, and no task run or agent subprocess was active. Ports 4173 and 4310 were owned by the isolated Agent Harness Node processes. The configured stage policy remained Luna/xhigh for Triage, scouts, Grill Me, Specification, Implement, and Focused Test; Sol/high for Plan, Repair, Development Review, and Final Review.

Both campaign worktrees were clean before report creation. Eversor source `main` retained its pre-existing untracked `output/` directory; the campaign did not create, edit, stage, or remove it. The Eversor campaign-base branch remained exactly at its base with zero additional commits.

## Baseline

The complete `.agent-harness/verification.json` manifest passed on the unchanged Eversor campaign base under Node v24.18.0. The initial frontend test run under Node v26 was retained as environment failure INC-0004; the Node 24 rerun passed.

| Verification row | Result | Duration |
| --- | --- | ---: |
| `make lint` | PASS | 5.95 s |
| `npm run test:frontend` | PASS, 118 files / 950 tests | 13.63 s |
| `npm run frontend:build` | PASS | 4.67 s |
| `npm run test:runtime-ports` | PASS, 5 tests | 0.17 s |
| `make backend-quality` | PASS, Ruff/format/mypy | 1.62 s |
| backend `compileall` | PASS | 0.15 s |
| backend `pytest` | PASS, 2282 passed / 505 skipped | 11.65 s |
| backend tooling `pytest` | PASS, 293 passed | 5.24 s |
| retired-reference check | PASS | 1.30 s |

The authoritative per-command records and bounded logs are in `campaign-state.json` and `logs/baseline-*`.

## Task outcomes and candidate lineage

Every listed candidate was re-read from the live API at close-out. Its worktree HEAD matched the persisted SHA and `git status --porcelain` was empty.

| Logical item | Harness task | Package graph and package commits | Candidate lineage | Outcome |
| --- | --- | --- | --- | --- |
| E1 | AH-005 | none | none | Superseded before execution because caller-supplied whole-task overrides produced the wrong all-Luna policy snapshot. |
| E1 | AH-006 | S1 `fcca71c8` | C1 r1 `7d117bee` assembly -> r2 `52c8f3da` repair | Human Approval; fresh exact-r2 gates; clean patch check; not merged. |
| E2 | AH-007 | S1 `977cd964` | C1 r1 `1f7ce663` assembly | Human Approval; fresh exact-r1 gates; clean patch check; not merged. |
| E3 | AH-008 | S1 `7c963c55` -> S2 `9c6ff61d` + S3 `a09a3e64` -> S4 `344d570a` | C1 r1 `8eb4e22c` assembly -> r2 `6e4bbc34` repair | Human Approval; fresh exact-r2 gates; clean patch check; not merged. |
| E4 | AH-009 | S1 `bc279bc3` -> S2 `8ae62bf1` + S3 `be815eb8` -> S4 `b648c1a2` | C1 r1 `c9564232` assembly -> r2 `239422ae` repair -> r3 `3bdeb966` repair | Human Approval; fresh exact-r3 gates; clean patch check; not merged. |
| E1 recovery | AH-010 | S1 `d358276d` | C1 r1 `095820fc` assembly -> r2 `b1a0424d` repair | Human Approval, but began before the final harness fix and therefore did not count as confirmation. |
| Easy confirmation | AH-011 | S1 `6b09be4e` | C1 r1 `15268478` assembly -> r2 `90d276d0` repair | Human Approval; zero harness-class failures after `f45c5b4`; confirmation passed; not merged. |
| Multi confirmation | AH-012 | S1 `6c1f1e07` -> S2 `d152d9c2` + S3 `68602e7c` -> S4 `5e8074bd` | C1 r1 `6ec00fdd` assembly -> r2 `aa2a000d` repair | Human Approval, but INC-0036 was a harness-class failure; retained and nonqualifying. |
| Replacement multi confirmation | AH-013 | S1 `f083e804` -> S2 `651fc0ea` + S3 `998a176c` -> S4 `9caab7e3` | C1 r1 `dac1f14d` assembly -> r2 `c9189c13` repair | Human Approval; zero harness-class failures after `f45c5b4`; confirmation passed; not merged. |

AH-013's fresh authoritative gates were Development Review run `d60c7758-7065-4dd8-ba5e-18dbc9a59bbf`, Focused Test run `aa6eed6c-028b-410f-9b18-c16655ec50a6`, and Final Review run `0e0c45fb-a1e2-4baf-a15d-ed2e25729a3b`, all bound to C1 r2 `c9189c130bda4136de37bf138661caf6f0d03668`. The prior r1 Development Review repair evidence remained visible but stale. The untruncated 34,814-character exported patch passed `git apply --check` against base `0e4e4505`.

## Harness repairs and before/after evidence

| Attempt | Commit | Incident | Before | After / resume proof |
| ---: | --- | --- | --- | --- |
| 1 | `87dc54d` | INC-0007/0008 | Slices could appear qualified without harness-executed manifest proof; first repair also had duplicate CSS. | Fail-closed nine-row qualification added; focused regression and full checks passed; AH-006 requalified cleanly and resumed. |
| 2 | `3443fc4` | INC-0009 | Fenced authoritative candidate evidence was rejected. | Strict whole-payload fence tolerance added and verified; retry exposed the separate missing finding schema. |
| 3 | `71cb139` | INC-0009 | Gate prompt omitted the exact finding schema. | Schema made explicit; AH-006 retry persisted authoritative exact-candidate REPAIR evidence. |
| 4 | `2bbe549` | INC-0011 | A rejected plan could not be revised from awaiting approval. | Decision-backed bounded plan revision added; same AH-007 retained prior evidence and resumed. UI verified at 1440/1024/768. |
| 5 | `817b294` | INC-0012 | Fenced work-package JSON was dropped. | Generic labelled JSON fence parsing fixed; AH-007 produced a retained structured plan. |
| 6 | `8536682` | INC-0014 | Exhausted awaiting-plan approval could not receive a legal bounded retry. | Provenance-bound grant became the sole legal action; AH-007 allowance increased once. UI verified at 1440/1024/768. |
| 7 | `97884fb` | INC-0015 | Narrative PASS could advance despite failed candidate command telemetry. | Candidate gates fail closed and persisted tasks reproject to the earliest invalid gate; old PASS evidence became stale. |
| 8 | `f12f826` | INC-0017 | Telemetry migration erased otherwise valid repair-authorizer lineage. | Historical command failure remained non-fresh but could retain exact causal repair authority; AH-006 bounded grant resumed. |
| 9 | `41e624b` | INC-0023 | Exact REPAIR evidence with failed command telemetry could not authorize repair. | Exact completed REPAIR authorizer admitted without laundering PASS; AH-009 legally reserved Repair. |
| 10 | `36f7d70` | INC-0026 | A failed Focused Test was projected as ready-for-test instead of repair-required. | Live and restart projection regressions passed; AH-009 reprojected to repair-required with evidence retained. |
| 11 | `ff46d38` | INC-0028 | A later-gate repair could not grant an exhausted earlier gate on the new revision. | Prior gate source and distinct repair authorizer validated independently; AH-009 received exactly one legal grant. |
| 12 | `f45c5b4` | INC-0030 | Numeric `rg -m` memory preflight was misclassified as candidate failure. | Numeric max-count forms classify as context preflight; nonnumeric forms remain candidate scope; 56 focused and 330 full tests passed. |
| ceiling, no fix | unchanged | INC-0036 | Case-insensitive memory-search option was still misclassified in AH-012 Triage. | Evidence retained; no thirteenth code fix created. AH-012 completed but was disqualified; fresh AH-013 replaced it and passed confirmation. |

All repair commits were local to the isolated harness campaign branch. None was merged into harness `main` or pushed. The full ordered commit list is:

1. `87dc54d76a13e9bcfc3b57e526e593b67935a8f8` — Fail closed on unqualified implementation slices
2. `3443fc41daa3b1b49527a91406e2f2c786afca68` — Accept fenced candidate evidence payloads
3. `71cb139c87d8a7a5db1a6bed4f93239de1ae473b` — Specify candidate gate finding schema
4. `2bbe549067b24b3b5aedf49e332f32d15e1659ec` — Allow evidence-backed plan revision
5. `817b2948b3eefe15e1656e4f36518c75feb66b44` — Retain and parse fenced planning output
6. `85366828bf936a06c5ec45ec39dce8a8c9638f06` — Allow bounded exhausted Plan retry
7. `97884fb6fc95c8ea2712daaf2caaf7c7b43df756` — Fail closed on gate command telemetry
8. `f12f82668f2cd8fa4b638c2f2736d737078fc02b` — Preserve repair lineage across telemetry migration
9. `41e624b05cdbee450b7bbb579421dbed2dd20cb5` — Retain repair authority after failed gate command
10. `36f7d70b6462c4e903e0b51697f6301263fd13e1` — Project failed focused tests to repair
11. `ff46d3864fb975c19ac6259d133feece19c6dbf8` — Authorize retries after cross-gate repair
12. `f45c5b4bce46c62f13fefe590b5eaaecd35775e7` — Fix bounded memory preflight classification

## Candidate repairs and retries

| Incident | Task | Fix/resume cycle | Result |
| --- | --- | ---: | --- |
| INC-0010 | AH-006 | 1 | Legal Repair produced C1 r2 `52c8f3da`; all invalidated gates reran fresh. |
| INC-0018 | AH-008 | 1 | Legal Repair made API-to-render coverage discoverable; C1 r2 `6e4bbc34`; gates reran fresh. |
| INC-0022 | AH-009 | 1 | Legal Repair corrected protected-link fallbacks; C1 r2 `239422ae`; Dev Review reran. |
| INC-0025 | AH-009 | 1 | Test-authorized Repair corrected QueueTable expectation; C1 r3 `3bdeb966`; all gates reran fresh. |
| INC-0029 | AH-010 | 1 | Legal Repair added modal-owned portal focus behavior; C1 r2 `b1a0424d`; gates reran fresh. |
| INC-0031 | AH-011 | 1 | Legal Repair added explicit modal-owned portal linkage and behavioral regression; C1 r2 `90d276d0`; gates reran fresh. |
| INC-0044 | AH-012 | 1 | Legal Repair replaced synthetic render tests with real page/query/component integration tests; C1 r2 `aa2a000d`; gates reran fresh. |
| INC-0056 | AH-013 S2 | 1 | Nullable correlation guard corrected before package commit; 6/6 focused tests and all manifest rows passed. |
| INC-0062 | AH-013 S4 | 1 | Integration mocks/assertions/import fixed before package commit; 22/22 and all manifest rows passed. |
| INC-0063 | AH-013 | 1 | Dev Review P1 authorized Repair; typed S3 projection produced C1 r2 `c9189c13`; all exact-r2 gates reran fresh. |

No incident reached three failed fix-and-resume cycles within an incarnation. AH-012 was replaced because the post-final-fix confirmation contract required a run with no harness-class failure, not because its candidate recovery ceiling was exhausted.

## Incident taxonomy and recovery register

Final counts, including the close-out-only operator incident, were:

| Primary class | Count |
| --- | ---: |
| `candidate_defect` | 10 |
| `harness_defect` | 13 |
| `environment_failure` | 21 |
| `task_or_spec_defect` | 23 |

The append-only journal and state file contain exact errors, commands, run/reservation identities, artifact IDs, log paths, classification reasoning, attempts, commits, resume actions, and observed results for every incident. This compact register shows every recovery action; it does not replace those authoritative records.

| Incident | Task | Class | Stage/action | Attempt | Outcome |
| --- | --- | --- | --- | ---: | --- |
| INC-0001 | - | environment | runtime setup | 1 | Retained-session restart restored health. |
| INC-0002 | - | environment | runtime policy mutation | 1 | Settings updated with transient CSRF; no credential persisted. |
| INC-0003 | - | environment | baseline dependencies | 1 | Campaign links removed and ignored dependency views used; base clean. |
| INC-0004 | - | environment | baseline frontend tests | 1 | Node 24 rerun passed 118 files / 950 tests. |
| INC-0005 | - | environment | runtime restart | 1 | Node 24 retained runtime restored. |
| INC-0006 | AH-005 | task/spec | task creation | 1 | Superseded by correctly configured AH-006. |
| INC-0007–0009 | AH-006 | harness | qualification and gate parsing | 1/1/2 | Three focused repairs; same task requalified and resumed with retained evidence. |
| INC-0010 | AH-006 | candidate | Dev Review Repair | 1 | C1 r2 produced; invalidated gates reran. |
| INC-0011–0012 | AH-007 | harness | plan revision and parser | 1 each | Same persisted plan retained and legally reran. |
| INC-0013 | AH-007 | task/spec | path ownership | 1 | Exact five-path one-package plan approved. |
| INC-0014–0015 | AH-007 | harness | bounded plan grant and telemetry | 1 each | Same task resumed; false PASS withheld. |
| INC-0016 | AH-007 | task/spec | review procedure | 1 | Native read-only retry passed with 18 zero-exit commands. |
| INC-0017 | AH-006 | harness | retry lineage | 1 | Exact historical repair authority retained; one grant succeeded. |
| INC-0018 | AH-008 | candidate | Dev Review Repair | 1 | C1 r2 produced and gates reran. |
| INC-0019–0020 | AH-008 | task/spec | Dev/Final Review commands | 1 each | Corrected native-command runs passed with zero failures. |
| INC-0021 | AH-009 | task/spec | S1 generic-skill use | 1 | Fresh S1-A2 avoided forbidden skill and qualified. |
| INC-0022 | AH-009 | candidate | Dev Review Repair | 1 | C1 r2 produced and reran. |
| INC-0023 | AH-009 | harness | repair authority | 1 | Exact repair reservation became legal after commit `41e624b`. |
| INC-0024 | AH-009 | task/spec | review procedure | 1 | Twelve native commands exited zero; PASS became fresh. |
| INC-0025 | AH-009 | candidate | Focused Test Repair | 1 | C1 r3 produced; focused and complete frontend tests passed. |
| INC-0026 | AH-009 | harness | failed-test projection | 1 | Restart projected repair-required and retained exact failure. |
| INC-0027 | AH-009 | environment | Node runtime | 1 | Node 24 companion and frontend suite restored. |
| INC-0028 | AH-009 | harness | cross-gate retry | 1 | One provenance-bound Dev Review grant succeeded on r3. |
| INC-0029 | AH-010 | candidate | modal portal Repair | 1 | C1 r2 produced; gates reran. |
| INC-0030 | AH-010 | harness | memory-preflight parsing | 1 | Commit `f45c5b4`; Final Review reran and AH-010 reached approval. |
| INC-0031 | AH-011 | candidate | confirmation Repair | 1 | C1 r2 produced and all confirmation gates reran. |
| INC-0032–0035 | AH-011 | environment | review command/retry | 1 each | RTK/path/request/exhaustion evidence retained; bounded native retry passed. |
| INC-0036 | AH-012 | harness | memory option parsing | 0 | No fix beyond ceiling; task retained, completed, and disqualified. |
| INC-0037–0040 | AH-012 | environment | scouts and S1–S3 commands | 1 each | Corrected commands plus nine-row qualification allowed legal continuation. |
| INC-0041 | AH-012 | task/spec | S4 procedure | 1 | Corrected in-run procedure; nine owned files qualified. |
| INC-0042 | AH-012 | environment | S4 cache | 1 | All nine rows passed; clean four-package candidate assembled. |
| INC-0043 | AH-012 | task/spec | review decision request | 1 | Correct CSRF request persisted exactly once. |
| INC-0044 | AH-012 | candidate | integration-test Repair | 1 | C1 r2 produced; all gates reran. |
| INC-0045–0046 | AH-012 | task/spec | review/repair commands | 1 each | Malformed stale command retained; exact-r2 procedure corrected. |
| INC-0047 | AH-012 | environment | review path | 1 | Failed path retained and freshness withheld. |
| INC-0048–0049 | AH-012 | task/spec | bounded review and poll | 1 each | One grant passed; same Final Review observed without duplicate mutation. |
| INC-0050–0051 | AH-013 | task/spec | Triage/Plan evidence | 1 each | Corrective decisions retained; genuine four-package graph approved. |
| INC-0052 | AH-013 | environment | S1 Vitest loader | 1 | 17/17 and all qualification rows passed. |
| INC-0053–0054 | AH-013 | task/spec | S1 typecheck / S2 path | 1 each | Scoped commands corrected; no duplicate mutation. |
| INC-0055 | AH-013 | environment | S2 Vite cache | 1 | Runner loader worked; package qualification passed. |
| INC-0056 | AH-013 | candidate | S2 nullable ID | 1 | Guard fixed before package commit; 6/6 passed. |
| INC-0057 | AH-013 | task/spec | S2 generated report | 1 | Generator-aware checks and manifest passed. |
| INC-0058 | AH-013 | environment | S3 verification | 1 | 4/4 and all qualification rows passed. |
| INC-0059–0060 | AH-013 | task/spec | S3 typecheck / S4 edits | 1 each | Generator/path procedure corrected within ownership. |
| INC-0061 | AH-013 | environment | S4 cache | 1 | 22/22, typecheck, and all qualification rows passed. |
| INC-0062–0063 | AH-013 | candidate | S4 tests / assembled S3 contract | 1 each | S4 corrected precommit; legal C1 Repair produced r2 and fresh gates. |
| INC-0064 | AH-013 | task/spec | broad runner suite | 1 | Focused runner plus authoritative manifest used. |
| INC-0065 | AH-013 | environment | Repair Vitest loader | 1 | S3 4/4 and S4 render suites passed. |
| INC-0066 | AH-013 | task/spec | Repair typecheck | 1 | Targeted strict check passed; C1 r2 clean. |
| INC-0067 | - | task/spec | close-out audit variable | 1 | Failed loop changed no state; corrected `candidate_wt` audit proved all retained candidate SHAs and cleanliness. |

## Confirmation evidence

### Easy: AH-011

- Started from Triage after `f45c5b4`.
- Candidate C1 r2 `90d276d0041fc89594af7a140e5dbf27ee2a65fa`.
- Fresh Development Review `d0e58ffc-1519-44b4-9a69-78fdf964006c`.
- Fresh Focused Test `30069cdd-7f54-4e68-9435-beb7dcc57165`.
- Fresh Final Review `668e707d-4ea8-4781-be14-d47e37f1b710`.
- Zero harness-class failures, clean candidate/base, untruncated patch check passed, UI showed C1 r2 and 3/3 fresh gates.

### Multi-package: AH-013

- Started from Triage after `f45c5b4` as the fresh replacement for nonqualifying AH-012.
- Required and actual graph: `S1 -> S2 + S3 in parallel -> S4`, with disjoint owned paths and local nine-row package qualification.
- Candidate C1 r2 `c9189c130bda4136de37bf138661caf6f0d03668`.
- Fresh Development Review `d60c7758-7065-4dd8-ba5e-18dbc9a59bbf` with 13 zero-failure command calls.
- Fresh Focused Test `aa6eed6c-028b-410f-9b18-c16655ec50a6`; all nine manifest rows passed.
- Fresh Final Review `0e0c45fb-a1e2-4baf-a15d-ed2e25729a3b` with 14 zero-failure command calls.
- Zero harness-class failures, clean candidate/base, untruncated patch check passed, UI showed C1 r2 and 3/3 fresh gates.

## Harness verification actually run

The full isolated harness verification passed on final harness code commit `f45c5b4` before this report-only commit:

| Command | Result | Log |
| --- | --- | --- |
| `npm run lint` | PASS | `logs/final-harness-lint.log` |
| `npm run typecheck` | PASS | `logs/final-harness-typecheck.log` |
| `npm test` | PASS, 330/330 | `logs/final-harness-test.log` |
| `npm run build` | PASS; required Sites artifacts produced | `logs/final-harness-build.log` |
| `npm run test:sites` | PASS, 4/4 | `logs/final-harness-test-sites.log` |
| `git diff --check` | PASS | `logs/final-harness-diff-check.log` |

The same full suite is rerun after committing this report so the final branch-head claim is bound to the tracked documentation commit as well. Its final-head logs are recorded in campaign state and `logs/final-head-*`.

## Limitations and risks

- INC-0036 remains an observed harness defect. The authorized twelve-fix ceiling prevented a thirteenth code change. Confirmation succeeded by starting a fresh, correctly constrained replacement task; the parser case itself remains a follow-up.
- Numerous agents generated avoidable command failures involving RTK, non-existent paths, shared Vite caches, generated-report ordering, and working-directory assumptions. The harness correctly withheld freshness after the fail-closed telemetry fixes, but these failures increased runtime substantially.
- The campaign validates the exercised Eversor task shapes and recovery paths, not every possible repository, provider, or concurrency path.
- All dollar figures in the product remain estimates; ChatGPT plan execution does not expose an attributable provider charge.
- Candidate branches and worktrees are intentionally retained. They are not release branches and none has been merged.

## Exact local process state and next action

At the pre-report close-out audit:

- UI listener: Node PID 8847 on `127.0.0.1:4173`.
- API listener: Node PID 8846 on `127.0.0.1:4310`.
- `/api/health`: healthy, runtime schema version 5.
- `/api/runtime/status`: available and authenticated through ChatGPT.
- Active task runs/reservations: none.

Recommended next action: preserve this campaign unchanged, complete the independent RTK-removal work, then start a new campaign and a fresh Codex session. First run one easy and one multi-package task with the existing mixed Luna/Sol policy to isolate the RTK change; only then run a matched all-Sol cohort if a controlled model comparison is desired.

Do not approve or merge any retained Eversor candidate as part of this report.
