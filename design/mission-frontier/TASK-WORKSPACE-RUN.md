# Task workspace: Sol implementation run

21 September 2026 · Prepared for kickoff · Implementation has not started

## Recommended setup

Continue this desktop task with GPT-5.6 Sol (`gpt-5.6-sol`), High reasoning, using one implementation agent. Compaction is optional; it is appropriate before the substantial implementation run, with this file and the saved references providing continuity. Selecting Sol and compacting do not themselves start the implementation.

The current task has browser automation through `mcp__cua_repl`. Read-only access to the running study tab was verified on 21 September. Use the browser's documented interaction, rendered-state and screenshot APIs. The model must verify those capabilities again at kickoff. A standalone CLI process must not be assumed to inherit desktop browser access. No separate Playwright installation is required for the desktop browser route; use the APIs exposed in the active session.

Keep model selection separate from the product's agent policies: using Sol to build this UI does not change Agent Harness's Luna/Sol task-policy defaults.

## Inputs that survive compaction

Read these before editing:

1. Repository `AGENTS.md` and any applicable directory instructions.
2. `design/mission-frontier/TASK-WORKSPACE-MIGRATION.md` for code mapping, scope and known differences.
3. `design/mission-frontier/TASK-WORKSPACE-EVALUATION.md` for layout, visual anatomy and retained capabilities.
4. Frozen visual reference: `design/mission-frontier/reference/task-workspace-study-2026-09-21.html`.

Frozen reference identity:

- Size: 674331 bytes.
- SHA-256: `905e12d79d63cb1f63dd1ba15cff3125b1ab97e3742555c23b9d64450eccf812`.
- Copied unchanged from `/Users/shaun/.codex/visualizations/2026/09/20/01a0c13d-b9f3-7b40-97af-76586b0a034d/task-workspace-study.html`.
- Existing preview: `http://127.0.0.1:5279/`. Verify the process and content at kickoff; the URL alone is not a durable reference.
- The HTML is a visualization fragment using its host's icon/runtime support. Use the installed visualize skill's preview renderer if it needs serving again; opening the raw fragment is not an equivalent preview. Read that skill's current instructions before using its renderer.

Preserve the frozen reference. Do not alter it to make the implementation appear to match. User-approved changes should create a separately identified reference revision and record the reason. A copied study is visual guidance, not production code to paste wholesale into React.

Current inspected repository baseline is local `main` at `48ca6b5`. Refresh Git status and relevant source before work. The planning docs, reference and instruction changes are currently uncommitted; a new worktree will not automatically include them. When creating the isolated implementation checkout, explicitly carry only these task inputs across and verify the reference hash. Preserve other dirty files and existing user services.

## First run scope

Implement migration slice 1: the shared task shell and Implement stage. Use the proposed horizontal stage navigation as the first visual checkpoint if the kickoff prompt below is accepted. This is a concrete proposal for review, not authority to introduce a navigation preference setting.

Keep all other stages working through the shared shell, with their current content until their own migration slice. Preserve the existing overlay sizing, selection/return paths, inspector access, model policies, Manage, Pin, Watch, evidence loading, activity access and exact-candidate commands. Use existing data contracts, package state selectors and checked diff loading. Retain the current confirmation interaction during this first slice.

Use dynamic 1–N packages; the four-package study is one fixture shape. Do not add backend fields to reproduce illustrative interfaces, risks, rubric scores or code suggestions. Missing data should keep an honest artifact route or absent-data presentation.

## Required browser comparison loop

1. **Establish the visual target before editing.** Open the frozen study and inspect Implement with packages running and candidate assembled. Inspect Plan for shared batch anatomy. Capture reference views at normal 100% zoom, with desktop 1440 × 1000 and laptop 1280 × 900 browser viewports. Record the actual task-content width because the study wrapper and application overlay have different chrome. Compare equivalent content bounds, navigation mode, selection and snapshot.
2. **Start the isolated app preview.** Use the existing fixture gateway and actual React components, with dedicated available ports. Keep fixture identity conspicuous. Do not connect visual testing to real mutation endpoints. Preserve existing servers and the study preview.
3. **Implement one coherent section, then render it.** Build, open the real application, select the matching fixture state and capture the same views. Read-only measurements may help explain a mismatch; they do not replace looking at the screenshots.
4. **Compare against the reference explicitly.** Inspect shell proportions, command placement, panel grouping/borders, surface levels, typography, spacing, robot framing, icon consistency, batch alignment/connectors, package selection, candidate/diff placement and inspector readability. Check normal-window scrolling and visible access to the next action.
5. **Correct discrepancies and repeat.** Keep a short table of discrepancy, correction and result. Distinguish required adaptations for real data from unintended drift. Do not declare visual acceptance on the basis of build success, DOM presence or no-overflow checks alone.
6. **Exercise the interactions.** Select packages, inspect worker/artifact/diff views, switch diff files, return without losing selection, open/close activity, navigate recorded stages, verify future stages are inert and verify command disabled states. Check keyboard access, focus and real window resizing. Re-run the affected visual checks after material corrections.

Also exercise one package, more than four packages, long labels/output, failed qualification, repair-required/stale gates, missing candidate/diff and disconnected state. Compare the representative design composition using similar fixture data; separately verify resilience with different real contract shapes. Do not change business values merely to match a screenshot.

Use the migration plan's focused tests and broader build/type/style checks. Browser interaction verification and automated workflow tests are complementary. A browser-tool failure leaves visual qualification explicitly incomplete; it is not permission to substitute a textual claim of fidelity.

## Evidence and completion

Write the checkpoint record under `design/mission-frontier/build-evidence/TASK-WORKSPACE/slice-1/` in the implementation checkout:

- Reference identity, source commit, actual preview URL, viewport and overlay dimensions.
- Reference and implementation captures for the representative running and assembled states, with matching labels. Save through the browser's supported screenshot/export capability; if export is unavailable, identify the tool-returned captures and state that limitation.
- Visual discrepancy table with any remaining difference and its reason.
- Existing-capability mapping and interaction results, including the exact command/state boundaries preserved.
- Commands/checks actually run and their results. Keep pre-existing failures distinct from regressions.
- Changed files, outstanding work, server/process ownership and next-step handoff so a later compact can resume safely.

Finish slice 1 with its preview open for Shaun's visual review before extending the new stage content to the remaining slices. Technical checks and documented screenshot comparison must both be complete, with remaining deviations visible. Do not claim Shaun's visual approval on his behalf.

This run does not include real task execution, approval, PR publication, merging or deployment. Do not start another agent or task unless separately requested.

## Kickoff prompt

Use this after selecting Sol High. Sending it starts the bounded implementation:

> Implement slice 1 using `design/mission-frontier/TASK-WORKSPACE-RUN.md`. Create an isolated worktree, carry over the uncommitted task references, and preserve the existing UI logic and capabilities. Use the study's proposed top navigation for this checkpoint. Use the available browser tools to compare the actual application with the frozen design at laptop and desktop sizes, correcting visual drift before finishing. Run the relevant checks, leave the preview open, and stop after the shared shell and Implement stage are ready for my visual review.

## Preparation verified

The frozen reference was copied byte-for-byte and hash-checked. The active desktop browser tool could inspect the study at port 5279. This preparation has not changed the application, selected a different model, compacted the task or started implementation.
