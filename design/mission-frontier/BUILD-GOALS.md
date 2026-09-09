# Mission Frontier — prompts and goals

Revision 6 · 9 September 2026. Goals 1, 2 and 3 are completed; their prompts remain for reference. The later living-world pass is recorded in [PR-HANDOFF.md](PR-HANDOFF.md). **Goal 4 U0–U2 is complete, including the native 200% zoom walkthrough and its fixes. Goals 5 and 6 have not started.** See the [Goal 4 handoff](build-evidence/USABILITY/goal-4/HANDOFF.md). [USABILITY-PLAN.md](USABILITY-PLAN.md) defines their scope, dependencies and acceptance checks; the earlier plans remain the history for completed work.

## How to use

Run the selected goal in this task or a task with the build repository and the complete `design/mission-frontier/` pack available. The known planning copy is `/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/IMPLEMENTATION-PLAN.md`; if using another checkout, copy/attach the complete pack first and revalidate the repository. Keep local compute/network/browser tools available. Goal mode does not grant broader access or guarantee progress through missing credentials or offline dependencies.

Paste the natural-language prompt below to ask the agent to create the goal, or use `/goal` with the same outcome/constraints. Set a token budget only if you explicitly choose one. The app's goal controls provide pause/resume; a scheduled heartbeat or an external infinite loop is not needed for this build. See [official long-running work guidance](https://learn.chatgpt.com/docs/long-running-work).

## Goal 1 — first playable, recommended first run

```text
Create a goal to complete Mission Frontier's first playable, milestones M0–M3
in design/mission-frontier/IMPLEMENTATION-PLAN.md. Execute the work after setting
the goal. Completion means the M3 acceptance criteria have passed and a working
local preview with evidence is ready for my game-feel review. This goal does not
include M4–M7.

Read the plan, ASSET-PRODUCTION.md, DESIGN-SPEC.md, ATTENTION-CONTRACT.md,
BACKEND-COVERAGE.md, screen-catalog.json and AGENTS.md. Inspect the selected world
and the v1.1 headquarters/agent images. The selected design is the visual target;
this is an actual game-centred frontend with independently interactive objects.
Preserve its world/overlay balance and operational semantics.

Confirm the actual repository, remote, base and dirty files. Preserve my work,
the design pack, the existing frontend/backend and protected Sites files. Follow
the plan's independent src/frontier entry/build. Revalidate live contracts before
reusing them, including polling, action eligibility, origin/CSRF and role policies.

You may delegate asset production to one GPT-6 Astra subagent while implementing
the app. Give it the ASSET-PRODUCTION assignment with one concrete asset ID at a
time and a disjoint staging directory. You own renderer/code/dependencies/browser
and integration. Use built-in ImageGen for creative assets. You and the asset
agent may use deterministic image tools for crop, masking/alpha cleanup,
registration, resizing, contact sheets and atlas packing. Never replace missing
game art with generic CSS/HTML drawings or a flattened mockup with hotspots.

First prove compatible overview, cutaway headquarters and agent detail in M1.
Do not mass-produce the full asset kit before the integrated fidelity gate passes.
Implement the running/needs-answer/repair/dependency states with actual task/run
identity, reason, next actor and eligible action. A finished run can coexist with
a waiting task. Motion must follow persisted state; fixture mode is visibly
labelled and cannot mutate the live backend. Keep placement, persistent names,
upgrades and unlocks in v2.

Work in checkpoints and keep build-evidence/progress.md current. For each coherent
change, run relevant automated tests, start the assigned local frontend and API,
use computer use to exercise real interactions, capture the matching viewport
and state, compare with the selected reference, fix concrete defects and repeat
the affected checks. Test canvas picking, pan/zoom, minimap and occlusion as well
as DOM panels. Do not substitute a green build or screenshot existence for QA.

Use separate disposable repositories, stores and ports for QA. You may create
fixture tasks and submit their predetermined test answers/approvals there. Run
one bounded real Codex CLI investigate-only smoke task through the M3 journey,
using the existing ChatGPT authentication; no OpenAI API key. Do not mutate my
unrelated live tasks, restart my runtime, or create many paid runs for testing.
Keep deterministic API fixtures distinct from actual model-run evidence.

Continue autonomously through routine implementation, debugging and asset fixes.
Ask only for a material unresolved product/visual tradeoff, required missing
access, or a change beyond the approved scope. Report genuine blockers with
evidence and preserve completed work; never claim an unverified check passed.

Finish this goal only when M0–M3 gates pass: real local journey evidence, correct
attention states, visual/interaction QA with no unresolved P0/P1/P2 findings,
appropriate tests, both application builds and measured baseline. Leave the
preview running/open, report acceptance coverage and any P3 notes, and stop for
my first-playable review. Do not push, open/merge a real PR, deploy, or claim full
v1 completion. A later goal will cover M4–M7.
```

## Goal 2 — finish v1 after reviewing the first playable

Use this after the first-playable review; include any changed decisions above the prompt. Starting it should be an explicit user action.

```text
I have reviewed the Mission Frontier first playable. Incorporate the review
feedback recorded in this conversation and the design pack, then create a goal
to complete milestones M4–M7 of design/mission-frontier/IMPLEMENTATION-PLAN.md.
Execute the goal. Completion means the entire accepted v1 screen/state matrix
and its final qualification gates pass in a working local application.

Re-read the plan, ASSET-PRODUCTION.md, DESIGN-SPEC.md, ATTENTION-CONTRACT.md,
BACKEND-COVERAGE.md, AGENTS.md and build-evidence/progress.md. Inspect current
code, accepted assets, tests and repository/runtime ownership. Retain the first
playable; do not restart from scratch. Correct any regression or review feedback
before extending it. If M3 evidence is missing or contradicts current behaviour,
close that gap before marking later milestones passed.

Implement all 25 destinations and their required states, including projects,
task creation and per-role policies, research/Grill/design/spec/plan, dynamic
packages, exact candidate review/test/repair, final approval/PR delivery, agents,
skills, settings, usage, evidence and reconnect. Complete only the bounded B0–B3
backend additions in the plan, preserving existing clients and persisted records.
Keep independent scout-child policies, skill-source editing, placement, persistent
names, upgrades and unlocks outside v1. Never hide an unimplemented requirement
behind an enabled control or pretend unsupported settings were saved.

You may reuse one GPT-6 Astra asset subagent for individual A2 asset assignments
under ASSET-PRODUCTION.md. Keep its output ownership separate. Use built-in
ImageGen for creative art; deterministic crop, masking/alpha cleanup, registration,
resize, contact sheets and atlas packing are authorized. Accept assets only after
rendering them at actual scale in the app. You own all integration and browser use.

Follow build → focused tests → run → computer-use interaction → matched visual
comparison → fix. Update milestone/screen evidence as work completes. Verify
loading/empty/partial/error states, keyboard and reduced motion, busy worlds,
delayed/repeated events, reconnection, candidate staleness and denied actions.
Use deterministic isolated API/provider/GitHub fixtures for exhaustive workflow
and publication scenarios; do not publish real PRs for UI testing. Preserve
explicit operator confirmation for actual product approvals and mutations.

Keep the live backend authoritative. Finished runs do not perform work motion;
dependencies are distinct from needs-you; repairs invalidate the affected gates;
completion follows exact persisted delivery state. Costs remain identified
API-rate estimates from recorded tokens and supported rates.

Work autonomously within this scope, using checkpoints and the saved progress
file to continue across turns. Fix observed issues rather than adding speculative
features. Ask only for a material unresolved product/asset tradeoff, unavailable
required access or an expansion of scope. Do not relax failed acceptance criteria
or call the goal done because effort, time or budget is nearly exhausted.

Complete only when M4–M7 and all screen/state acceptance rows have real evidence,
relevant automated checks and both builds pass, protected Sites packaging/tests
remain intact, no P0/P1/P2 functionality or visual issue remains, and performance,
accessibility, asset provenance and rollback notes are recorded. Leave the local
preview running/open and give a concise evidence-based handoff. Report P3 polish
separately. Do not push, open/merge a real PR, deploy or replace my running app
unless I separately request that publication step.
```

## Goal 3 — cinematic visual fidelity, one island first

**Completed and ready for Shaun’s review.** The approved candidates are Quaternius Modular Sci-Fi MegaKit and Stylized Nature MegaKit. The complete scope, Blender workflow, Astra assignment, visual checks and handoff requirements are in [VISUAL-FIDELITY-GOAL.md](VISUAL-FIDELITY-GOAL.md); see [progress](build-evidence/VISUAL-FIDELITY/progress.md) before resuming. That brief governs Goal 3 asset production; the earlier ImageGen assignments remain historical.

```text
Run Goal 3 from design/mission-frontier/BUILD-GOALS.md. Read and execute
design/mission-frontier/VISUAL-FIDELITY-GOAL.md in full.

Create the goal and work autonomously through the overnight build, using the
approved Quaternius packs, Blender and the Astra asset agent. Deliver one
production-quality island integrated into World, Project headquarters and
Watch an agent, with matched before/after evidence, real browser interaction
checks, measured performance and an updated project journal.

Preserve the completed v1 functionality and backend contracts. Follow the
brief's ownership, spending, publication and checkpoint boundaries. Continue
through routine fixes; stop when the acceptance criteria pass or a material
blocker requires my input. Do not create a duplicate goal if this run is already
active. Leave the working preview ready for my review.
```

## Goal 4 — laptop windows and an activity-first agent view

**Started 9 September 2026; implementation built and reviewed in the browser. Native 200% zoom remains pending.** See [acceptance and limits](build-evidence/USABILITY/goal-4/acceptance.md). Complete U0–U2 only; Goals 5/6 remain separate. No new art or asset agent is required.

```text
Run Goal 4 from design/mission-frontier/BUILD-GOALS.md. Read
design/mission-frontier/USABILITY-PLAN.md, the laptop review and AGENTS.md.
Create a goal to complete U0–U2, then execute it. Do not start Goals 5 or 6.

Revalidate the actual worktree, remote and current PR/merge state. Use an
isolated checkout from the authoritative Mission Frontier source; the retained
planning baseline is fdbe171 on codex/mission-frontier-v1. Previously documented
checkout paths may no longer exist. Preserve all unrelated dirty files and
running services; do not copy the entire original workspace into the branch.

Implement generous laptop windows with bounded resize, maximise/restore,
remembered dimensions and obvious scrolling. Compact the task header and stage
layout, preserve the always-open inspector and all task/model/approval controls,
and give Watch an agent a compact identity/status/usage area above its activity.
Keep current versus historical run states and event/usage availability truthful.
Goal 4 improves presentation of recorded activity; it does not claim to fix the
backend's buffered-event boundary, which belongs to UB2 in Goal 6.

Follow the plan's measured 1280-by-720 acceptance checks, keyboard/focus and zoom
checks, representative workflow states and matched before/after comparisons.
Use an isolated fixture server and store for commands. Do not restart my live
runtime, resume existing tasks or launch paid model workflows for QA.

Work through build, focused checks, computer-use interaction, visual comparison
and fixes until U0–U2 pass. Keep build-evidence/USABILITY/progress.md and the
goal-4 acceptance evidence current. Run typing, lint, formatting and both builds.
Preserve protected Sites files, accepted art, motion and lighting preferences.

Finish with the local preview running and open, screenshots, a reviewable diff,
acceptance coverage and honest limits. Update the separate project journal as
planned/built/verified evidence warrants, preserving its existing audience.
Do not start the next goal, merge a PR or publish the game. Routine fixes within
scope do not require further approval; report material blockers with evidence.
```

## Goal 5 — decision navigation, return briefing and watch pins

**Planned, not started.** Start after the Goal 4 handoff. Complete U3–U5 and UB1.

```text
Run Goal 5 from design/mission-frontier/BUILD-GOALS.md. Read USABILITY-PLAN.md,
AGENTS.md and build-evidence/USABILITY/progress.md. Verify Goal 4's actual source
and acceptance before extending it. Create and execute a goal for U3–U5 and UB1.
Preserve existing work and use the current authoritative isolated checkout.

Extend Needs you with stable Previous/Next decision navigation and return to the
same world location. Add a dated While you were away briefing and up to four
locally remembered task/run watch pins. Preserve drafts, exact candidate-bound
actions and explicit confirmation; navigation never submits an action.

Implement the narrow UB1 retained-history read projection only as needed for
accurate cross-project catch-up. Revalidate source identity, cursor ordering and
retention contracts first. Keep stable paging, an acknowledged upper bound,
explicit incomplete coverage and correct completed-run usage accounting. Do not
invent history, infer interval spend, hydrate every task history or add a new
poller per pin. Keep legacy behavior compatible and test any required metadata
migration/export path. This does not authorize a replacement event ledger.

Use deterministic isolated fixtures to verify changing queues, stale approvals,
duplicates, late events, reconnect, source replacement, retention gaps, multiple
tabs and large workspaces. Measure request counts and payloads with zero and four
pins. Keep the laptop space and accessibility checks from Goal 4 passing.

Continue through the plan's build/check/browser/fix loop until U3–U5 and UB1 pass.
Keep goal-5 evidence and the shared progress file current; run relevant API/store
tests, typing, lint, formatting and both builds. Leave the working preview open
with a reviewable diff, acceptance evidence and an updated dated journal entry.
Preserve journal access. Do not mutate unrelated live tasks, launch paid runs,
start Goal 6, merge a PR or publish the game.
```

## Goal 6 — recorded activity and meaningful world feedback

**Planned, not started.** Start after the Goal 5 handoff. Complete UB2, U6 and the combined qualification.

```text
Run Goal 6 from design/mission-frontier/BUILD-GOALS.md. Read USABILITY-PLAN.md,
AGENTS.md, LIVING-WORLD.md and build-evidence/USABILITY/progress.md. Verify the
accepted Goal 4/5 source and evidence. Create and execute a goal to complete UB2,
U6 and the combined usability qualification in the current isolated checkout.

Persist bounded batches of permitted operational activity while its exact run
is active, using existing store coordination and HTTP refresh. Keep terminal
retention idempotent, preserve task/run/package/candidate identity, and handle
interruption and persistence failures visibly. Do not expose private reasoning,
raw provider streams or estimated live token usage.

Extend the existing world transition infrastructure with brief feedback for
recorded stage advances, artifact arrival, started repair, attention and actual
task completion. Reuse the current art first. If a concrete missing asset is
proven in the integrated scene, you may assign one bounded Astra asset task
under ASSET-PRODUCTION.md with disjoint staging ownership and measured output.
The builder owns integration and visual acceptance; no speculative asset batch.

Never animate a waiting/historical worker as executing, a required repair as
already started, an integrated package as task completion, or an initial load /
reconnect / history page as a new event. Keep motion, audio and day/night controls
authoritative. Preserve attention clarity, camera controls and immediate actions.

Use isolated provider/API fixtures for timing, duplicate/late-event, cancellation,
concurrent-package and store-failure tests. Complete real computer-use checks,
matched screenshots, request/latency and normal/stress performance measurements.
Run the final complete root, Frontier and Frontier API suite after both builds,
plus typing, lint and formatting. Do not substitute these checks for the separate
real end-to-end implementation-to-PR qualification or restart live tasks for QA.

Finish only when UB2, U6 and the combined acceptance matrix pass. Retain evidence
and any explicitly unverified native-platform checks in goal-6 and progress.md.
Leave the preview running/open, update the project journal with verified results
for its existing audience, and give a concise handoff with screenshots and issues.
Do not merge a PR, publish the game or introduce v2 progression.
```

## Steering and resumption

Send ordinary follow-up feedback while a goal is active; name the affected milestone or screen/state. For a later continuation, use:

```text
Continue the current Mission Frontier build goal. Read its status, the approved
plan, its goal-specific brief and progress file; inspect the actual worktree and
latest evidence. For Goals 4–6 use build-evidence/USABILITY/progress.md and its
goal-specific evidence folder. For Goal 3 use
build-evidence/VISUAL-FIDELITY/progress.md; the older build-evidence/progress.md
records completed Goal 2. Preserve completed
work and accepted assets. Resume the next incomplete acceptance item, including
any feedback I have supplied. Keep the same scope and
verification loop; do not create a duplicate goal or restart the implementation.
```

If no active goal exists, select the appropriate goal prompt above instead of implying that a paused/finished goal is still running. Goal controls belong to the app; the agent should not invent a cron or heartbeat to bypass a review checkpoint.
