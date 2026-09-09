# Complete v1 screen and state coverage

6 September 2026. These are working routes inside the independent Frontier entry, not 25 separate applications. Browser evidence is paired with the final automated suite in `full-tests.log`; the accepted M0–M3 evidence is retained.

| # | Destination | Exercised states / evidence |
| --- | --- | --- |
| 01 | World command centre | Selection, camera, minimap, normal/stress grouping, empty/offline; `normal-world.jpg`, `stress-world.jpg`, `offline-world.jpg`, M3/acceptance.md |
| 02 | Projects | Search, repository readiness, rename, archive denied, archive/restore; [M4 acceptance](../M4/acceptance.md) |
| 03 | Add a project | Registration, invalid/unready repository, reviewable setup proposal, explicit setup approval; [setup capture](../M4/project-setup-review.jpg), API admission tests |
| 04 | Project headquarters | Running, dependency wait, needs answer, repair, growing occupancy, all eleven station types; `hq-final.jpg`, `all-stations-hq.jpg`, M3 attention comparisons |
| 05 | Task journal | State/project/stage/search/sort filters, empty match, selected inspector, retained dates, close/archive; [journal](../M4/tasks-desktop-v3.jpg), `stress-last-task.jpg`, `journal-mobile.jpg` |
| 06 | New task | Both workflows, attachments, profiles, design options, repository selection; draft across navigation/offline; [brief](../M4/new-task-brief-v3.jpg), `offline-draft.jpg`, `new-task-mobile.jpg` |
| 07 | Task execution and review | Inherited/override role matrix, separate providers, review/create/start, eligible future roles; [policies](../M4/task-policies-desktop-v2.jpg), [future role confirmation](../M4/future-role-confirmation.jpg), M4 real API snapshots |
| 08 | Task command | Current actions, recorded/current/unstarted stages, 1/4/12 packages, candidate and exact diff; [M5 acceptance](../M5/acceptance.md), `task-1280-final.jpg` |
| 09 | Research | Selected/skipped scouts, running dispatch, retained synthesis, absent dispatch metadata; [research](../M5/research-final.jpg), actual AH-001 evidence, workflow fixture AH-052 |
| 10 | Grill | Pending question, repository evidence, recommendation/custom answer, accumulated decisions, explicit finish, zero-question handling; [real CLI journey](../M3/actual-cli-journey.md), [answer persistence](../M3/actual-answer-persisted.png), full fixture workflow test |
| 11 | Design selection | Successful/failed providers together, retained retry policy/siblings, sandboxed preview, exact selection; [failure](../M5/design-provider-failure.jpg), [retry](../M5/design-retry.jpg) |
| 12 | Specification | Rendered/raw source, supplied context, recorded model, approval and downstream handoff; [specification](../M5/specification-final.jpg), `live-retained-task.jpg` |
| 13 | Implementation plan | Scope and dependency batches, 4/12 packages, package detail, revise/request-change/approve, separate start; [four](../M5/plan-four.jpg), [twelve](../M5/plan-twelve.jpg), [detail](../M5/package-twelve-detail.jpg) |
| 14 | Development review | P1 typed finding, reproduction/file/line, fresh verdict, repair and old evidence; [review](../M5/review-final.jpg), [repair](../M5/repaired-lineage.jpg) |
| 15 | Tests and repair | Mixed rows, pass/fail detail, back to list, retained attempts, same-head retry and fresh test gate; [details](../M5/test-detail-final.jpg), [final retry](../M5/test-retry-same-head-final.jpg) |
| 16 | Final review / approval | Journey, missing historical values, all fresh candidate gates, exact reviewed publication scope; [approval](../M5/approval-ready-final.jpg), `approval-comparison-final.jpg` |
| 17 | Delivery / completion | Open PR remains incomplete, exact merge completes, closed/drift blocks, retained candidate; [open](../M5/delivery-final.jpg), [merged](../M5/delivery-merged-final.jpg), [drift](../M5/delivery-drift-final.jpg), PR poller/identity tests |
| 18 | Agent roster | Active instances, catalogue, history, per-run task/model/policy, paged history and errors; [agents](../M6/agents-final.jpg), run aggregation tests |
| 19 | Watch an agent | Running, completed, stopped/repair and human-answer states; task attention separate from run status, output/context/tool activity; [M3 attention comparison](../M3/agent-repair-comparison.png), `station-contact.jpg`, [real agent](../M3/actual-agent-final.png) |
| 20 | Skills / role policies | Read-only instructions, canonical roles, shared scout policy, supported model/effort, saved defaults versus history; [skills](../M6/skills-final.jpg), [history preserved](../M6/history-after-default-save.jpg) |
| 21 | Execution settings | Allowlist, three profiles, role defaults, Grill manual/automatic, independent design policies, stale/invalid save handling; [settings](../M6/settings-final.jpg), [design policies](../M6/design-settings.jpg), settings API tests |
| 22 | World / connection settings | Display preferences, reload persistence, motion off, audio opt-in, keyboard guide, scoped worktree inventory; [preferences](../M6/preferences-reloaded.jpg), `motion-off.json`, `settings-mobile-final.jpg`, `live-worktrees.jpg` |
| 23 | Usage / history | Project/task/model/date scope, empty/partial/unknown values, current real totals, task versus run time; [filtered](../M6/usage-filtered.jpg), [empty](../M6/usage-empty.jpg), `live-usage.jpg`, aggregation tests |
| 24 | Artifact / diff viewer | Markdown/raw, missing/retryable body, context manifest, wide candidate diff, original line numbers and revision history; [diff](../M5/candidate-diff-final.jpg), `live-retained-task.jpg`, artifact paging/race tests |
| 25 | First launch / reconnect | Loading, no project, sample versus live, offline last-known state, retained draft, rehydrate without replay; [M3 acceptance](../M3/acceptance.md), `offline-world.jpg`, `offline-draft.jpg`, `reconnect.json`, `live-connection.jpg` |

Loading/errors are owned by the runtime coordinator and overlay boundary; absent data is never replaced with invented records. Artifact/run failures are isolated and retryable, late reads cannot enter another selected task, and historical pages retain their own scope. The browser checks and API tests complement each other; a provider fixture is not evidence of a paid model or real GitHub publication.

The two IAB-specific verification limits—native background visibility and receipt of the JSON download by the OS—are recorded in [M6 acceptance](../M6/acceptance.md). Neither is represented as a successful native integration test.
