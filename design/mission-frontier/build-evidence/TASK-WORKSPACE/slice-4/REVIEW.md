# Slice 4 — integrated task-workspace qualification

21 September 2026. Integrated qualification is complete and ready for Shaun's review. This records browser and local-check evidence; it does not record Shaun's visual acceptance, remote CI success, live execution or deployment.

## Identity and scope

- Existing isolated worktree: `/Users/shaun/.codex/worktrees/task-workspace-slice-3/agent-harness-ui`, branch `codex/task-workspace-slice-3`, draft [PR #114](https://github.com/shaunnez/agent-harness-ui/pull/114).
- Starting HEAD `3e6157b168d470eebbced4fdd3b55ecd70117450`. Before editing and again before publication, stack remained open: #111 `c6e0e31decbaefdbd75fe2d4d6442a0a4e157faa` → #113 `3d4e1156ccf7334a899e22d47e31de0a79935843` → #114. Each PR has the preceding branch as its base; local ancestry was checked. No rebase or retarget was necessary.
- Frozen study: `reference/task-workspace-study-2026-09-21.html`, SHA-256 `905e12d79d63cb1f63dd1ba15cff3125b1ab97e3742555c23b9d64450eccf812`, unchanged.
- Preserved accepted top navigation, connected icons, right header controls, viewed-stage heading, compact Implement worker, open inspector, separate stage usage/task total and existing confirmation controls. No CSS redesign, backend/API schema, workflow selector, dispatcher or persistence change.
- Original checkout and existing services were preserved. The untracked dependency symlink is excluded from commits.

## Targeted corrections found during qualification

1. **Latest retained report:** live companion artifact pages arrive newest first, while fixtures can have insertion order. Selecting the final array element opened an older Dev Review report. Header access, stage evidence and the recorded journey now select by recorded timestamp and deterministic ID, without mutating the artifact list. Historical evidence remains available. Tests cover both orders and absent reports.
2. **Candidate gate markers:** a refreshed candidate with unavailable verdicts could retain a green stage tick from `completedStages`. Candidate-bound stages now require the existing `Fresh` projection for that tick. Candidate-drift confirmation was already disabled correctly; the fix removes the misleading completion marker without changing eligibility.
3. **Optional design inspector:** the inspector now identifies Design providers instead of presenting the parent Specification worker as the design worker. Each direction retains its own provider/model/status. Usage and attempt counts explicitly cover parent Specification; unrelated Watch access is suppressed only in this optional view.
4. **Early artifact failure:** early stages made a redundant artifact request for late-stage gate detail, producing duplicate errors. Their existing document viewer now owns loading, error and retry. Late structured gate reads are unchanged.

Bounded sample additions provide 55 paged runs, a completed investigation with not-required stages, long title/output and a delayed evidence failure. The single-package approval sample's historical Implement run now references its actual S1 package. These are explicitly fictional, tab-local scenarios.

## Visual comparison

Actual in-app browser captures at **1280×900** and **1440×1000**, normal zoom, cover all ten stages, PR delivery and optional Design review: **24 application/reference pairs**. `comparison-laptop-{1..4}.jpg` and `comparison-desktop-{1..4}.jpg` place study left/application right. Full-size captures use `application-<screen>-<size>.jpg` and `reference-<screen>-<size>.jpg`.

All eight comparison sheets were visually inspected. Shared panel boundaries, dark surfaces, stage navigation, portrait/icon treatment, package list/detail anatomy and inspector hierarchy follow the study with the accepted changes. This is not a claim of pixel identity.

| Comparison | Evidence and disposition |
| --- | --- |
| Overall shell | Existing window controls and sample banner replace the study's screen/navigation selectors. Header controls stay right; all ten stages fit at both sizes. |
| Laptop density | Normal main/inspector content heights are 486px, or 443px with taller commands. Main content width is 928px and inspector content 268px. Desktop equivalents are 586/543px and 1088/268px. Local scrolling is deliberate; long evidence does not push the command bar away. |
| Overflow | `browser-metrics.json` contains 22 ordinary-stage/delivery captures. Document width equals viewport width; main and inspector have no horizontal overflow. `reference-metrics.json` also verifies the study wrapper starts at scroll zero, avoiding cropped reference comparisons. |
| Implement | Large workshop hero remains removed per accepted feedback. Compact worker identity and real package states take priority. One integrated package and twelve planned packages preserve the same anatomy. |
| Usage | App uses Stage usage followed by Task total, unlike the study's task-total-only sidebar. Retries sum within the viewed stage; task elapsed remains separate. Missing telemetry is Unavailable; dollar values remain API-rate estimates. |
| Historical view | The recorded-evidence banner adds height but makes viewed versus active stage explicit. A retained stage never becomes the target of a workflow mutation. |
| Approval | Exact identity and fresh gates are shown before the existing Proceed / Proceed with reason confirmation. The study's consolidated form remains a separate proposal. |
| Data-dependent content | Empty scope/scout metadata, absent structured suggested code, unloaded attempts and unavailable rates remain explicit. No study values, skipped test rows or inferred execution are fabricated. |
| Design review | Side-by-side provider directions and retained failure coexist; the corrected inspector identifies the optional provider flow and parent-stage usage. |

## Integrated state and interaction record

All mutation exercises below use fixture mode only. They do not call the live runtime or GitHub.

| Requirement | Browser evidence and result |
| --- | --- |
| Running and dependency waits | PC-142 shows a running package, dependent wait and no assembled candidate. AH-052 preserves completed versus queued scout state. Normal comparison captures retain these differences. |
| Human input and return draft | QA-203 custom Grill draft survives opening repository evidence, raw source and returning. Recording the sample answer advances to question 2 and retains the decision. `grill-draft-return-1440x1000.jpg`. |
| Failed scout/package | QA-201 retains the failed scout and queued sibling. AH-054 exposes failed qualification without mislabelling another running package. `failed-scout-1280x900.jpg`, `failed-package-1280x900.jpg`. |
| One/many packages | QA-205 has one integrated S1 and an assembled exact candidate. MS-092 has 12 planned packages in three batches; selected S12 has ten dependencies and survives artifact return. Planned packages are not executing. `single-package-integrated-1440x1000.jpg`, `many-package-detail-1440x1000.jpg`. |
| Finished worker / waiting task | Inspect package run opens completed S1; Watch says historical, parked and task needs approval. `historical-package-run-1440x1000.jpg`. |
| Repair and stale history | PC-148 sample repair creates r2. Prior r1 REPAIR evidence remains audit history, not current clearance; historical r1 exact diff retains its full identity and raw-source return. `repair-stale-1440x1000.jpg`. |
| Retry same candidate | AH-051 sample retry produces a second completed attempt on unchanged r1. Prior attempt remains separately selectable: one passed/one failed, exit 127/ENOENT. Back to results works. Stage usage includes both attempts (12m, 124K input, 20K output, 62K cached, 50%). `prior-test-attempt-1440x1000.jpg`. |
| Approval note and exact diff | QA-205 Proceed with reason retains its note across exact-diff/raw-source return; explicit fixture confirmation produces Awaiting PR merge, not completed. `approval-confirmation-1440x1000.jpg`. |
| Candidate refresh during confirmation | Scheduled fixture drift moves to r2 while confirmation is open. Confirmation remains visible but disabled with “Task or candidate changed. Return to review the new state before continuing.” `candidate-drift-1440x1000.jpg` records the original misleading green ticks; `candidate-drift-corrected-1440x1000.jpg` records unavailable numbered gates after correction. |
| Disconnected | Fixture connection loss keeps retained identity/usage visible and disables Run development review; fresh artifact reads fail explicitly. Reconnect restores runtime access. `disconnected-1440x1000.jpg`. |
| Loading/error | QA-207 shows loading then one retained-evidence error and a read-only Retry. Core/eligibility remain intact. `evidence-loading-1280x900.jpg`, `evidence-error-1280x900.jpg`. |
| Partial and completed history | QA-206 starts with 50/55 runs and partial stage usage. Load earlier runs yields 55 unique records and complete stage usage while task totals remain unchanged. Long title wraps and long output scrolls locally. `partial-long-title-1280x900.jpg`, `complete-run-history-1280x900.jpg`. |
| Not required and future inert | QA-206 Scouts selected with keyboard Enter shows the recorded not-required reason and no worker; future Implement remains disabled. A completed investigation does not imply an implementation candidate. `not-required-1280x900.jpg`. |
| Delivery failure/completion | MS-091 sample closed-unmerged and identity-drifted PRs remain blocked/incomplete. Only matching sample merge becomes completed. `delivery-{closed,drift,completed}-1440x1000.jpg`. |
| Window and keyboard | Maximise measured 1424×984; restore 1408×952; narrower/shorter 1328×892 at desktop viewport. Reset/Done work. Keyboard stage selection, disabled future stages and artifact/back paths were inspected. Temporary viewport overrides are reset for the final preview. |
| Policies and utilities | Role policies remains in the header and shows started-role restrictions. Manage, Pin, Watch, current-stage return, collapsed activity and wide artifact/diff access remain wired through existing callbacks. No live policy or task mutation was attempted. |

## Read-only live inspection

Verified the existing companion process (PID 8504 at inspection) on loopback 4310: `agent-harness-local`, schema 12, owned by `/Users/shaun/projects/agent-harness-ui/.claude/worktrees/frontier-3d-minimap-zoom-8efd8c`. It was already running and was not restarted.

For browser inspection only, a temporary proxy on 4321 permitted **GET only**, forwarding to 4310 and returning 405 for other methods. Its request log contains 252 GET requests, including refresh polling, and no mutation methods. It was stopped after inspection; the live browser tab was closed. Raw records, request logs and live screenshots remain local under `/tmp`, excluded from PR evidence. Only this sanitized shape/identity summary is committed.

| Existing record | Read-only observation |
| --- | --- |
| AH-025 | Approval, C1 r1, head `7deb11b16a3c163a8a5c21093e9b70ca3124527b`; one package, ten runs, twelve artifacts and three fresh gates. Actual recorded task usage/rate identity rendered, while approval-stage measurements stayed Unavailable. No approval confirmation was opened or submitted. |
| AH-019 | Review retry, C1 r2, head `d8f208c8a1cce6ac330205853bcc61ac842ccba4`; retained r1 and r2 reports exposed newest-first ordering. After correction, Open retained artifact selected `dev-review-c1-r2.md`. The authoritative execution-failure/REPAIR evidence was not overridden by model Markdown saying PASS; older r1 remains audit history. |
| AH-030 | Existing runtime changed from running to failed while being observed. Browser showed S1 timeout at 1800 seconds, three dependent waits and no assembled candidate. This was external runtime activity, not a test run or action started by this task. |

These reads demonstrate representative real data shapes and refresh rendering. They do not prove live retry/repair/approval, real PR publication/merge, or a new model run.

## Capability register reconciliation

The retained register in `TASK-WORKSPACE-EVALUATION.md` was checked against final composition and wiring. Ten-stage access uses the same recorded-state selectors; policies/Manage/Pin retain existing host callbacks; package/worker inspection remains reachable; wide artifacts, raw source, exact diffs and return paths remain available. Open safeguards/context/repository panels and activity loaders are retained. Usage, stale gates, candidate history and task-versus-run distinctions are covered above. World/HQ/appearance/Companion and backend behavior are outside this change.

## Checks and limits

| Check | Result |
| --- | --- |
| Focused workflow baseline | 37 passed (`focused-baseline.log`). |
| Final `npm run test:frontier` | **162 passed**, zero failed/skipped (`frontier-final.log`). Four added regressions cover candidate markers, artifact ordering, paged usage and evidence-read isolation. |
| `npm run typecheck`, `npm run lint` | Passed (`typecheck-final.log`, `lint-final.log`). |
| Changed-source formatting | Passed, all 11 changed/new source/test files (`changed-format-final.log`). |
| `npm run build:frontier`, `npm run build` | Passed (`build-frontier-final.log`, `build-final.log`); existing large-chunk warnings remain. |
| `npm run test:sites` | **4 passed** (`sites-final.log`); required `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json` present. This is packaging verification, not publication. |
| `git diff --check` | Passed. |
| Full `npm run format:check` | Fails in three unchanged baseline files: `server/research/deepagents/worker.mjs`, `src/research-budget-policy.ts`, `tests/research-deepagents-live.test.mjs`. Full diagnostic retained in `format-final.log`; unrelated formatting was preserved. |
| Remote checks | No checks were reported for the three PRs at inspection; no CI pass is claimed. |

`check-results.json` indexes the final checks. Earlier logs retain the iteration history; `*-final.log` is authoritative for final code. Browser occasionally displayed the existing WebGL-unavailable world fallback and Three.js clock deprecation; this qualifies the DOM task workspace, not 3D rendering. Route hashes can retain the initial stage while panel memory restores a later selection; assertions used visibly selected stage, and this pre-existing routing behavior was not changed.

No merge, deployment, live task execution, real candidate approval/publication or paid model run occurred. The fixture approval preview remains open on 5293 for Shaun's review. Confirmation consolidation, routing changes, baseline formatting and 3D environment qualification are separate work, not hidden completion claims.
