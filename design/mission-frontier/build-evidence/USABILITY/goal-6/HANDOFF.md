# Goal 6 — implementation and visual review checkpoint

25 September 2026. Implemented and locally qualified; awaiting Shaun's visual review.

## Checkout and delivery state

- Worktree: `/Users/shaun/.codex/worktrees/mission-frontier-goal-6/agent-harness-ui`
- Branch: `codex/mission-frontier-goal-6`
- Base: `01a329694228955f2db561af3a6764c498bdcaa2` (fetched main at start).
- Tested implementation HEAD: `c70db4e41fde94808ba6c81e91327a65e47af7e8`. The subsequent evidence commit changes documentation and captures only.
- Three implementation commits: `858be37a` persistence and facts; `92427943` consumption and notices; `c70db4e4` robot journeys and acceptance tests.
- Commits are local and unsigned. The normal SSH signing attempt waited on 1Password; that owned signing process was stopped and `git -c commit.gpgsign=false commit` used. No persistent Git setting changed. Sign/amend if required before future publication.
- The original `6c8d` checkout and its uncommitted planning work were preserved. No PR, push, merge, production activation or real model run was performed.

## What changed

The existing execution callback now persists bounded, normalized activity while its exact run remains active. SQLite owns serialized delta writes. Per-run IDs and a sequence watermark prevent duplicate terminal retention, including after old records are pruned. Pending activity is bounded to 500 records plus one overflow marker, fields have explicit limits, only one batch is in flight, and failed writes retain accepted events for retry. Saturation aborts the owning run with an explicit coverage error. Closure drains before completion and rejects late callbacks. Private/raw provider fields are excluded, existing credential redaction is retained, and the meaningful first command failure survives the bounded runtime window for policy evaluation.

The refresh coordinator consumes at most one 100-row history page per cycle after selected-task/Watch reads. It baselines on first load, reconnect, hidden-tab resume, source replacement and retention gaps. Eight transient effects and four moving actors are the caps, with one moving actor per project. Facts older than five seconds are not animated; effects expire after fourteen seconds. Rapid changes coalesce to the supported current state. No workflow eligibility or token accounting is inferred from animation.

World shows exterior arrivals and base signals; project cutaways show room/repair journeys through the authored doors and around the central table and furniture. Existing robot clips supply walk, scan, typing and work actions. Watch briefly responds to normalized tool categories for its exact active run/package. Notices name their project/task, dismiss, and open the task or exact artifact. They sit above a selected-task dock using its existing measured height.

Arrival routes use real bridge connectivity and the terrain ring-road centreline, showing at most the final 42 metres. Idle arrivals finish at the courtyard patrol entry, including crowded bases whose allocated fallback socket is behind the HQ. The idle loop resumes from the arrival endpoint without a jump. This is a short incoming approach, not a new hub flight sequence. If motion, connection, recorded state or safe geometry disallows travel, current placement and static text remain available.

One prop moved: the intake desk now sits inside Briefing at `[-4.8, 4.3, 10.8]`; its old position obstructed the real courtyard doorway. Door collision checks use the prop's orientation rather than an oversized axis-aligned box.

## Authoritative event predicates

| Trigger | Persisted basis and safeguard |
| --- | --- |
| Arrival | New task in `materialCoreChanges(null, task)`; historical rows are not backfilled and cold loads baseline. Creation never starts work. |
| Room change | Actual `currentStage` change; fact carries previous stage/status. Same physical room uses emphasis only. A resulting waiting/blocked state parks. |
| Repair | `activeRunKind === "repair"` with a new reservation or actual stage change; current candidate/revision, reservation, stage and status must still match. Repair-required alone does not walk. |
| Artifact | Persisted artifact insertion, exact artifact/run/package/candidate identity. Obsolete candidate revisions suppress the transient cue; retained evidence remains accessible normally. |
| Completion | Task status newly becomes `completed`. Completed runs, integrated packages, approval and intermediate PR states do not create task-completion feedback. |
| Attention | Recorded attention kind changes to answer, approval, failure, repair or blocked. Persistent reasons and controls keep their existing owners. |
| Tool response | Newly committed normalized activity for the selected active run, at most three seconds old; supported read/edit/command categories map to existing clips. |

## Verification receipts

Commands and log hashes are retained in [checks.json](checks.json). Full local logs remain under `/tmp/goal6-final-*.log`.

| Check | Result |
| --- | --- |
| `npm test` | 858 passed |
| `npm run test:frontier` | 180 passed |
| `npm run test:frontier-api` | 23 passed with process-scoped fixture signing override below |
| `npm run test:sites` | 4 passed after root build |
| `npm run typecheck` | Passed, including final implementation |
| `npm run lint` | Passed; two unchanged research warnings and one unchanged Linear-test informational diagnostic |
| `npm run format:check` | Passed |
| `npm run build` / `npm run build:frontier` | Both passed; existing chunk-size warnings remain |
| Affected projection/contract/activity/feedback checks after identity refinement | 20 passed; subsequent full Frontier run includes the added crowded-arrival test |
| `git diff --check` | Passed |

API tests initially encountered inherited 1Password signing failures when committing disposable fixture repositories. The passing run used `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npm run test:frontier-api`; no global config changed. This is distinct from the later local feature-commit signing wait.

Measured fixture callback-to-observed SQLite activity: **264 ms**, while the run remained active. Recorded activity-to-foreground Watch snapshot without manual refresh: **2015 ms** in the final Frontier run. These are two separate deterministic measurements, not an end-to-end real-provider latency claim.

New checks cover concurrent run/package identity, redaction, terminal deduplication, retry after storage failure, bounded saturation, late/interrupted callbacks, repair reservation replacement, obsolete artifacts, initial/source/reconnect/gap baselines, foreground Watch timing, all twenty directed routes among the five working rooms, same-room and historical/motion gates, outer bridge connectivity and crowded arrival geometry. Existing suites cover workflow controls, candidate safeguards, drafts, decisions, briefing and pins.

## Browser acceptance

Actual app inspected with the in-app browser at 1280×720, 1440×900 and retained 1568×1003 desktop size. Screenshots are captured from the running app; GIFs are assembled from timestamped captures, with reduced resolution/frame count for repository size.

| Scenario | Evidence / observation |
| --- | --- |
| Implement → Dev review | [Motion capture](project-journey.gif), [start](project-journey-start.png), [hub](project-journey-hub.png), [review](project-journey-review.png). Robot passes the hub table and enters Review; waiting workers remain parked. |
| Started repair | [Project repair at 1440](project-repair-1440.png). Review → Implement with amber notice and immediate truthful task label. |
| Blocked task | [Project blocked](project-blocked-1440.png). Parked worker, recorded reason, notice and persistent decision entry. |
| Motion off | [Static Test change](project-motion-off.png). Immediate destination, readable notice, no journey. Motion was restored afterward. |
| Artifact | [World artifact notice](world-artifact-notice.png). Click opened the exact `ARR-13` artifact UUID and its recorded sample Markdown. |
| Outer-island arrival | [Ten-project world](world-outer-arrival-1440.png), [motion capture](outer-arrival.gif), [start](outer-arrival-start.png), [end](outer-arrival-end.png). Connected final approach and courtyard idle handoff; no cross-building overflow route. |
| Completion | [1568 desktop](world-completed-1568.png). Task completed cue and retained task link; no executing-state claim. |
| Watch activity | [Active run at 1440](watch-tool-1440.png). Fresh `read_file` event and current-tool text for the selected Test run. |
| Disconnect/reconnect | During a fresh room change, disconnection removed notices and all worker labels became Connection unknown. Reconnect restored authoritative state with an empty World updates region; no replay. |
| API-backed creation and investigation | [Creation](api-created-1280.png), [structured receipt](api-smoke.json). Created `AH-001` through the actual UI/API, observed its arrival notice, dispatched the deterministic provider, then reached `awaiting-grill`. Four completed runs retained exactly one fixture activity each. No model provider was called. |

The early [world-arrival.png](world-arrival.png) retains the discovered notice/dock overlap as negative evidence; it is superseded by `world-artifact-notice.png` and the later captures. The first API mutation was rejected because port 5267 was not in the default origin set. The owned API was restarted with that exact loopback origin allowed, using the same marked temporary root, and creation then succeeded.

No new browser console errors occurred during the fixture journey checks. Existing Three.js Clock deprecation warnings remain. No obvious interaction stall was observed in the ten-project check; this is not a new FPS benchmark. The viewport override was reset after testing.

## Running preview and ownership

- Review URL: `http://127.0.0.1:5267/?mode=fixture&qa=1#project/plancheck`
- API-backed URL: `http://127.0.0.1:5267/?qa=1#world`
- Vite PID **89228**, port **5267**, proxy target `http://127.0.0.1:4366`.
- Deterministic API PID **31157**, port **4366**. Provider is `fixture`, never `--codex`.
- Retained temporary root: `/var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-fixture-9fYW6q`; ownership marker `frontier-isolated.json`; database `data/tasks.sqlite3`; disposable repository `repository`.
- Earlier owned preview PID 44637 on 5266 was stopped. No operator service was stopped or restarted.

Commands used (already running; recheck PID ownership before any restart):

```sh
FRONTIER_QA_PORT=4366 \
AGENT_HARNESS_ALLOWED_ORIGINS=http://127.0.0.1:5267 \
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false \
node scripts/frontier/qa-server.mjs --root /var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-fixture-9fYW6q

AGENT_HARNESS_API=http://127.0.0.1:4366 \
npm run dev:frontier -- --host 127.0.0.1 --port 5267 --strictPort
```

Open **Build diagnostics** in the sample preview, select `PC-142`, choose a destination stage and press **Move to …**. **Sample repair**, **Sample artifact**, **Sample arrival**, blocked/completed and connection controls exercise the other states. These controls exist only in explicit fixture QA mode. Reload resets tab-only samples; the isolated API task remains in its separate temporary database.

## Limits and next step

Abrupt process death can lose the unflushed in-memory activity tail; already committed activity remains and existing interrupted-run recovery applies. This is not a durable event broker. Extended storage failure is explicit and cannot report a successful final flush. Safe-route failures and parked states use static feedback. Robot paths avoid authored static geometry; they do not implement dynamic robot-to-robot collision simulation.

Live Claude/Codex sessions, complete implementation-to-PR delivery, production deployment and native screen-reader/OS-level reduced-motion acceptance were not exercised. The app motion switch was browser-verified; system reduced-motion retains the existing shared preference gate. Research-specific events remain separate. Goal 4/5 suites passed; this pass did not repeat every historical browser permutation from those goals.

`journal-site/` is absent from this main checkout. Updated the local usability progress and build-goal records; no external journal publication is claimed.

Next: Shaun's visual review of the running preview. Continue only with concrete feedback or a subsequent delivery instruction. Preserve the implementation commits, evidence and temporary API records; no pending implementation fix is known at this checkpoint.

## PR preparation — 25 September 2026

Shaun subsequently requested PR publication. Integrated `origin/main` at `4dad6e41f05fee883628ddc2157a155f8430b903`; the only conflict was adjacent additions to `AGENTS.md`, resolved by retaining both the Goal 6 and Azure planning instructions. The incoming application change opens Run Activity by default. Typecheck and the combined runtime-activity-routing/world-feedback tests passed (12 tests) after integration. Earlier full-suite and browser receipts above remain the implementation qualification; this integration used targeted regression checks. This publication instruction does not authorize merging or deploying the PR.
