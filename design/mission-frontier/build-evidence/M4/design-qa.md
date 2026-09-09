# M4 visual qualification — iteration 1

Source: `design/mission-frontier/screens/{projects,project-setup,new-task,task-policies,tasks}.png`.
Implementation: IAB tab 9, `http://127.0.0.1:5199/?mode=fixture`; CSS/pixels 1568×1003 at 1×. Combined comparison JPGs in this directory pair equal-sized sources and captures. Project setup is the validation/review state, so compare structure/readability rather than claiming pixel parity with the source's initial form.

- [P2, fixed pending recapture] Project card preview used only the floor. Replaced with a registered composite of the accepted floor/back/roof/front assets. First Projects capture predates that correction.
- [P2] New-task header and wizard occupy separate tall rows. Combined with form spacing, the reference viewport hides risk/design choices below the initial view. Compact the wizard into the header and tighten only redundant form gaps.
- [P2] Agent setup retains the previous body's scroll offset on step transition. The first rows/title can be clipped. Reset local scroll on step change, keep table rows compact enough to scan the ten policies.
- [P2] Journal's fixed table height can push selected-task usage below the overlay. Give its table the remaining height and preserve a fully visible compact selection panel. Add truthful current agent-count context.
- [P2] Fixture tasks with retained runs but no task-level start timestamp say "Not started" in Elapsed. Distinguish missing timestamps from genuinely queued tasks.

Typeface/colours/icon family follow the accepted first playable; body/control text is readable, semantic states use restrained blue/amber/coral. Native forms and focused actions were exercised. Art remains separate runtime objects; station and architecture integration is not final A2 acceptance yet.

Interactions already exercised: add/validate/propose/approve sample project setup, rename with same identity, reject archive with unresolved task reason, full brief/profile/design/policy/review/create, future-role confirmation, frozen reached role, close with retained note, closed journal filter, inspect/back preserving journal state. No live model was dispatched.

Iteration 3: compared source and corrected implementation together in comparison-new-task-v3.jpg / comparison-tasks-v3.jpg; Projects v2 and policy v2 comparisons retained. Header/first-row clipping and journal selection overflow are resolved at the reference viewport. Repository/fixture-specific content differences are deliberate and labelled; unavailable times are no longer invented. No unresolved P0/P1/P2 remains in these desktop M4 screens. Full-app and smaller-viewport requalification remains M7.

final result: passed (M4 desktop scope)
