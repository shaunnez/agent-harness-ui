# Task workspace Slice 3 review

21 September 2026 · Implemented and locally qualified · Awaiting Shaun's visual review

## Identity and scope

- Base: Slice 2 commit `3d4e1156ccf7334a899e22d47e31de0a79935843`, pushed in draft PR [#113](https://github.com/shaunnez/agent-harness-ui/pull/113), based on Slice 1 PR #111.
- Branch: `codex/task-workspace-slice-3`.
- Worktree: `/Users/shaun/.codex/worktrees/task-workspace-slice-3/agent-harness-ui`.
- Preview: <http://127.0.0.1:5293/?mode=fixture&scenario=workspace#task/QA-205/approval>.
- Frozen study: `design/mission-frontier/reference/task-workspace-study-2026-09-21.html`, SHA-256 `905e12d79d63cb1f63dd1ba15cff3125b1ab97e3742555c23b9d64450eccf812`, rechecked unchanged. Served study at port 5279.
- Scope: stage usage plus task total; Dev review, Test, Final review, Approval and PR delivery presentation. Runtime contracts, command dispatch and confirmation behavior remain in their existing implementations. No live task actions, paid model runs or deployment.

## Actual browser comparison

Captured and visually inspected all five late-stage views against the frozen study at 1280×900 and 1440×1000, normal zoom. Files `reference-{review,test,final-review,approval,delivery}-{size}.jpg` and `application-{same}-{size}.jpg` form the ten pairs. These are browser screenshots, not generated mockups. JPEG file signatures and dimensions were checked. `before-review-1280x720.jpg` is an initial capture, not a qualification image.

Application columns measured: laptop main 928px, inspector 270px; desktop main 1088px, inspector 270px. Main starts at x33 and y373; normal overlay leaves 486px/586px of independently scrolling stage content. Reference content region is 1246px/1406px including its columns and padding, with the same 270px inspector. The study has a screen selector; the app has retained window chrome and an explicit fixture banner. Compare equivalent column widths rather than treating their outer chrome as identical.

| Observed discrepancy | Correction / resulting behavior |
| --- | --- |
| Review content repeated the full report below findings | Structured findings use selected list/detail; full retained report remains available through a collapsed disclosure and artifact viewer. |
| Review candidate ribbon preceded the worker summary | Moved ribbon immediately after the summary, matching study order. |
| Test metadata pushed results down | Attempt identity/counts now occupy the left list column, adjacent to detail. |
| Combined test attempts could imply a current pass total | Attempt selector keeps each attempt's rows and counts separate; current gate is explicitly labelled independently. |
| Approval looked like a generic vertical evidence stack | Exact publication brief and candidate gate list sit side by side; command remains in the shared top bar. |
| Delivery duplicated the approval hero and candidate ribbon | PR card owns exact approved identity and timeline; duplicate hero/ribbon removed. |
| Activity appeared before revision history | History now precedes collapsed Run activity, keeping telemetry at the bottom. |
| Sidebar usage meant task totals despite viewed stage | Shared Stage usage follows the viewed stage; compact Task total follows it. Missing fields are Unavailable; partial loaded totals are labelled. |

Required adaptations: no invented suggested code patches, unsupported skipped-test counts, prices, checklist claims or artifact content. Findings render actual structured fields; log/report links cover missing structure. The app retains exact-candidate confirmation, optional reason and command-menu interaction instead of copying the study's illustrative inline approval form. Final Review shows eight prior stages; Approval nine. Historical Final Review has an explicit viewed-versus-active notice. Gate terminology comes from existing selectors. These differences are intentional contract-preserving adaptations, not pixel-identical acceptance.

## Behavioral verification

- PC-148 repair: fixture action generated r2; r1 review became previous/unbound audit evidence. Both revisions remained in history. The r1 diff opened with its full recorded SHA; raw diff and return worked.
- AH-051 test retry: same candidate, distinct attempts. Latest successful attempt showed three passed checks; previous attempt retained one pass, one failure and ENOENT output. Back to results cleared detail. Stage usage included both runs (12m, 124K input, 20K output, 62K cached, 50% cache); task total stayed separately labelled.
- QA-205 approval: exact diff opened; Proceed with reason retained the existing operator-note and head/target confirmation. Sample confirmation moved to Awaiting PR merge, never directly to completion.
- Automated closed-unmerged and mismatched PR cases remain blocked/incomplete; only exact matched completed state renders Delivery completed.
- Final-review report: rendered/raw artifact viewer and return worked. Final-review navigation and sidebar remained stage-specific when active work was Approval.
- Window maximize/restore, narrower/reset controls and Enter-based stage navigation worked. Main and inspector scroll independently. No horizontal overflow in measured stage/inspector bounds.
- Implement regression inspected through recorded stage: integrated package stayed Integrated, with compact portrait and no large workshop image. Stage usage showed Implement's records.
- Existing command test suite covers connection/busy gates, exact candidate drift and future-stage restrictions. These automated cases complement, rather than replace, the browser checks above.

## Checks

Final run after code corrections:

- `npm run test:frontier`: **158 passed**, zero failures/skips.
- `npm run typecheck`: passed.
- `npm run lint`: passed, 550 files, no findings.
- Changed-file Biome format check: passed, 18 code files.
- `npm run build:frontier`: passed; existing large-chunk warning retained.
- `npm run build`: passed; Sites package files produced.
- `npm run test:sites`: **4 passed**.
- `git diff --check`: passed.
- Full `npm run format:check`: **3 pre-existing failures**, all unchanged against the Slice 2 base: `server/research/deepagents/worker.mjs`, `src/research-budget-policy.ts`, `tests/research-deepagents-live.test.mjs`. No unrelated formatting fixes made.

Logs are saved beside this report. No remote CI result is claimed. Browser automation displayed the existing WebGL-unavailable world fallback intermittently; screenshots qualify the task overlay DOM, not 3D rendering. Some reference content is fictional/richer than current records. Shaun's visual acceptance and Slice 4's integrated/read-only live-record qualification remain outstanding.

## Ownership and next boundary

Preview owned by this worktree: Vite PID 46405, bound to loopback port 5293 at handoff (verify current process before acting). Existing ports 5279, 5291 and 5292 were preserved. The original checkout remains untouched. `node_modules` is an untracked symlink to Slice 1 dependencies and must not be committed.

Next work is Slice 4 integrated parity and visual qualification, with user feedback incorporated first. Read `TASK-WORKSPACE-MIGRATION.md`, `TASK-WORKSPACE-EVALUATION.md`, this report and the handoff. Do not broaden this to backend workflow changes, model execution, real task approval, merge or deployment.
