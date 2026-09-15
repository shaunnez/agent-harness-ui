# HUD acceptance — 15 September 2026

Computer-use inspection used the actual in-app browser at 1488×1058 desktop and 1280×720 laptop, with normal browser zoom. Existing Fit world was used to frame captures after resizing; camera behavior and scene source were not changed. Day/time can differ between captures because the existing local cycle kept running. Before captures use the fidelity renderer on 5206; after captures use HUD on 5207. All retained screenshots were visually inspected or captured after the corrected local font installation; provisional captures were removed.

| Coverage | Outcome / evidence |
| --- | --- |
| World, no selection, desktop/laptop | Selection dock absent; Manage replaces briefing/Watch controls. `before-world-*`, `after-world-no-selection-*`. |
| HQ, running selection, desktop/laptop | Small portrait, recorded Luna/XHigh + 144K task tokens, Watch agent primary and Inspect. `before-hq-*`, `after-hq-running-*`. |
| World/HQ, blocked selection | Short repair/blocked state; parked finished run remains distinct; Recorded details opens reason/actor/wait, full task inspection retained. `after-world-blocked-1280`, `after-hq-blocked-*`, `after-hq-blocked-details-1488`. |
| Unknown connection | QA disconnect retained last-known data and reconnect control. Selection now says Last known plus the recorded state. Connected-state semantics remain unchanged. |
| Multiple decisions | World has eight, HQ two. Expanded list retains all eight with local scroll. `after-world-all-decisions-*`. Next/Previous in the decision overlay retained the unsent draft “Keep this draft while navigating.” after returning to the task; no approval submitted. |
| Zero decisions, multiple pins | Separate deterministic API fixture with completed tasks; task + exact completed-run pins present in World/HQ at both sizes. `persistent-*-zero-decisions-pins-*`. |
| Pin persistence | Task and exact-run pins survived reload of a stable API source. Historical completed run remained historical. `persistent-task-pin-reloaded-1280`. In-memory sample sources intentionally get a new identity on reload, so persistence was verified on the isolated API instead. |
| Zero pins | Unpinned both retained pins; Pinned disappears without an empty state, in World/HQ. `persistent-*-zero-decisions-zero-pins-1280`. |
| Briefing | Manage → While you were away opened retained history, recorded run usage and history limits. Mark reviewed saved the isolated checkpoint. `persistent-briefing-1280`. |
| Long names | Created a sample task with a long name and inspected the corresponding long-title API task. Floating/dock identity stays compact; full name accessible in the inspector. No real task created. |
| Artifacts | Optional Artifacts links appeared only for existing evidence; dev-review.md opened in the existing wide viewer with source toggle. `after-artifact-viewer-1280`. |
| Keyboard | Manage opens via Enter and closes via Escape. Escape closes inspection/decision overlay first, then dismisses selected dock; explicit Clear selection also works. Existing navigation shortcuts and policy controls remain. |
| Local scroll/readability | Decision/pin lists and optional selection details have bounded local scroll; control/body type is 14–16px, metadata 12px. Normal laptop space is retained. |

The QA fixture includes stopped/interrupted and completed run evidence, not a live model workflow. No real approval, model call, remote delivery, benchmark or extreme zoom was used.
