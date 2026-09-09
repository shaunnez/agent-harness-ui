# Mission Frontier — usability and command experience

Revision 3 · 9 September 2026 · **Goal 4 U0–U2 complete, including native 200% zoom. Goals 5/6 remain planned.**

See the [Goal 4 acceptance and evidence](build-evidence/USABILITY/goal-4/acceptance.md). The scope below remains the approved plan; its historical baseline is not new qualification.

Shaun accepted the six recommendations from the [laptop review](build-evidence/LAPTOP-REVIEW/REVIEW.md) and requested this plan. The accepted Mission Frontier world remains the visual foundation. The next work should make it easier to operate on a laptop, follow important work across projects, and understand real progress through the game.

## Delivery order

| Run | Outcome | Scope | Completion checkpoint |
| --- | --- | --- | --- |
| **Goal 4 — laptop usability** | More usable space and a useful agent view without scrolling past explanations | U0 baseline, U1 windows, U2 Watch an agent | Matched laptop comparisons, working resize/scroll/keyboard interactions, all task controls preserved |
| **Goal 5 — command workflow** | Work through decisions, catch up after an absence and follow selected tasks | U3 decision navigation, U4 return briefing and UB1 read contract, U5 watch pins | Complete cross-project journey, accurate briefing coverage and bounded refresh costs |
| **Goal 6 — meaningful game feedback** | See recorded work arrive and move through the world | UB2 incremental activity, U6 event feedback, final combined qualification | Timely recorded activity, truthful transitions, no reconnect replay, performance and accessibility checks |

Run these in order, with a handoff after each. Shaun explicitly started Goal 4 after approving this plan. [BUILD-GOALS.md](BUILD-GOALS.md) retains the execution prompts. Goals 5 and 6 require their own start instruction.

## Baseline and ownership

- The implementation reference inspected for this plan is retained PR source `fdbe171a8545a6b9ae206b67ce01fe79606496f1` on `codex/mission-frontier-v1`, associated with [PR #73](https://github.com/shaunnez/agent-harness-ui/pull/73). Its recorded qualification is in [PR-HANDOFF.md](PR-HANDOFF.md). Those historical results do not qualify the planned changes.
- The original design workspace has unrelated dirty runtime and application files. Preserve them. The previously documented PR checkout path is absent at planning time; the commit remains available locally. Before building, inspect the actual worktree list, remote and current PR/merge state, then use an isolated checkout from the current authoritative source. Do not recreate an old base blindly or copy the whole dirty workspace into a branch.
- The [laptop screenshots](build-evidence/LAPTOP-REVIEW/REVIEW.md) are the before reference: 1280 × 720, sample PC-142. The Task command window is 1200 × 624, but its main stage viewport is only 308 px tall. The Watch panel is approximately 538 × 619, with activity starting near its bottom edge. These are measured observations, not new acceptance results.
- Reuse the existing semantic React overlays, Pixi renderer, refresh coordinator, attention projection and runtime action gateway. This is one application, with the game as its core workspace.
- Keep the approved model/effort controls, always-open task inspector, exact candidate and approval semantics, day/night settings and all current destinations. Building placement, persistent names, upgrades, unlocks and an economy remain v2.

## U0 — establish the comparison

Before editing, record the actual source revision, running frontend/API ownership, fixture source and viewport. Capture Task command, Watch, New task and an evidence/diff viewer at 1280 × 720 and 1440 × 900. Include running, needs-input, repair and historical-run cases.

Use the existing review captures as visual evidence; reproduce their state in the implementation checkout where possible. If the source or fixture differs, explain the difference rather than claiming an exact comparison. Use separate fixture ports and disposable stores. Do not restart the user's companion, resume live tasks or dispatch paid runs for this work.

## U1 — windows that work on a laptop

### Intended experience

Task command opens as a generous centred work window. Its header combines task identity, current/viewed stage and the next eligible action without repeating those facts in several large blocks. Back, maximise/restore and Close remain visible while content scrolls. Long titles wrap or truncate accessibly; they never push controls out of reach.

Add bounded edge/corner resizing for work windows, with remembered dimensions by window family. Maximise uses the available browser viewport; Restore returns to the previous size. Reset size provides a reliable recovery path. Keep centred placement in this pass: arbitrary dragging, docking, snapping and a desktop-style multi-window manager are outside scope.

The task window keeps its compact stage rail, main work area and always-open inspector. The main work area has one obvious vertical scrollbar. Other necessary columns may scroll independently; remove nested vertical scrolling within the main content where practical. Preserve horizontal scrolling for wide diffs/code. Reflow at narrower widths without shrinking text or hiding inspector sections behind accordions.

On first opening Implement, reveal the running, blocked or selected package; keep the full dependency batches accessible. Later polling must not steal scroll position, focus or the user's package selection. Evidence and artifact viewers get the same sizing controls; small confirmation dialogs retain an appropriate compact size.

### Acceptance

- At 1280 × 720, the maximised Task command window shows at least **420 px of main stage content** in the same running-package fixture, compared with the 308 px baseline. This is a target to verify, not permission to reduce readable type or conceal operational content.
- Body and controls normally remain 14–16 px; metadata stays at least 12 px. Stage identity, current state and next eligible action are visible before scrolling. All ten stages retain past/current/future behavior.
- Resize, maximise, restore and reset work with a pointer. Maximise/restore and a keyboard-accessible size control provide equivalent access without dragging.
- Dimensions survive reopening and reload, are clamped after viewport changes and browser zoom, and safely fall back when storage is unavailable or contains invalid values. Store dimensions only, not task content or drafts.
- No document-level vertical scrolling in the desktop game workspace. Scroll regions have discoverable tracks where supported, stable gutters, useful focus behavior and no dead-end nested scrolling. Where the OS hides native tracks, retain a visible overflow cue and verify keyboard/wheel access.
- Escape, Back, focus containment and focus return remain correct for modal dialogs, including nested evidence and unsaved forms. Resizing a DOM window must not pan or zoom the world.
- New task, Settings, Projects, policy editing, approvals, artifacts and diffs remain usable at laptop sizes. At 200% browser zoom and narrow widths, controls and content remain reachable through deliberate reflow; the 420 px target applies only to the reference viewport at normal zoom.

Likely owners: `ui/Modal.tsx`, `ui/forms.css`, `ui/workflow.css`, `ui/responsive.css`, `app/OverlayHost.tsx`, and task/evidence views. Add a small validated layout-preference module if needed; keep it separate from task/domain state.

## U2 — activity-first Watch an agent

### Intended experience

Keep the robot and room visible beside an adjustable inspector. Use one compact identity block: task, stage, run, role, model and reasoning. Immediately below it show current task/run state, the recorded reason and next actor when attention is required, and the eligible task action.

The next row shows elapsed time, recorded tokens, recorded API-rate estimate when available, and the age of the latest event. The main area opens on Activity; Output and Context remain adjacent views. The run selector and historical/current distinction remain obvious. Model policy editing stays accessible and must never rewrite the selected run's historical policy.

Replace repeated explanation cards with a short visible animation label. The activity view retains its actual tool/step records, load-more controls and complete evidence access. Follow new events only while the user is at the end; otherwise show a New activity control without moving their reading position.

### Acceptance

- At 1280 × 720, identity/state, next action, elapsed time, usage availability and last-event age appear without scrolling. At least **240 px** remains for the activity viewport in the normal running fixture.
- The panel can be widened and restored within viewport bounds. The world's important selection remains visible in normal mode; an explicit expanded reading mode may temporarily cover it.
- Label a started, non-terminal tool event as current only while its exact run remains active. Otherwise show Latest recorded activity. A quiet event stream alone does not mean a run has failed, stopped or become stuck.
- Pending usage reads **Not yet reported**; unsupported cost reads **Unavailable** with its explanation in one place. Never extrapolate tokens or billed dollars. A recorded zero remains distinct from missing data.
- Separate terminal run status from a waiting task. Dependency, human input/approval, execution failure, repair and connection loss retain distinct reasons and actions. Historical workers remain parked.
- Initially this uses the available recorded events. UB2 later improves when those events reach the UI; Goal 4 must not claim live tool visibility while the backend still buffers them.

Likely owners: `views/AgentPanel.tsx`, activity/usage components, `runtime/presentation.ts` and panel styles. Keep safeguards, context and recorded decisions inspectable without introducing accordions into the universal task inspector.

## U3 — work through Needs you

Extend the existing queue rather than adding another inbox. Show project, task, stage, reason, waiting age and next actor. Keep deterministic ordering: failures/repair first, then the oldest outstanding decisions, with task ID as the final tie-breaker. Dependencies and external waits remain visible in task state but do not masquerade as decisions the user can resolve.

Opening a queue item enters a review session with **Previous decision**, **Next decision** and **Return to world**. Navigation selects an item; it never answers, approves or starts work. Preserve the originating world view, camera, filters and unsaved answer draft. Keep the selected item stable when the queue changes; new items get an update indicator rather than moving the current decision underneath the user.

Acceptance:

- Resolve a Grill answer, inspect a repair and review a candidate-bound approval across different projects without repeatedly locating their islands.
- Every action uses existing eligibility and explicit confirmation. After success, refresh authoritative state before changing the item's queue status. A failure leaves the item, draft and actionable error visible.
- If another client resolves an item or the candidate changes, show the updated state and require a fresh eligible action; stale approval cannot target a replacement candidate.
- Next/Previous do not submit an unfinished draft. Closed/archived/disappeared tasks and a now-empty queue have clear outcomes. Keyboard navigation, Back and camera restoration are verified.

Likely owners: `views/WorldHud.tsx` / `AttentionQueue`, `app/navigation.ts`, `app/panel-state.tsx`, existing decision views and gateway commands. This slice needs no new mutation endpoint.

## U4 — a return briefing

When returning after an absence, offer a quiet **While you were away** entry. Opening it shows a dated interval with completed work, new or changed blockers, decisions waiting now, changed candidate gates and recorded usage. Group by project, then task; every item opens the corresponding task, run or evidence. Keep unresolved decisions prominent even if they predate the interval, under a clear **Still needs you** label.

Use a deterministic summary of backend records, without a summarising model call. Capture a baseline on first visit; do not invent earlier history. Retain a browser-local acknowledged checkpoint for each runtime/store identity and separate sample worlds from live data. Closing an unread briefing does not mark everything seen; **Mark reviewed** advances only through the captured upper bound, leaving later arrivals for the next briefing.

Acceptance:

- The same recorded input and checkpoint produce the same items and totals. Repeated polls, duplicate events and reloads do not duplicate entries.
- Display the interval and data coverage. Retention gaps, unavailable sources or incomplete pagination produce an explicit incomplete-history state, not a reassuring zero. Never quietly mark unseen pages reviewed.
- Tasks completed, repaired and blocked again within one absence retain the material history as well as current state. Do not infer that history by comparing only two task snapshots.
- Usage is labelled **Recorded usage from runs completed in this interval** when that is what can be measured. Runs crossing the boundary are not presented as a precise measure of spending during the absence. Count each run once; do not add run totals to task totals. Label supported costs Approx. cost / API-rate estimate and preserve missing usage.
- Multiple tabs, database replacement, renamed projects, deletion, retention and a changed source identity do not corrupt the checkpoint or leak pins/history into another workspace.
- Catch-up work is bounded and paginated, independent of the number of full task records. Interrupted loading can resume without losing the last acknowledged boundary.

### UB1 — narrow read contract required for the briefing

At the inspected revision, the gateway exposes task-scoped activity pages, summaries and version markers; it does not expose a workspace catch-up feed. Activity retention is bounded, and current summaries cannot reconstruct every transition. Do not hydrate every full task in a new browser polling loop.

Add an additive read projection over the existing retained event/run records: source identity, task/project/run identity, event identity, recorded time, structured event kind where supported, relevant artifact/candidate scope, pagination and explicit coverage. Return a stable upper bound and resumable cursor. Use an authoritative commit/observation ordering for newly recorded facts; do not rely only on provider timestamps or task IDs. Revalidate the store's existing ordering first. If minimal persisted source/order metadata is required, include its migration, export and rollback compatibility in this slice.

This remains a read model over the transactional store; it is not a replacement event ledger, message bus or new orchestration engine. Preserve existing endpoints and retained records. The JSON/legacy path must either provide tested parity or explicitly report unavailable/partial coverage. Legacy history without enough evidence cannot acquire invented event identities or completeness. Initial loading/reconnection consumes a baseline; it is not a trigger for replaying game animations.

Contract tests must cover equal timestamps, late records, concurrent writes while paging, duplicates, pruning, restart/source replacement, empty stores and invalid cursors. Store identity must be opaque; no credentials or absolute database paths are exposed as identifiers.

## U5 — pin important work

Add a compact, optional watch strip with up to **four pins**. Each card carries project/task identity, state, stage, last update and an Open/Watch control. Task pins follow that task's current work. A deliberately pinned run stays bound to that exact run and becomes historical when it ends; it must never silently switch agents.

Acceptance:

- Pin/unpin from task and agent views; return directly from World or headquarters. Pins persist locally for the same source, with a clear empty state and recovery for missing/archived tasks.
- Pins reuse the summary refresh path. Only selected/pinned details that are actually needed may be fetched, under the same coordinator with bounded concurrency; four pins must not create four independent pollers or hydrate all task histories.
- At 1280 × 720 the strip occupies at most one compact row, with a deliberate overflow/collapse treatment. It does not cover the minimap, Needs you actions, selected-task action or modal close controls.
- Offline and stale pins say Last known state. Missing data is not shown as idle or completed. The strip is keyboard accessible and respects reduced motion.

Search already exists in the task library. A new global command palette, saved views and multi-monitor layouts are follow-ups, not additional acceptance requirements here.

## U6 — make recorded progress visible in the game

Keep ambient roaming and role work loops. Add brief feedback for a small set of meaningful recorded events, using the existing art and transition infrastructure before commissioning assets.

| Authoritative observation | World feedback | Operational link |
| --- | --- | --- |
| A task actually advances to another stage | A short journey between known room anchors | Open that task at its recorded stage |
| A persisted artifact becomes available | A brief arrival effect on the existing artifact object | Open the exact artifact |
| An explicit repair transition begins | Show the return route and the affected worker's move | Open Implement and repair lineage |
| A task reaches its real delivered/completed state | A restrained completion signal | Open final delivery evidence |
| A task needs human action or fails | Persistent task-specific attention marker, with one brief arrival cue | Open the eligible decision or failure detail |

A required repair that has not started keeps its worker parked and exposes the next action; do not animate a repair journey early. One integrated package does not mean the task is complete. An agent finishing does not mean a PR has merged. Keep these distinctions explicit in both the effect selection and textual feedback.

Acceptance:

- Effects use typed persisted facts and stable identities, not guessed meanings from arbitrary event titles. Extend the existing transition tracker instead of adding a second competing tracker.
- Initial load, historical pagination, reconnect and returning from a hidden tab seed the latest world state without replaying a backlog. Duplicate/out-of-order observations produce no duplicate journeys. Missed intermediate stages do not produce an invented tour through those rooms.
- Cap simultaneous effects and coalesce busy-world notifications. Selection, clicks and current state are available immediately; animation never delays a command or holds the task at its former stage.
- Use actual room/path anchors at World and headquarters scales. Missing art/anchors fall back to a labelled state change, never teleporting through unrelated bases or changing project placement.
- Reduced motion uses static emphasis and text. Existing audio preferences stay authoritative; no new default-on sound. Disconnection stops activity effects and preserves last-known labels.
- Cover running sibling packages, waiting tasks with completed agents, repairs, historical runs, and changed candidate revisions. Ambient crew never acquire task identity or execution counts.

### UB2 — incremental recorded activity

The inspected execution callback accumulates `runtimeEvents`; retention publishes tool/agent events when the run finishes. Expose small bounded batches of existing normalised tool/activity events while the exact run is active, then consume them through the existing HTTP refresh path. A new SSE/WebSocket transport is unnecessary for this scope.

Preserve run, task, package and candidate identity; record event occurrence and observation times distinctly where available. Final retention must not duplicate events already recorded incrementally. Flush pending accepted events before terminal run persistence; serialize writes through existing store coordination. Test cancellation, timeout, process interruption, late callbacks, concurrent packages, retention limits and storage failure. Telemetry must not overwrite newer task state or claim execution success; persistence failures need an observable error and recoverable pending data.

Only publish normalised operational events already permitted by the runtime contract. Do not expose private reasoning, raw provider streams, credentials or unbounded command output. Token totals remain unavailable until reported by the provider; activity timing does not justify estimating them.

Under the local fixture workload, a persisted event should appear in Watch within the next successful refresh cycle, targeted at **three seconds or less** in a foreground connected browser. Measure callback-to-persistence and persistence-to-UI separately. A failed refresh shows its state and is not counted as a successful freshness result.

## Verification and handoff

### Functional and visual matrix

Verify the affected destinations at 1280 × 720, 1440 × 900 and the established desktop reference, plus narrow/200% zoom reflow. Include long task names, long Markdown/diffs, multiple dependency batches, input/approval, dependency waiting, execution failure, repair, disconnected state, empty projects, unavailable usage and historical runs.

Capture matched before/after screenshots and measure the visible content, not just the outer window. Exercise actual pointer resize, maximise/restore, scrollbar dragging/wheel/keyboard, tab order, Escape/Back, focus return, unsaved drafts, queue changes, follow-new-events and source switching. Respect the selected browser and distinguish browser interaction evidence from deterministic tests. Do not claim native OS scrollbar, background-tab or screen-reader checks passed unless exercised successfully.

At Goal 5 and Goal 6, record request counts and payloads for the existing normal/stress fixture: 10 projects / 100 tasks and 50 projects / 1,000 tasks. Compare on the same machine and viewport. Keep a single refresh owner, no overlapping cycles and no cost that scales with full history hydration. At Goal 6, retain the existing cold-load target of 20 MiB and decoded-texture target of 192 MiB; new visual art must load on demand. Investigate any repeatable frame-time regression over 10% on matched measurements. Retain the existing normal-workload gate of at least 50 median FPS and at most 33 ms p95 frame interval; measure stress behavior and verify that all records/actions remain reachable. Report hardware and evidence limits.

### Checks

Run the narrow behavior/contract checks first. Before each goal handoff run typing, lint, formatting and both application builds. Include affected Frontier API/store/orchestration tests when UB1 or UB2 changes those boundaries. At the final combined checkpoint run the complete root, Frontier and Frontier API suite with the repository-supported Node runtime (at least 22.13; the retained PR used Node 24):

```sh
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run build:frontier
node --test --test-concurrency=2 tests/*.test.mjs tests/frontier/*.test.mjs tests/frontier/api/*.test.mjs
```

The legacy build must precede the complete test run because Sites worker tests inspect its packaged output. Preserve `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs` and `tests/sites-worker.test.mjs`. Do not add tests that merely repeat CSS declarations; use measured browser outcomes for layout and behavior tests for persistence, navigation and event correctness.

Store the source/runtime baseline, acceptance table, check output, screenshots, measurements, progress and remaining issues under `build-evidence/USABILITY/`, with `goal-4/`, `goal-5/` and `goal-6/` subfolders as each starts. Keep one top-level `progress.md` linking those checkpoints. No checkbox is complete without its corresponding evidence.

Each goal leaves a working preview and a reviewable diff. Report what changed, which gates passed, what remains unverified and the next goal. Update the separate journal with dated planned/built/verified distinctions and preserve its current audience. The game is not published by this work. Do not merge a PR or start later goals automatically.

## Scope, dependencies and separate follow-ups

Goal 4 is predominantly frontend work and can deliver value before new telemetry exists. Goal 5 includes the narrow UB1 read boundary because a reliable absence briefing needs more than current summaries. Goal 6 includes UB2 because tool-level feedback needs events before a run finishes. Keep those changes as separate commits with backward-compatible contracts and fixture coverage.

Use existing assets for the first proof. An Astra asset assignment is optional only if the integrated Goal 6 proof establishes a concrete missing asset; give it disjoint staging ownership, measured dimensions and an explicit event purpose under [ASSET-PRODUCTION.md](ASSET-PRODUCTION.md). The builder owns integration and acceptance. No asset agent is needed to begin Goal 4 or Goal 5.

The outstanding real implementation → repair → approval → PR journey remains a separate operational qualification item from the prior handoff. These UI goals must not be presented as that real delivery proof, and should not resume the user's existing tasks as a shortcut. Native lifecycle checks and the prior bundle warning remain open until separately verified or fixed. No framework rewrite, full 3D renderer, window manager, speculative success metrics or v2 progression is included.

## Sources

- Shaun's accepted recommendations and request to write this plan, 9 September 2026.
- [Laptop review and captures](build-evidence/LAPTOP-REVIEW/REVIEW.md), [selected design](reference/selected-world.png), [original implementation plan](IMPLEMENTATION-PLAN.md), [attention contract](ATTENTION-CONTRACT.md), [living-world brief](LIVING-WORLD.md) and [PR handoff](PR-HANDOFF.md).
- Source inspected at retained revision `fdbe171`: `ui/Modal.tsx`, task/agent styles and views, `app/navigation.ts`, `app/panel-state.tsx`, `app/preferences.ts`, `runtime/contracts.ts`, `runtime/coordinator.ts`, `world/scene.ts`, `world/activity-effects.ts`, `server/task-projections.mjs`, `server/run-activity.mjs`, `server/sqlite-store.mjs`, `server/orchestrator-repair-execution.mjs` and `server/orchestrator-retention.mjs`. Recheck current source before implementation.
- [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), inspected during the laptop review, for existing focus, Escape and return behavior.
