# Mission Frontier first-playable design QA

Status: **passed for M0–M3** on6 September2026. No unresolved P0/P1/P2 visual or interaction defect was observed in the accepted first-playable paths. User approval of the game feel is still pending.

Compared the selected world and v1.1 headquarters/needs-answer/repair images with the actual app together in `build-evidence/M3/*-comparison.png`. World and both agent states use1568×1003; HQ uses1567×1004. Additional checks cover1488×1058,1280×720,849×779 and the390×844 list/overlay fallback. Final screenshots omit QA controls.

## Findings resolved

- Raised the initial world composition to keep base labels out of the top navigation at compact size, while keeping selected-worker actions accessible.
- Replaced calibration scenery in overview/HQ with reusable island, shore, water, bridge, road and vegetation objects. Inspected actual joins at maximum zoom; roads read as continuous physical infrastructure, without invented handoff motion.
- Registered floor/back/front/roof layers around their measured anchor. Headquarters grows through adjoining task sites; no fixed four-room cap. Screens, props and workers remain independently pickable.
- Added communications and inspection stations matching the fabrication kit. Worker SE/SW facings, portrait and detail retain a coherent character and daylight/material treatment. No visible matte halos were observed.
- Placed retained cargo/capsules inside the usable floor area. Clicking the PC-153 capsule opened exactly PC-153-research/scouts.md, not a generic evidence destination.
- Removed room-label overlap at wider HQ zooms by hiding the extra reason line there. Selection exposes the complete persisted reason and action in the HUD. Selected blue remains separate from amber/coral state.
- Fixed an exposed rectangular detail background at minimum zoom. Camera pan/zoom now keeps the authored backdrop covering the viewport; the actual minimum-zoom capture and coverage test pass.
- Fixed shared fixture question objects. Answering one task no longer modifies another task's Grill session.
- Mixed package state stays explicit: failed S2 is inspectable as a parked failed run while S1 remains active. Finished Grill/review workers retain frozen recorded duration and no work motion.
- Keyboard J, Tab, Enter and Escape can reach a selected task from the journal. Replacement overlays focus their own header, close returns to the originating world control, and task/Grill drafts survive evidence navigation and disconnection.
- The compact and phone overlay bodies scroll locally, with required decision actions accessible. No new phone-specific world design was added.
- Corrected the intermediate desktop breakpoint: the selected-task panel has enough room for its title and actions, and the compact minimap uses two rows of controls. At849×779 all three bases and four camera controls remain visible (`build-evidence/M2/world-849.jpg`).

## First-playable scope and P3 notes

- The A1 kit deliberately uses one reusable standard building family. Its modular islands and repeated architecture are simpler and more repetitive than the cinematic concept. The ceramic/slate character, purple vegetation, isometric world and world/HUD balance are retained; A2 architecture/work-prop variety and later destination art remain Goal2 work. This is not a claim of pixel-identical reproduction.
- The standard roof has a deeper fascia and the worker is slightly slimmer than the concept. Both were accepted at the M1 calibration gate.
- At maximum zoom the water's broad ripple pattern repeats, and mirrored SW bridge undersides reverse a small lighting detail. No hard alpha gap occurs at the inspected joins. Two unused junction arms remain short physical road stubs; they do not indicate task progress.
- Native Back-to-panel focuses the replacement header rather than the exact previously focused row. All controls remain keyboard reachable.
- A broad final native-browser check of real OS backgrounding/reduced-motion switching remains useful at M7; the current IAB could not expose hidden-page state. Browser motion-off and the isolated visibility lifecycle test both pass.
- Vite reports an approximately805kB main chunk warning. The measured loading/texture/frame budgets pass; no warning threshold was raised.

The richer role-policy management, project administration, full candidate/review/test/delivery operations and secondary agent/skill/settings pages are M4–M7 scope, not first-playable placeholders disguised as working controls. Review game feel, scale/readability, and the world-to-work transition before starting Goal2.
