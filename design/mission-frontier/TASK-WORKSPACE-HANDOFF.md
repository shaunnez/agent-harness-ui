# Task workspace handoff — after bounded polish

21 September 2026. Slice 4 and the explicitly resumed bounded polish are complete and locally qualified. See `build-evidence/TASK-WORKSPACE/polish/REVIEW.md` for current changes, four study/baseline/application comparison sheets and interaction evidence. Visual acceptance is not yet recorded. No merge, deployment or live task execution is authorized.

## Resume identity

- Repo: `https://github.com/shaunnez/agent-harness-ui.git` (remote `origin`, verify before writes).
- Use existing isolated worktree: `/Users/shaun/.codex/worktrees/task-workspace-slice-3/agent-harness-ui`.
- Branch: `codex/task-workspace-slice-3`.
- Draft PR: **[#114](https://github.com/shaunnez/agent-harness-ui/pull/114)**, base `codex/task-workspace-slice-2`.
- Qualified implementation commit: `b14b81319f220ff87ac5bec66c3f475287d60aa0`. Handoff commit `6cf6f40d8c3db1f591c099d9043c1f7a02a56130` and the later pre-compaction handoff update contain documentation only. The Slice 4 commits are unsigned because the configured 1Password signer returned an error (global signing settings were not changed); verify current local/remote HEAD before changing anything.
- Dependency stack: main ← Slice 1 [#111](https://github.com/shaunnez/agent-harness-ui/pull/111), branch `codex/task-workspace-slice-1` ← Slice 2 [#113](https://github.com/shaunnez/agent-harness-ui/pull/113), branch `codex/task-workspace-slice-2` ← Slice 3 #114.
- Slice 2 published commit: `3d4e1156ccf7334a899e22d47e31de0a79935843`. PR111/113 were open at inspection; recheck before retargeting or rebasing. Do not merge the stack without instruction.
- Original checkout `/Users/shaun/projects/agent-harness-ui` has unrelated dirty work and remains untouched. `node_modules` in this worktree is an untracked symlink to Slice 1 dependencies: preserve, never stage it.

## Current polish result

The command row keeps retained artifact access beside a consistently right-aligned primary action. Review blockers are consolidated into the verdict panel; full gate reasons remain with retained artifacts. Test initially selects a failed check and preserves explicit selections or Back to results separately per attempt. All workflow dispatch and candidate approval safeguards remain unchanged.

Final polish checks: **164 Frontier**, **4 Sites**, typecheck, lint, changed-file formatting and both builds passed. Full formatting retains the same three baseline failures. Browser comparison covered Review/Test at 1280×900 and 1440×1000, plus Final review alignment, explicit selection/Back/attempt return, approval note/diff return and candidate drift disabling confirmation. No new live inspection was needed; the previous GET-only evidence below remains historical. The unchanged frozen reference and immutable Slice 4 evidence are preserved.

Current stop: Shaun's visual review, then final code review, then separately authorized stack integration. No automatic follow-on implementation. Identify the polish commit by `Polish task review commands and test selection` in branch history and verify current remote HEAD before future edits.

## What is done

Slice 4 compared all ten stages, delivery and optional design review with the frozen study at both sizes (24 pairs), exercised exceptional states and inspected three existing live records read-only. It corrected newest-artifact selection, candidate-gate completion markers, optional design inspector identity and redundant early artifact reads. Bounded fixtures cover paged usage and delayed evidence failure. Workflow logic, commands and APIs are unchanged. See the Slice 4 review for the full capability/state matrix and read-only receipts.

Slice 1: shared top-navigation task shell and Implement. Slice 2: early stages and optional design review, plus user-directed header/nav/image cleanup and truthful fixture history. Slice 3: findings/detail, independently inspectable test attempts, candidate history, final-review journey, approval and delivery panels. Existing workflow commands, confirmation/reason fields, eligibility and exact-head checks are preserved.

Usage now consistently shows **Stage usage — viewed stage** (execution time, input/output, cached tokens/rate, approximate cost, including retries) followed by **Task total** (elapsed time, tokens, approximate cost). Missing is Unavailable, actual recorded zero remains zero, loaded subtotals are marked partial, cost is API-rate estimate. Parallel execution sums may exceed task elapsed time. No provider charges are invented.

## Read first

1. Worktree `AGENTS.md` and applicable nested instructions.
2. `TASK-WORKSPACE-MIGRATION.md` and `TASK-WORKSPACE-EVALUATION.md`.
3. `build-evidence/TASK-WORKSPACE/slice-4/REVIEW.md` and paired screenshots/logs. Slice 3 evidence remains historical.
4. Frozen `reference/task-workspace-study-2026-09-21.html`, SHA-256 `905e12d79d63cb1f63dd1ba15cff3125b1ab97e3742555c23b9d64450eccf812` (unchanged).

Current user decisions override older study prose: proposed top navigation selected; header controls on the right; connected stage icons; historical title follows viewed stage; Open retained artifact where applicable; no giant Implement illustration; usage split described above. Do not reintroduce previous/next decision controls, Waiting since or Return to world in this task shell.

## Preview and browser

Vite on **127.0.0.1:5293**, PID **46405** at handoff, belongs to this worktree. Verify process ownership first. Preserve study 5279 and previous slice services 5291/5292. If this preview has stopped, restart it yourself from this worktree with `npm run dev:frontier -- --host 127.0.0.1 --port 5293 --strictPort`. Node is available under `/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`; prepend that directory to PATH if needed.

Fixture links:

- Dev review repair: <http://127.0.0.1:5293/?mode=fixture&scenario=workspace#task/PC-148/dev-review>
- Test execution failure/retry: <http://127.0.0.1:5293/?mode=fixture&scenario=workspace#task/AH-051/test>
- Final review ready: <http://127.0.0.1:5293/?mode=fixture&scenario=workspace#task/QA-204/final-review>
- Final review retained: <http://127.0.0.1:5293/?mode=fixture&scenario=workspace#task/QA-205/final-review>
- Approval ready: <http://127.0.0.1:5293/?mode=fixture&scenario=workspace#task/QA-205/approval>
- Awaiting PR merge: <http://127.0.0.1:5293/?mode=fixture&scenario=workspace#task/MS-091/approval>

Use the stage navigation to change viewed stage. Panel state is retained when returning; reloading resets sample mutations. Sample confirmation/retry/repair actions affect only the tab's fixture state. Never switch these exercises to real task mutation endpoints. QA204/205 were added as explicitly fictional complete-history examples.

Use the current session's browser tool documentation; do not assume handles survive a new agent. The task used `mcp__cua_repl`, actual viewport checks and saved JPEG screenshots. The viewport capability applied to the active/new tab, not every old tab: verify `innerWidth/innerHeight` before labelling captures. Required sizes are 1280×900 and 1440×1000, normal zoom. Reset viewport overrides on completion. Keep a preview tab as a deliverable. Intermittent WebGL-unavailable world fallback means this pass qualified the task overlay, not 3D rendering.

## Validation at implementation commit

- 162 Frontier tests passed; 4 Sites tests passed.
- Typecheck, lint, changed-file formatting, both builds and diff whitespace check passed.
- Full formatting still fails in three unchanged baseline files: `server/research/deepagents/worker.mjs`, `src/research-budget-policy.ts`, `tests/research-deepagents-live.test.mjs`. Do not silently fix unrelated code.
- Build retains existing large-chunk warnings.
- Twenty-four reference/application screenshot pairs (all ten stages, delivery and optional design × two sizes), eight comparison sheets and exceptional-state captures are committed with final logs.
- Browser exercised repair→r2 with retained r1 diff, same-candidate retry and prior test attempt, exact-diff inspection, optional-note approval confirmation→Awaiting PR merge, candidate drift disabling confirmation, disconnected commands, paged usage, delayed evidence error, long title/output, one/many packages, not-required/completed investigation, raw/rendered artifact return, keyboard stage navigation and window controls.
- Existing AH-025, AH-019 and AH-030 records were inspected through the verified companion on 4310. A temporary GET-only browser proxy on 4321 was stopped afterward; 252 logged requests were GET, with no live mutation. Live screenshots/raw records remain under `/tmp` and were not committed. The user-owned companion was never restarted.
- No remote CI pass, live model execution, real task approval/publication, deployment or Shaun visual acceptance is claimed. Check PR checks afresh.

## Stop boundary and next continuation

**There is no planned Slice 5.** The four migration slices are implemented and qualified. The remaining sequence is Shaun's visual sign-off, final code review, then separately authorized stack integration. Polish is complete; merge is not.

### Completed polish scope (historical brief)

Shaun subsequently said “Continue”; the following scope is now implemented and qualified in this same worktree/PR. Retained here as the acceptance brief, not outstanding work:

1. **Consistent primary command placement.** In the current desktop captures, Dev review's Repair candidate action appears near the centre while Test's retry is right aligned. Align the primary action consistently within the existing command region without losing retained-artifact access, disabled explanations, menus, reason fields or confirmation.
2. **Reduce repeated Dev review status.** The command description, recorded verdict panel and red message strip repeat related repair context, pushing findings lower than in the study. Consolidate redundant presentation, retaining authoritative verdict, candidate binding, actionable cause and execution-failure versus candidate-defect distinctions. Preserve distinct messages when they add information; do not suppress errors wholesale.
3. **Consider a useful initial test selection.** Review immediately selects its first finding, but Test initially leaves the detail pane at “Select a check”, unlike the study's selected failed check. Prefer an initial failed result when present, scoped to the selected attempt. Preserve explicit user selection, saved return state and Back to results; a fallback must not immediately reselect a row after Back. Define the passing-only/empty-attempt behavior from existing conventions rather than adding requirements. This is a local interaction adjustment, not a change to test outcomes or retry eligibility.

Inspect `TaskPanel.tsx`, `WorkflowCommand.tsx`, `ReviewEvidence.tsx`, `TestEvidence.tsx`, task-workspace styles and nearby tests before editing. Record a brief implementation plan. Compare actual Dev review and Test at 1280×900 and 1440×1000 against the frozen study and the Slice 4 captures; sanity-check command placement across another stage and approval confirmation. Test initial selection, Back to results, attempt switching and retained return selection if that behavior changes. Run focused checks followed by relevant Frontier/typing/lint/format/build checks. Keep any new evidence separate from immutable Slice 4 screenshots, update this handoff and draft PR, leave preview open and stop for review.

The comparison discussion also identified extra laptop density from window chrome, historical banners and stage usage. This is an acknowledged tradeoff, not authorization for a shell redesign or removing usage. Suggested-code fields absent from the structured review contract should remain absent; do not invent them. Approval-form consolidation and routing changes remain separate.

### Review and integration boundary

Slice 4 is ready for review in draft PR #114, still stacked on open #113 → #111. Do not merge, rebase, retarget, deploy or resume live execution automatically. The preview stays running on 5293 and open at the QA-205 Approval fixture for Shaun. Browser viewport overrides are reset after qualification.

On a new request, first verify the checkout, branch, dirty state, remote PR heads/checks/comments and current services. Read the Slice 4 review and address Shaun's specific feedback with the smallest bounded correction. Preserve the frozen reference, current accepted deltas, workflow authority and untracked dependency symlink. Any future publication/merge needs a separate instruction.

Separate follow-ups, not hidden Slice 4 acceptance gaps:

- The current route includes the initial stage while in-panel selection is saved separately; returning to a visited route may restore that selection. Use the visibly selected stage for assertions. This behavior predates Slice 3 and was not changed.
- Confirmation-form consolidation remains a proposal; current explicit confirmation/reason and exact-head revalidation were preserved and exercised in fixtures.
- Three baseline formatting errors and the browser's intermittent WebGL fallback remain. No 3D renderer qualification or remote CI pass is claimed.

No new task/workflow/asset run, paid model call, real approval/publication, merge or deployment was performed. Shaun's visual review and final code review remain. Any eventual merge should follow #111 → #113 → #114 with current-base verification at each step, only after explicit authorization.
