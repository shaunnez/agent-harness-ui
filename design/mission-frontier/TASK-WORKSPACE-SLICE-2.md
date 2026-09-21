# Task workspace Slice 2: earlier stages and input

21 September 2026. Prepared at Shaun's request after Slice 1 correction and PR authorization. This document prepares the next run; it does not start implementation or authorize merging Slice 1.

Slice 1 is published as [draft PR #111](https://github.com/shaunnez/agent-harness-ui/pull/111), initially at implementation commit `12683e76c6bd8a218301f0f4c3999af755b90629`. GitHub reported it mergeable with no status checks listed at publication; no remote CI pass or merge is claimed. Refresh the PR state at kickoff.

## Resume after compaction

1. Read `AGENTS.md`, this file, `TASK-WORKSPACE-MIGRATION.md`, `TASK-WORKSPACE-EVALUATION.md`, and `build-evidence/TASK-WORKSPACE/slice-1/refinement/REVIEW.md`.
2. Inspect the current Git and PR state. Slice 1 lives on `codex/task-workspace-slice-1` in `/Users/shaun/.codex/worktrees/task-workspace-slice-1/agent-harness-ui`. Discover its PR by that exact head branch if the conversation link is unavailable. The source baseline was `48ca6b52e2fdb0872184fb16d9d6c827ee5603b4`; remote main had advanced to `b585649795887356c25559ffd4a9c7f37316ba31` when this plan was written.
3. When explicitly started, create a separate Slice 2 worktree/branch from merged main if Slice 1 has landed. If it remains open, branch from the verified Slice 1 PR head and keep the follow-on diff separate/stacked. Do not start from main without the corrected shell, overwrite dirty work, silently merge the PR, or rebase the review branch merely to begin the next slice.
4. The running Slice 1 fixture preview is `http://127.0.0.1:5291/?mode=fixture&scenario=workflow#task/PC-142/implement`; its Vite PID was 51285. The frozen study is served on 5279. Verify ownership before reusing either. Start the next preview on an available separate loopback port, preserving these services.
5. Reverify browser access and the frozen reference hash. The reference is `reference/task-workspace-study-2026-09-21.html`, SHA-256 `905e12d79d63cb1f63dd1ba15cff3125b1ab97e3742555c23b9d64450eccf812`. Do not edit it. If its preview must be restarted, follow the installed visualize skill's renderer instructions; the raw fragment is not a standalone app.

Use one implementation agent with browser access. Do not launch a separate CLI agent assuming it inherits that access. Compaction does not change model selection or authorize implementation.

## Outcome and boundary

Bring Triage, Scouts, Grill, Specification, Plan and optional Design review into the corrected Slice 1 presentation. Preserve the header, top stage rail, stable command bar, inspector, icons, typography, surfaces and recorded/future/stale distinctions. Extend the existing React composition and contracts, keeping this a presentation migration wherever possible.

Slice 1 already supplies the shared shell, connected package batches, selected detail, candidate/diff presentation and Implement activity disclosure. Reuse those. Do not redesign Implement or restart shell exploration. Dev review, Test, Final review, Approval and delivery body migration remain Slice 3; cross-stage qualification is Slice 4.

No backend schema changes, alternate workflow state model, new navigation setting, real task execution, real approval/PR publication, asset generation or deployment is included. Optional design controls operate only through existing gateway capabilities and recorded policies.

## Code-grounded work sequence

| Step | Presentation work | Existing authority and behavior to retain |
| --- | --- | --- |
| 1. Inventory and baseline | Capture the six target screens and their study equivalents; map every existing control/field to its destination before editing. | `TaskPanel.tsx`, `OverlayHost.tsx`, `StageEvidence.tsx`, runtime `workflow.ts`, `presentation.ts`, `contracts.ts`; paged `TaskEvidence` is not an all-evidence snapshot. |
| 2. Triage and Scouts | Bordered outcome/brief panels and robot scout cards with goal, focus, current recorded activity and selected/skipped coverage. Keep the synthesis/artifact readable. | Existing stage artifact, scout dispatch selection and individual run statuses. Do not infer running from selected, or completion from a finished worker awaiting input. Preserve Watch, artifacts and pagination. |
| 3. Grill | Place the existing one-question form, repository evidence, recommendation choices and recorded decisions in the shared visual structure. Keep actions visible during long evidence. | `Grill.tsx` is currently a separate overlay; `OverlayHost.tsx` owns answer drafts. Reuse its callbacks, draft keys, answer source and return stack. Preserve custom answers, manual recommendation confirmation and Create specification eligibility. Do not change question sequencing or add answer-editing semantics to imitate a mock. |
| 4. Specification | Style the real retained document with icon-backed section treatment where headings exist; retain rendered/raw access and full context manifest. | `StageEvidence.tsx` / `ArtifactViewer.tsx` and existing Markdown renderer. No hard-coded acceptance criteria or parser that loses content when headings vary. Preserve request-changes/approval interaction and identity revalidation. |
| 5. Plan | Use the existing `WorkPackages` / `PackageDiagram`, planned states and retained plan alongside actual package detail. Keep dependencies visible and the next eligible action stable. | Actual batch/dependency records, ownership, commands and artifact fields. Interfaces, risks and expected outputs appear only when recorded. A planned package must not look like execution. Preserve one/uneven/many-package support and package selection memory. |
| 6. Optional Design review | Apply the same panel/header/selection treatment to provider comparisons and recorded context. | `DesignReview.tsx`: sandboxed preview, unavailable/failed/pending states, external retained project access, retry and selection checks. Preserve policy snapshots and recorded revisions; no new design runs for visual QA. |
| 7. Regression comparison | Reopen Implement and its assembled candidate at both viewports after shared CSS/composition changes. | Slice 1's current captures in `slice-1/refinement/` are the regression checkpoint. Earlier claimed-final screenshots are rejected history. |

Extract focused presentational components only when needed to share the existing shell with Grill; keep host loading, commands, drafts and return behavior in their current ownership. Scope styles to task workspace content. Avoid global changes to Watch, world, setup or settings.

## Browser acceptance loop

Use the actual application with `?mode=fixture&scenario=workflow`, the real React components and the in-memory gateway. No real mutation endpoints. Useful existing fixture seeds (verify their current content before using them):

- PC-142 recorded Triage/Scouts and active Implement for shared-shell regression.
- AH-052 active Scouts and selected/skipped dispatch evidence.
- PC-153 and MS-086 Grill questions, recommendations and artifact return paths.
- MS-090 Specification; MS-092 Plan with twelve packages.
- AH-053 optional Design review.
- AH-054 failed package qualification; PC-148 assembled candidate and stale review; MS-091 single package.

For each screen at **1280 × 900** and **1440 × 1000**, normal zoom:

1. Select its frozen study screen and the closest supported fixture snapshot. Record viewed/active stage, selection, task-content width and scroll position.
2. Capture reference and actual application screenshots. Look at both, including lower content; DOM assertions and no-overflow measurements are supporting checks only.
3. Compare navigation, command alignment, panel anatomy/borders, spacing/density, type size, art crop, icons, selected states and inspector. Log differences with a concrete correction or data-contract reason.
4. Correct material drift and repeat affected captures. Do not alter fixture values merely to mimic study examples, and do not label a known mismatch accepted without Shaun's decision.
5. Exercise package/scout selection; artifact/raw/context viewer and return; Grill custom draft preservation and explicit submit; recommendation confirmation/cancel; existing spec/plan/design actions in fixtures; activity filters/paging; future-stage inertness; historical versus active command; keyboard/focus; resize, maximise/restore and local scrolling.

Required exceptional cases: empty/missing/variable-shape documents, loading/error, no scout run, failed scout, long question/output, one/many packages, stale evidence and disconnected/busy command eligibility. Use existing fixtures/tests first; add bounded deterministic fixture coverage only where the current set cannot represent an important case. Do not replace runtime rules with preview controls.

## Checks and completion

- Run the focused baseline: `node --test tests/frontier/workflow.test.mjs tests/frontier/workflow-command.test.mjs tests/frontier/command-workflow.test.mjs tests/frontier/pages.test.mjs tests/frontier/window-layout.test.mjs`.
- Add behavior tests only for changed contracts, especially Grill draft survival, duplicate-submit protection, preserved action/candidate scope and artifact return. Use existing fixture gateway and test conventions.
- Run `npm run test:frontier`, `npm run typecheck`, `npm run lint`, changed-file formatting/checks, `npm run build:frontier` and `npm run build`. Reassess full formatting on the selected base; Slice 1 had three unrelated pre-existing format failures. Do not assume those failures persist or fix unrelated files silently.
- Existing Slice 1 result: 146 Frontier tests passed; typecheck, lint and both builds passed; full format failures were limited to `server/research/deepagents/worker.mjs`, `src/research-budget-policy.ts`, `tests/research-deepagents-live.test.mjs`. The three files have since changed on remote main, so verify anew after integration. Existing large-bundle and Three.Clock warnings were not UI acceptance failures.
- Write `build-evidence/TASK-WORKSPACE/slice-2/REVIEW.md` with source/PR identity, matching reference/application captures, discrepancy table, interaction results, exact checks, remaining deviations and owned preview process/port.
- Stop with the Slice 2 preview open for visual review. Do not roll straight into Slice 3, merge a PR or claim Shaun's visual approval.

## Suggested kickoff after compaction

> Start task-workspace Slice 2 using `design/mission-frontier/TASK-WORKSPACE-SLICE-2.md`. Build on the corrected Slice 1 PR in a separate isolated worktree. Migrate Triage, Scouts, Grill, Specification, Plan and optional Design review while preserving the corrected shared shell and existing workflow logic, capabilities and drafts. Compare the actual application against the frozen study at 1280 × 900 and 1440 × 1000, fix visual drift, rerun the relevant checks and verify Implement has not regressed. Leave the preview open and stop for visual review before Slice 3.
