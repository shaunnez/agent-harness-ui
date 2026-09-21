# Task workspace handoff — after Slice 3

21 September 2026. Requested by Shaun before moving to a new agent. Implementation is pushed; visual acceptance and integrated Slice 4 qualification remain.

## Resume identity

- Repo: `https://github.com/shaunnez/agent-harness-ui.git` (remote `origin`, verify before writes).
- Use existing isolated worktree: `/Users/shaun/.codex/worktrees/task-workspace-slice-3/agent-harness-ui`.
- Branch: `codex/task-workspace-slice-3`.
- Draft PR: **[#114](https://github.com/shaunnez/agent-harness-ui/pull/114)**, base `codex/task-workspace-slice-2`.
- Qualified implementation commit: `747783438c8bd2d67f4ffe3a869833e60f906dcf`. The handoff commit after it contains documentation only; verify current local/remote HEAD before changing anything.
- Dependency stack: main ← Slice 1 [#111](https://github.com/shaunnez/agent-harness-ui/pull/111), branch `codex/task-workspace-slice-1` ← Slice 2 [#113](https://github.com/shaunnez/agent-harness-ui/pull/113), branch `codex/task-workspace-slice-2` ← Slice 3 #114.
- Slice 2 published commit: `3d4e1156ccf7334a899e22d47e31de0a79935843`. PR111/113 were open at inspection; recheck before retargeting or rebasing. Do not merge the stack without instruction.
- Original checkout `/Users/shaun/projects/agent-harness-ui` has unrelated dirty work and remains untouched. `node_modules` in this worktree is an untracked symlink to Slice 1 dependencies: preserve, never stage it.

## What is done

Slice 1: shared top-navigation task shell and Implement. Slice 2: early stages and optional design review, plus user-directed header/nav/image cleanup and truthful fixture history. Slice 3: findings/detail, independently inspectable test attempts, candidate history, final-review journey, approval and delivery panels. Existing workflow commands, confirmation/reason fields, eligibility and exact-head checks are preserved.

Usage now consistently shows **Stage usage — viewed stage** (execution time, input/output, cached tokens/rate, approximate cost, including retries) followed by **Task total** (elapsed time, tokens, approximate cost). Missing is Unavailable, actual recorded zero remains zero, loaded subtotals are marked partial, cost is API-rate estimate. Parallel execution sums may exceed task elapsed time. No provider charges are invented.

## Read first

1. Worktree `AGENTS.md` and applicable nested instructions.
2. `TASK-WORKSPACE-MIGRATION.md` and `TASK-WORKSPACE-EVALUATION.md`.
3. `build-evidence/TASK-WORKSPACE/slice-3/REVIEW.md` and paired screenshots/logs.
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

- 158 Frontier tests passed; 4 Sites tests passed.
- Typecheck, lint, changed-file formatting, both builds and diff whitespace check passed.
- Full formatting still fails in three unchanged baseline files: `server/research/deepagents/worker.mjs`, `src/research-budget-policy.ts`, `tests/research-deepagents-live.test.mjs`. Do not silently fix unrelated code.
- Build retains existing large-chunk warnings.
- Ten reference/application screenshot pairs (five screens × two sizes) plus retry, repair, journey and usage details are committed with logs.
- Browser exercised repair→r2 with retained r1 diff, same-candidate retry and prior test attempt, exact-diff inspection, optional-note approval confirmation→Awaiting PR merge, raw/rendered artifact return, keyboard stage navigation, maximize/restore and window size controls.
- No remote CI pass, live model execution, real task approval/publication, deployment or Shaun visual acceptance is claimed. Check PR checks afresh.

## Next bounded work: Slice 4

Start from current code and evidence, address Shaun's visual feedback first, then integrated parity/visual qualification from the migration plan. This is verification and targeted corrections, not a new redesign.

1. Verify worktree/branch/dirty state, PR stack and source reference. Review PR checks/comments. Preserve all unrelated work.
2. Compare actual UI with the frozen study and current approved deltas at both sizes. Pay attention to local scrolling, header density, portrait sizing, list/detail proportions and stage/task usage consistency. Do not claim pixel identity where contracts differ.
3. Cover states across all stages: running, human input, dependency wait, failed, repair-required, stale, disconnected, loading/error, partial evidence, historical, not-required and completed. Exercise long titles/logs, one/many packages, drafts/return paths, disabled actions and exact candidate consistency. Prior automated tests are evidence, not a substitute for this integrated browser pass.
4. Inspect representative existing live recorded tasks read-only if a live companion is available and its identity is verified. Do not start a model, retry/repair a live task, approve/publish a candidate or create a real task PR for acceptance. If read-only live evidence is unavailable, record the gap rather than changing live services.
5. Add bounded fixtures/tests only for uncovered behavior; keep workflow state and API contracts authoritative. Confirmation-form consolidation was not approved or implemented and remains separate.
6. Run relevant checks, update evidence/handoff, keep preview open and stop for review. No merge/deploy. Maintain stack order if dependencies have changed; explain conflicts before materially changing scope.

Potential follow-up to assess during Slice 4: current route includes initial stage while in-panel stage selection is saved separately; returning to an already visited route can restore the saved selection. This behavior predates Slice 3. Do not confuse the URL alone with the stage visibly selected, or silently broaden this visual slice into routing changes.
