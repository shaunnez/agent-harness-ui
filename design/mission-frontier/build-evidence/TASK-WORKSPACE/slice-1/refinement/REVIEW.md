# Slice 1 correction record

21 September 2026. Shared shell and Implement corrected after the preceding visual checkpoint was rejected. Awaiting Shaun's visual review; this is not a record of user acceptance.

## Identity and scope

- Worktree: `/Users/shaun/.codex/worktrees/task-workspace-slice-1/agent-harness-ui`
- Branch: `codex/task-workspace-slice-1`; source HEAD: `48ca6b52e2fdb0872184fb16d9d6c827ee5603b4`.
- Preview: `http://127.0.0.1:5291/?mode=fixture&scenario=workflow#task/PC-142/implement`.
- Existing Vite process retained: PID 51285, loopback port 5291. Study remains on 5279.
- Frozen reference SHA-256 reverified: `905e12d79d63cb1f63dd1ba15cff3125b1ab97e3742555c23b9d64450eccf812`.
- No reference edits, backend/API/schema/fixture changes, live execution, commits, publication or merges. Original dirty checkout and existing services preserved.
- Existing isolated work was refined in place. Other stage bodies remain outside this slice; shared shell and shared package presentation also appear on their existing routes.

## Actual comparison loop

Opened the frozen study's running and assembled Implement states and its Plan batch view through the browser. Captured the actual React application, inspected the pictures, corrected discrepancies and captured it again at 1280 × 900 and 1440 × 1000. Screenshots in this directory supersede earlier claimed final application captures.

The reference is responsive, contrary to the prior record's fixed-width claim. At laptop size its outer workspace is 1248 px wide, matching the app's 1248 px dialog; at desktop they are 1408 px wide. The actual dialog is at (16,24), 1248 × 852 on laptop and 1408 × 952 on desktop. The inspector is 270 px wide. Application content begins about 8 px below equivalent study content because the app retains window controls and its sample notice. Local scrollbars account for a further 2 px main-content width difference. Browser viewports use normal scale.

| Visible discrepancy | Correction and observed result |
| --- | --- |
| Oversized/card-like navigation, displaced ticks and unreadable future labels | Quiet 64 px stage controls inside the study's rail; selected stage alone has blue panel. Completion icons centred by removing inherited auto margin. Future stages remain disabled, with explicit subdued colour rather than compounded opacity. |
| Task heading hierarchy and wasted modal/header space | Compact window title, actual task title and repository breadcrumb in the study-style header, utilities at right, full-width stage command below the navigator. |
| Dark workshop crop and uneven panel framing | Same supplied workshop image, matching crop and surface levels; consistent bordered headers, icons, spacing and typography. Concept label retained. |
| Generic arrows, falsely labelled parallel packages | Connections derive from recorded dependency IDs and rendered card bounds. Same-batch dependent work is labelled honestly. Wrapped batches use a centre gutter; 12 packages render 20 actual connections without crossing intervening cards. |
| Duplicate package identity and excessive detail clutter | Single selected-package header, package ID beside title, icon-backed detail rows. Command IDs and changed files retained as secondary rows. |
| Small usage text and inconsistent inspector sections | Prominent recorded token total, actual elapsed time from the existing selector, separate cost row, static safeguards/context/decisions sections. Missing rates remain unavailable. |
| Missing candidate panel anatomy and diff file controls | Candidate assembly header, explicit absent-candidate state and disabled diff reason; checked inline diff with file selection, raw source and full viewer retained. |
| Always-visible telemetry tabs competed with evidence | Implement's Run activity is collapsed initially; Activity, Agent runs and Decisions remain within it. Retained artifacts stay directly accessible outside telemetry. |
| Running-package summary obscured failures and dependency waits | Summary is only used for running tasks; recorded failure/repair reason wins otherwise. Ready-to-start and dependency waiting remain distinct. |

## Current captures

All links below are browser screenshots, not generated approximations.

| State | Frozen study | Application |
| --- | --- | --- |
| Running, 1280 × 900 | [Reference](reference-running-1280x900.png) | [Current](implement-running-1280x900.png) |
| Running, 1440 × 1000 | [Reference](reference-running-1440x1000.png) | [Current](implement-running-1440x1000.png) |
| Assembled detail, 1280 × 900 | [Reference](reference-assembled-detail-1280x900.png) | [Candidate and diff](assembled-diff-1280x900.png) |
| Assembled detail, 1440 × 1000 | [Reference](reference-assembled-detail-1440x1000.png) | [Candidate](candidate-assembly-1440x1000.png), [diff](assembled-diff-1440x1000.png) |

Additional resilience captures: [one package](one-package-1280x900.png), [four-package graph](four-package-1280x900.png), [twelve packages](twelve-packages-1440x1000.png), [failed qualification](failed-qualification-1280x900.png), [missing candidate/activity](implement-packages-1440x1000.png), [Plan reference](reference-plan-1280x900.png). One/four-package captures predate the final usage and navigation alignment tweaks; use the paired running captures for final shell appearance. `before-*` files are rejected baseline evidence only.

## Required adaptations, still visible

- Real modal controls, sample identity and fixed commands remain. The app scrolls stage evidence and inspector locally; the study scrolls its whole document. Lower-page captures therefore retain app chrome and cannot share identical document coordinates.
- PC-142 has three recorded packages, including a same-batch dependency. The study has four with S2 and S3 in parallel. The app does not rewrite package records to imitate the study.
- PC-148 provides the four-package assembled candidate. Its initial active stage is Dev review with repair required; historical Implement inspection does not mislabel it as currently implementing. Its existing sample Repair action was exercised in the laptop tab only, producing r2 and retaining prior evidence. Desktop captures retain r1/repair-required. Neither operation reached real task endpoints.
- Candidate identity, full revision binding, gates, stale evidence and repair lineage are retained, so the app's candidate panel is taller than the simplified study panel. Raw diff metadata and file totals are also retained.
- Real descriptions, models, paths, qualifications, timestamps and missing evidence replace illustrative values. No interfaces, scoring rubric, risks, success claims or prices were fabricated.

## Interaction and capability verification

- Selected S3, switched Plan → Implement and returned from the full diff: selection retained. Enter selects S3; Space selects S2; pressed state and visible detail update correctly.
- Recorded-stage navigation works. Future Dev review/Test/Final review/Approval remain inert on PC-142. Stale review is visibly marked on PC-148.
- Current command stays bound to the active stage while inspecting past evidence. Failure output is visible and locally scrollable; AH-054 has no document or output horizontal overflow.
- Opened inline and full exact diff, switched both files, switched raw/file views and returned. Existing binding, truncation, retry and error code paths retained and covered by the Frontier suite.
- Run activity opens/closes; Activity, Agent runs and Decisions render their existing data. Evidence remains outside this disclosure. Missing candidate has an honest absent-data state and disabled diff control.
- One package: one node, zero connections. Twelve packages: 20 actual dependency connections, S12 exposes all ten dependencies, no root overflow. Failed and repair-required sample states retain their reasons and prior evidence.
- Maximised actual dialog to 1424 × 984 at (8,8), restored, used Narrower/Shorter to produce 1328 × 892 at (56,54), checked no internal horizontal overflow, and reset its normal size. Package connections recomputed after resize.
- Disconnected/busy/mismatched-candidate action safety was verified by the existing automated tests. No browser-only connection toggle was invented; live connection loss was not simulated against a real companion.
- Policy, Manage, Pin, Watch, artifacts, pagination, confirmations and exact-candidate actions still use their existing components and gateways. No provider policy or action eligibility changes.
- Final preview console: no application errors; only the existing Three.js `THREE.Clock` deprecation warning. Workshop model metadata now follows the highlighted package's own run, rather than another run in that stage.

## Checks

- Focused workflow/command/page/window suite: 26 passed.
- Final full Frontier suite: 146 passed, zero failed/skipped.
- Final TypeScript check: passed.
- Changed-file Biome check: passed (11 application/test/style files).
- Full repository lint: 534 files passed.
- Full format check has three pre-existing failures: `server/research/deepagents/worker.mjs`, `src/research-budget-policy.ts`, `tests/research-deepagents-live.test.mjs`. Reverified all three unchanged from HEAD; left them alone.
- Both `npm run build:frontier` and `npm run build`: passed. Existing generated-chunk warning over 500 kB remains. Root build prepared Sites artifacts; nothing was published.
- `git diff --check`: passed.

## Changed implementation and handoff

`TaskPanel`, `OverlayHost`, `WorkflowCommand`, `WorkPackages`, new `PackageDiagram`, `CandidateEvidence`, `CandidateDiff`, `DiffDocument`, `StageEvidence`, and the scoped `task-workspace.css` carry the correction. The pre-existing Frontier CSS import and supplied workshop asset remain. Added a regression test for command-summary failure/wait handling. Task instructions and earlier captures are preserved with a supersession note.

Leave the fixture preview running and open for Shaun. Stop at shared shell and Implement; Dev review, Test, Final review and Approval content migration still requires the next slice. Final artistic acceptance belongs to Shaun.
