# Slice 2 review checkpoint

21 September 2026. Ready for Shaun's visual review; this is not a claim of user acceptance or live-runtime qualification.

## Source and preview

- Isolated worktree: `/Users/shaun/.codex/worktrees/task-workspace-slice-2/agent-harness-ui`.
- Branch: `codex/task-workspace-slice-2`, based on verified Slice 1 head `c6e0e31decbaefdbd75fe2d4d6442a0a4e157faa`.
- [Slice 1 PR #111](https://github.com/shaunnez/agent-harness-ui/pull/111) was open/draft and unmerged at kickoff. No merge, rebase, publication or live task execution was performed.
- Original dirty checkout and Slice 1 worktree/service were preserved. Current changes are uncommitted for visual review. The local `node_modules` symlink points to Slice 1 dependencies and is not a deliverable.
- Owned preview: Vite PID **41064**, loopback **5292**, from this worktree. Slice 1's **5291** and study **5279** remain untouched.
- Frozen study: `reference/task-workspace-study-2026-09-21.html`; SHA-256 reverified unchanged: `905e12d79d63cb1f63dd1ba15cff3125b1ab97e3742555c23b9d64450eccf812`.
- No backend, gateway API contract, workflow rules, real execution, design generation or new art changes.

## Review links

These are the actual React application with the in-memory fixture gateway. Actions affect only this tab and reset on reload. `scenario=workspace` adds three explicitly named exceptional QA records without changing the existing workflow fixture population.

| Screen | Preview |
| --- | --- |
| Triage assessment / retained history | [QA-201 Triage](http://127.0.0.1:5292/?mode=fixture&scenario=workspace#task/QA-201/triage) |
| Scouts | [AH-052 Scouts](http://127.0.0.1:5292/?mode=fixture&scenario=workflow#task/AH-052/scouts) |
| Grill | [PC-153 Grill](http://127.0.0.1:5292/?mode=fixture&scenario=workflow#task/PC-153/grill) |
| Specification | [MS-090 Specification](http://127.0.0.1:5292/?mode=fixture&scenario=workflow#task/MS-090/specification) |
| Twelve-package Plan | [MS-092 Plan](http://127.0.0.1:5292/?mode=fixture&scenario=workflow#task/MS-092/plan) |
| Optional Design review | [AH-053](http://127.0.0.1:5292/?mode=fixture&scenario=workflow#task/AH-053/specification), then **Design directions** |
| Failed scout / queued scout | [QA-201 Scouts](http://127.0.0.1:5292/?mode=fixture&scenario=workspace#task/QA-201/scouts) |
| Variable document / full context manifest | [QA-202 Specification](http://127.0.0.1:5292/?mode=fixture&scenario=workspace#task/QA-202/specification) |
| Long question / custom answer | [QA-203 Grill](http://127.0.0.1:5292/?mode=fixture&scenario=workspace#task/QA-203/grill) |
| Implement regression | [PC-142 Implement](http://127.0.0.1:5292/?mode=fixture&scenario=workflow#task/PC-142/implement) |

## Changes and retained capabilities

| Surface | Presentation | Authority retained |
| --- | --- | --- |
| Triage | Bordered assessment; icon-backed requested outcome, scope/risk and investigation | Actual task description, workflow profile, dispatch rationale/focus/reason and full retained report |
| Scouts | Robot cards, aligned activity footers, selected/skipped coverage | Individual run bound by stage and exact scout role; missing run stays unavailable; failed worker stays failed; exact Watch action |
| Grill | Existing form within shared shell; stable command bar; robot identity; static inspector decisions | Host-owned draft keys, first-unanswered sequencing, custom answers, artifact return stack, manual recommendation confirmation/cancel, separate Create specification action |
| Specification | Real Markdown document with section icons and criteria badges | Complete variable content, nested headings, tables, code, raw source, provenance, context manifest, feedback and original approval eligibility |
| Plan | Shared batch diagram and package detail, explicit Planned state | Actual packages/dependencies/commands, remembered selection, one/many package support, retained documents, existing revision/approval and feedback |
| Design review | Shared panel/header, side-by-side provider cards, selected treatment | Sandboxed retained preview, failed/unavailable states, exact policy/revision, retry history and confirmation |

Run activity is collapsed for these early stages. Existing Activity, Agent runs, Decisions, paging and full artifact access remain available. Implement's evidence ordering and shared shell styling remain unchanged.

## Browser comparison loop

Browser-controlled actual application and frozen study were inspected at **1280 × 900** and **1440 × 1000**, normal zoom. Screenshots were opened and visually reviewed, not accepted from DOM checks alone. Both top composition and lower content were inspected. Final application stage content is 928px wide on laptop / 1088px on desktop, with a 268px inspector; document width matched the viewport with no horizontal page overflow. Local scrolling retains the top command bar.

`before-*` captures preserve the initial state. `application-*` are the corrected review captures. Each six-screen pair below exists at both sizes; `application-<screen>-lower-<size>.png` records lower content. Frozen lower reference crops are also retained at laptop size. The study uses document scrolling while the actual app uses local panel scrolling, so absolute vertical position is not a pixel-equality criterion.

| Screen | Laptop reference / application | Desktop reference / application |
| --- | --- | --- |
| Triage | [Reference](reference-triage-1280x900.png) / [Application](application-triage-1280x900.png) | [Reference](reference-triage-1440x1000.png) / [Application](application-triage-1440x1000.png) |
| Scouts | [Reference](reference-scouts-1280x900.png) / [Application](application-scouts-1280x900.png) | [Reference](reference-scouts-1440x1000.png) / [Application](application-scouts-1440x1000.png) |
| Grill | [Reference](reference-grill-1280x900.png) / [Application](application-grill-1280x900.png) | [Reference](reference-grill-1440x1000.png) / [Application](application-grill-1440x1000.png) |
| Specification | [Reference](reference-specification-1280x900.png) / [Application](application-specification-1280x900.png) | [Reference](reference-specification-1440x1000.png) / [Application](application-specification-1440x1000.png) |
| Plan | [Reference](reference-plan-1280x900.png) / [Application](application-plan-1280x900.png) | [Reference](reference-plan-1440x1000.png) / [Application](application-plan-1440x1000.png) |
| Design | [Reference](reference-design-1280x900.png) / [Application](application-design-1280x900.png) | [Reference](reference-design-1440x1000.png) / [Application](application-design-1440x1000.png) |

### Corrections from visual inspection

| Observed difference | Correction / disposition |
| --- | --- |
| Triage label/value layout inherited an unrelated grid | Scoped definition list layout; aligned focus/reason rows |
| Scout portraits and unequal card footers | Bounded portrait column, shared card height and aligned activity footer |
| Specification criteria badges overlapped text | Scoped numbered-list padding corrected; verified in rendered browser |
| Variable document table columns crowded | Cell spacing and local table overflow added; content preserved |
| Design entry scrolled past its heading | Disabled scroll anchoring only for design content; fresh entry begins at Compare directions |
| Plan showed execution readiness and empty execution rows | Planned labels; empty commit/qualification/worktree rows omitted only from Plan; recorded values remain visible |
| Empty qualification list emitted a stray zero | Boolean conditions corrected |
| Grill last-answer double-click could hit newly rendered completion action | Second click ignored; separate Create specification click verified |

### Deliberate code-grounded differences, awaiting visual review

- The real shell retains window controls and sample notice. Past/current/future state comes from evidence, not the study's fictional ten-stage history. Historical Triage therefore includes a history notice and the current Scouts command.
- Full retained Markdown and provenance remain visible. The study's fixed four section names/content are not fabricated when absent. Additional retained artifact links preserve full-view/history access.
- AH-052 has a completed dispatch and queued dispatch but no loaded individual scout runs. Its two cards do not impersonate the study's two running workers or invent source activity.
- Grill uses the existing answer/custom-answer semantics. It does not introduce the study's separate optional reasoning field or answer editing. Submission is in the fixed command bar, above long evidence.
- Plan uses the recorded twelve-package graph; no fabricated interface, risks, outputs, model assignment or usage. Single-package historical Plan was also reviewed. Actual package execution state remains visible when inspecting a historical plan.
- Design review retains actual sandboxed previews and provider failure/unavailable/retry details, making its cards taller than the study's illustrative summaries. No unsupported refinement-feedback capability was added. The command/inspector preserves the underlying active Specification stage.
- Inspector decisions and safeguards remain open/static with local scrolling. They were not removed to shorten the screen.

## Interaction results

All mutation checks used fixture mode only.

- Grill custom draft survived full artifact/raw viewer and back, plus stage navigation away/back. Recommendation review/cancel preserved the draft; explicit acceptance completed the sample session.
- Last-answer keyboard selection and double-click recorded one answer, left Specification inert and exposed Create specification. A separate click advanced to specification approval.
- Long QA-203 evidence kept actions visible; lower custom input remained reachable.
- Exact failed scout Inspect opened its failed recorded run; queued scout offered no unrelated run action.
- Specification rendered/raw preserved unexpected bold heading, table, code and context truncation metadata. Missing artifact produced an alert and Retry evidence; retry preserved the truthful error.
- Specification feedback recorded; investigation approval completed the existing investigation path. Plan approval advanced to ready-to-implement without executing work.
- Plan revision retained the earlier artifact; feedback appeared as a recorded decision. S3 selection survived artifact return and Specification → Plan navigation.
- Activity / Agent runs / Decisions filters exposed retained data. Existing automated paging/race tests passed; a large multi-page activity dataset was not manually paged in the browser.
- Maximise → Restore and Narrower → Reset size worked. Keyboard radio selection and visible focus worked. Future-stage disabled controls were checked. Busy/disconnected eligibility was tested through rendered component tests, not by disconnecting a live service.
- Loading state was observed on page reload; no artificial delay was added. Provider failure and unavailable preview were exercised. Long-lived pending design generation and truly empty artifact body were not separately screenshot-tested; their unchanged rendering paths remain a qualification limit.

## Implement regression

Reviewed [laptop](application-implement-1280x900.png) and [desktop](application-implement-1440x1000.png) against Slice 1's `refinement/implement-running-*` captures. Header, ten-stage rail, command, workshop crop, package summary and inspector retained the corrected composition. Candidate diff at [laptop](application-assembled-diff-1280x900.png) and [desktop](application-assembled-diff-1440x1000.png) retained exact candidate identity, file selection and syntax-coloured content; repair-required / rerun-required gates stayed explicit. Different fixture usage and scroll offsets are documented, not treated as visual equivalence of data.

## Checks

- Focused baseline: **26 passed** before implementation.
- Final Frontier suite: **149 passed**, 0 failed — `tests.log`.
- Typecheck and lint: passed — `typecheck.log`, `lint.log`.
- Changed-file Biome check: passed for all 16 changed/new code/style/test files.
- `build:frontier` and `build`: passed — `build-frontier.log`, `build.log`; existing large-chunk warnings retained.
- Full format check: **three unrelated baseline failures**, verified unchanged from Slice 1 base: `server/research/deepagents/worker.mjs`, `src/research-budget-policy.ts`, `tests/research-deepagents-live.test.mjs`. See `format-baseline.log`.
- `git diff --check`: passed. Final diff inspected; no backend source or frozen study changes.
- Browser diagnostics after corrected source: existing Three.Clock deprecation warning. A temporary syntax error during editing was corrected and followed by successful tests/typecheck/build; prior HMR errors are historical, not a clean-console claim for the entire development session.

## Stop boundary

Preview remains available for Shaun's review. No Slice 2 PR or merge, CI result, deployment, paid run, live approval or live-runtime acceptance is claimed. Slice 3 remains Dev review, Test, Final review, Approval and delivery body migration; Slice 4 remains integrated qualification. Do not start either without instruction.

## User review corrections — 21 September 2026

This checkpoint supersedes the initial shell/image comparison above where Shaun requested a change.

- Removed Previous/Next decision, waiting-since and Return to world banner from task, Grill, findings and approval workspaces.
- Utilities align to the top-right beside breadcrumbs. Stage circles are connected; completed is green, selected blue, errors red (including a red error icon inside a selected blue tab).
- Historical stage commands use the viewed stage, with Open retained artifact only when that stage has one. Active workflow approvals, retries and Grill submission controls remain intact. Redundant Answer questions / Inspect active run shortcuts are absent from the workspace command bar; inspector Watch remains available.
- Removed the large Implement concept image and its reserved height; compact worker identity remains.
- AH-054 and AH-051 lacked completed-stage and artifact history in the sample dataset. Added explicitly labelled demonstration history in the workflow fixtures. Real evidence eligibility and future-stage locks are unchanged.

Browser inspected corrected Scouts/header and running/failed Implement at 1280×900 and 1440×1000. Open retained artifact opened scouts.md; Current stage returned to the live Grill form. Navigated AH-054 Implement → Plan and AH-051 Test → Triage → current Test; future stages remained disabled. Screenshots: `feedback-scouts-*`, `feedback-implement-*`, `feedback-running-implement-*`, `feedback-test-1440x1000.png`, `feedback-test-history-1440x1000.png`. The background world reported a WebGL-unavailable fallback during this browser session; task-workspace DOM and screenshots remained usable. This check does not qualify 3D rendering.

151 Frontier tests passed, typecheck and lint passed, Frontier production build passed (existing chunk-size warning). Changed-file Biome checks and diff whitespace check passed. The first new test attempt used an unsupported raw Node module import; it was corrected to use the existing Vite test loader before the passing full suite. No live task actions, commit, PR, merge or deployment.

### AH-051 package consistency correction

The Test fixture had an assembled candidate containing S1 but S1 was still `planned`. Corrected the sample package to `integrated`, with its head matching the candidate member. No production readiness inference changed. Browser verified the historical Implement view shows 1 integrated, 0 running/ready/waiting, and Integrated in both diagram and detail. Screenshot: `feedback-test-integrated-package-1280x900.png`. Five focused tests, typecheck and changed-file Biome passed. Usage-scope proposal remains a recommendation, not an implemented change: viewed-stage usage plus a compact explicitly labelled task total.
