# Goal 6 — recorded activity and robot feedback

25 September 2026 · Plan prepared at `01a32969` · **Implemented for review on 25 September 2026.** See [implementation evidence and handoff](build-evidence/USABILITY/goal-6/HANDOFF.md). The foundation and delivery sequence below retain the pre-build plan.

## Outcome

Make recorded work visibly arrive and progress through the existing 3D colony. Watch should show permitted operational activity while its run is happening. Robots should react to meaningful task events, with short journeys and local effects that preserve the actual task state and immediate access to actions.

Deliver UB2 and U6 from [USABILITY-PLAN.md](USABILITY-PLAN.md), including the task-created arrival added by [colony/DELIVERY-SLICE.md](colony/DELIVERY-SLICE.md). This plan updates the Goal 6 implementation approach for the current renderer. Shaun subsequently authorized the build in an isolated feature worktree, including running and visually qualifying the app.

## Current foundation and corrections to the old brief

- The current 3D worker already has walk, scan, type and tool-work clips (`src/frontier/world-3d/worker-clips.ts`). Active work, idle roaming and parked workers are distinguished by `src/frontier/scene/worker-behavior.ts` and `world-3d/colony-workers.ts`.
- SQLite workspace history already supplies source identity, ordered sequence numbers, bounded pages and coverage gaps. Its facts currently cover task state, candidate gates, artifacts and completed runs. It needs explicit transition context for journeys.
- `server/orchestrator-repair-execution.mjs` collects runtime activity in memory. `server/orchestrator-retention.mjs` currently publishes the final 100 events at completion. Incremental persistence must replace that duplication boundary carefully.
- The old instruction to extend an existing transition tracker refers to removed 2D code. Add one transient event consumer to the current refresh owner and 3D scene; do not restore the old renderer.
- Use `design/mission-frontier/assets/staging/colony-v2/contract.json`, imported by `world-3d/colony.ts`. Room and door geometry exists; the full arrival route is not yet an executable waypoint graph. Do not build against the superseded colony-hq-v1 contract.
- Research now shares the world, but its execution and persistence are separate. This goal covers delivery-task UB2/U6. Preserve research rendering and controls; adding research-specific journeys or activity persistence is separate work.

## Visible behavior

| Recorded trigger | Intended feedback | Truth and interaction rule |
| --- | --- | --- |
| A new task is persisted | Brief cue at the existing hub shuttle/pad, then a robot arrival along the connected route to its project | Creation does not imply execution. On arrival, use the task's actual parked/idle/active state. An already waiting or blocked task uses a static arrival cue at its destination. |
| A task advances stage | A short walk through the correct HQ doors and hub to the new room | Labels and actions change immediately. Stages sharing a physical room use local emphasis rather than a pointless walk. |
| A permitted tool activity is recorded for the currently active run | Brief scan/type/tool-work response where the normalized category supports it; activity text appears in Watch | Reuse existing clips. Unknown categories retain the stage work loop. Do not infer successful tool completion from a started event. |
| A persisted artifact becomes available | Brief cargo/artifact emphasis at the relevant room or base | The cue opens the exact artifact; it cannot select a different revision's evidence. |
| An explicit repair begins | Short return journey to Implement | Repair-required alone leaves the worker parked with the eligible action. Bind the journey to the recorded repair attempt and lineage. |
| A task reaches its authoritative delivered/completed state | Restrained task completion signal at its base | Agent completion, package integration and approval are not interchangeable with task delivery. |
| A task first needs human action or fails | One brief attention cue plus the persistent task-specific marker | Keep the reason and eligible action available. Repeated polling does not repeat the cue. |

Use existing models and materials for the first proof. The arrival uses the existing shuttle as a pad landmark; a new cinematic flight/landing sequence is outside this plan. World view shows base-scale cues and exterior arrivals; HQ shows room journeys; Watch shows the exact selected active run's work response. Historical Watch remains parked. Do not force camera changes or open overlays automatically.

## Delivery order

### Slice 1 — persisted facts and timely Watch activity

**Result:** a deterministic provider run produces visible activity before it finishes, and every world trigger has an explicit persisted basis.

1. Trace the current task creation, stage advance, repair start and delivery mutations. Record the exact authoritative predicate for each in the acceptance record before changing it. Reuse existing state and lineage; add no workflow state to satisfy animation.
2. Extend `src/domain/workspace-history.ts`, `server/workspace-history-projection.mjs` and `server/workspace-history.mjs` with explicit facts or typed transition fields for creation, stage change (`fromStage`/`toStage`), repair start, completion and attention change. Record facts in the same store transaction as the task change. Keep artifact/run/package/candidate identity where relevant, and distinguish event occurrence time from persistence observation time.
3. Preserve existing history and briefing compatibility. Do not backfill old tasks into new arrival events. Where a mutation emits both a general task-state observation and a specific transition, prevent duplicate briefing copy and duplicate visual triggers. Legacy facts without transition context remain readable and do not invent journeys.
4. Add a bounded activity buffer at the existing execution callback. Assign a stable identity using the exact run ID and a monotonic per-run ordinal before enqueueing. Prefer provider event identity for deduplication when present; identical event text alone is not a duplicate key. Serialize writes through the existing store update queue, applying deltas to the latest draft rather than a captured task snapshot.
5. Start with a 250 ms flush interval and a 25-event batch threshold. Set explicit pending count/byte and event field limits based on the existing activity contract. Keep one flush in flight per run; retain unacknowledged events for bounded retry. On saturation or failed persistence, emit an observable activity-coverage error rather than silently discarding evidence or claiming complete telemetry.
6. Reconcile terminal retention with incremental records by identity. Drain accepted events before recording terminal completion; ensure cancellation, timeout and exceptions take the same cleanup path. Reject callbacks after closure. A final storage failure must remain an explicit persistence failure, never a falsely successful final flush.
7. Abrupt process death may lose the unflushed in-memory tail. Retain already committed activity and use existing interrupted-run recovery; expose the coverage limitation. Do not claim crash-proof delivery or add a durable queue without a separate demonstrated requirement.
8. Publish only the existing permitted, normalized operational fields with bounded detail and existing redaction. Exclude private reasoning, raw provider streams, credentials and unlimited command output. Preserve policy checks that consume runtime activity. Token/cost totals remain provider-reported.

**Primary files:** `server/orchestrator-repair-execution.mjs`, `server/orchestrator-retention.mjs`, `server/run-activity.mjs`, `server/sqlite-store.mjs`, workspace-history modules and affected domain/API types. Audit all callers of the common execution path so parallel packages and repairs receive the same behavior.

**Exit checks:** events appear while a fixture run remains active; final retention contains one copy; concurrent packages keep distinct identities; late events cannot alter a newer run/candidate; failed writes retry without losing accepted events within the bounded buffer; retention is bounded. Measure callback-to-commit separately from commit-to-Watch. The foreground connected fixture target is commit-to-Watch within the next successful refresh cycle, at most three seconds.

### Slice 2 — one bounded consumer with no historical replay

**Result:** the UI receives eligible new facts once, through existing HTTP polling, and can demonstrate its behavior without 3D effects.

1. Extend `src/frontier/runtime/coordinator.ts` and snapshot/contracts to consume a bounded new-history window using the existing workspace head. Use source ID plus sequence as the event identity. Keep the history cursor separate from the return briefing's user-driven pagination cursor.
2. Coordinate the new reads with `readHistory`, which currently permits only one queued history request. Give selected task/Watch refresh priority; never starve it while draining history. Allow at most one automatic history page per refresh cycle, with a captured upper bound and generation checks for stale responses.
3. Baseline at the latest head on initial load, reconnect, source change and visibility resume. Clear pending effects when disconnected or hidden. A retention gap or oversized backlog shows current state and coverage information, then rebases; it does not play catch-up animations.
4. Validate event identity against the latest task/run/package/candidate before presenting it. Reject duplicate, obsolete and out-of-order effects. Coalesce a burst for one task to the latest supported state; do not invent a path through missed stages. Historical activity pagination and switching to an old run never produce live effects.
5. Keep low-volume workspace transition facts separate from high-volume operational activity. Local tool responses use the selected active run's refreshed activity; do not hydrate every task history or append every tool call to workspace history.
6. Proposed initial visual limits: one active effect per task, four moving actors globally, eight pending effects, and a five-second freshness window. Coalesce or discard stale decoration while retaining all current state, attention and evidence access. Deterministic tests use an injected clock.

**Primary files:** `src/frontier/runtime/coordinator.ts`, `contracts.ts`, `pages.ts`, fixture gateway/history, and the narrow app adapter supplying transient effects to the scene. Add one explicit effect-selection module if needed; keep it independent of Three.js so event behavior is testable.

**Exit checks:** cold load, reconnect, hidden-tab return, source switch, duplicate/out-of-order facts, history pagination, coverage gaps and bursts produce no replay. Watch freshness remains within the target while the briefing is open. Request counts remain bounded and unrelated task detail is not fetched.

### Slice 3 — robot journeys, action responses and integrated acceptance

**Result:** every trigger in the behavior table is demonstrable in the actual 3D app, with correct interaction and fallbacks.

1. Prove one stage journey inside one HQ first. Build waypoint routes from the current room/door/hub anchors and obstacle layout. Use the existing walk clip with distance-based timing, facing and blending. Walk around equipment and through doors; do not interpolate straight through walls.
2. Layer the transient visual position over immediate authoritative task placement. Keep one pickable representation per task/package and retain selection during movement. Current labels, reasons and commands remain available throughout. A newer state, connection loss, hidden view or invalid identity cancels the effect and settles to the current placement.
3. Add same-room stage emphasis and repair journeys. Waiting, blocked, failed, disconnected and historical workers stay parked; use static feedback for a stage event whose resulting state is parked. An actively started repair can move only when its current recorded state permits it.
4. Build exterior arrival routes from the hub pad through connected bridges/spurs to the project's courtyard, bay, hub and room. Use current colony placement transforms and actual bridge connectivity for outer-ring projects. Where a complete route cannot be established, show a labelled destination cue; never cross unrelated bases. Keep long routes brief through a sensible capped visible segment and clear arrival cue, rather than extreme walking speed.
5. Add artifact, attention and completion effects using existing art. Preserve a short-lived completion cue even when the completed task leaves the normal open-task worker set; retain a task/evidence link without making it an active worker.
6. Add bounded tool responses for the exact selected active run. Explicitly map supported normalized activity categories/phases to the existing clips. Suppress obsolete responses after run completion; retain readable recorded activity. Package workers must never borrow a sibling's response.
7. Respect motion-off and reduced motion with static emphasis and text. Preserve audio preferences and day/night behavior; no new sound assets are required. Scene remount, camera navigation and historical Watch must not replay events already consumed.
8. Run the integrated matrix below and leave an isolated fixture preview open for visual review. Capture short screen recordings for movement/timing as well as matched screenshots for layout and static states.

**Primary files:** `src/frontier/world-3d/ProofScene.tsx`, `ProofWorker.tsx`, `colony-workers.ts`, `rooms.ts`, `colony.ts`, `model.ts`, the app scene adapter and existing motion preferences. Keep workflow eligibility and permanent worker behavior in their current owners.

**Exit checks:** all seven trigger rows work at their appropriate view scale; arrivals and room routes respect geometry; workers do not multiply or lose selection; static fallbacks remain useful; functional and visual acceptance both pass.

## Acceptance and verification

| Area | Required evidence |
| --- | --- |
| Persistence and identity | Creation versus import; stage from/to; real repair start; exact artifact revision; true task delivery; duplicate/final flush; cancellation/timeout/interruption; concurrent packages; storage failure/retry/saturation; bounded retention. |
| Refresh and timing | Measured callback-to-commit and commit-to-Watch; no overlapping refresh ownership; no replay on load/reconnect/visibility/source changes; gaps, stale responses, pagination and busy briefing. |
| Workflow truth | Waiting task with a finished agent; required versus started repair; package integrated versus task completed; sibling package running; changed candidate; historical Watch; ambient crew excluded from execution counts. |
| Visual and interaction | World/HQ/Watch at 1280 × 720 and 1440 × 900 plus the retained colony desktop reference; one-project journey and 10-project fixture including outer-ring arrival; crowded HQ/parallel packages; selection and actions during motion; camera navigation; disconnect and motion preferences. |
| Goal 4/5 regression | Usable overlays/scrolling, preserved drafts/focus, Next/Previous decisions, return briefing and source-scoped watch pins. |
| Load | Bounded queue/read assertions and observed responsiveness of World/HQ/Watch against the current 3D baseline. Investigate visible stalls; retain before/after evidence if one occurs. |

The old usability document contains numeric 2D asset/FPS budgets and extreme-zoom work that conflict with later steering and the current 3D foundation. Follow the later Goal 6 benchmark/zoom waiver and the subsequent requirement to fix observed 3D regressions. Do not treat the old 20 MiB cold-load budget as a new acceptance gate. Preserve bounded refresh and do not add assets without a measured need.

Use a deterministic provider and a temporary isolated database/repository. `node scripts/frontier/qa-server.mjs` defaults to the fixture provider; do not use `--codex` or the `dev:frontier-api-smoke` script for this qualification. Choose unused ports after inspecting existing listeners, start only this task's services, and record their PIDs and origins. Do not touch operator-run services or live task data.

Start with affected history, store, activity, runtime/coordinator and colony tests, including the existing `tests/frontier/api/workspace-history.test.mjs`, `tests/frontier/agent-activity.test.mjs`, `tests/runtime-activity-routing.test.mjs` and `tests/frontier/colony-runtime.test.mjs`. Discover the exact related tests at implementation time. Then run these existing scripts with the repository-supported Node runtime:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run build:frontier
npm test
npm run test:frontier
npm run test:frontier-api
npm run test:sites
```

These are future implementation gates, not checks claimed by this planning document. Test storage failures and refresh behavior deterministically; verify actual animation and controls in the browser. Local fixture qualification does not establish a real implementation-to-PR workflow run, native screen-reader acceptance or production activation.

## Delivery and continuation

Implement in an isolated `codex/mission-frontier-goal-6` checkout based on the then-current main, bringing this plan with it. Recheck instructions, HEAD, worktree cleanliness and source changes before editing. Use three reviewable commits/slices in the order above; each slice must meet its exit checks before the next. No asset agent is needed for this plan.

Maintain `design/mission-frontier/build-evidence/USABILITY/goal-6/HANDOFF.md` with exact HEAD, completed acceptance rows, commands/results, failures, screenshots/recordings, fixture setup, service ownership, and the next concrete step. Update `build-evidence/USABILITY/progress.md` and the project journal from verified results at the completed milestone, following `journal-site/AGENTS.md` if present at execution time. Retain historical evidence unchanged.

Complete at a running visual-review checkpoint with the acceptance matrix and any honest evidence limits. PR publication, merge, game deployment, paid model runs and research feature expansion are separate from this planning request.

### Copyable start instruction

```text
Start Goal 6 using design/mission-frontier/GOAL-6-PLAN.md. Recheck current main
and applicable AGENTS.md instructions, create an isolated codex/mission-frontier-goal-6
checkout, and implement the three slices in order: persisted facts and incremental
Watch activity, bounded event consumption without replay, then 3D robot feedback.
Use the current colony-v2 geometry and existing robot clips. Preserve workflow,
candidate, package, research and historical-run semantics. Qualify with deterministic
provider/API fixtures and actual browser checks; do not start live paid tasks or
restart user services. Maintain the acceptance record and continuation handoff.
Finish with the isolated preview open for visual review and report checks and limits.
```
