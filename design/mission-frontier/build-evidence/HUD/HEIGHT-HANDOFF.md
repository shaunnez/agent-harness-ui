# Bottom-row alignment — 15 September 2026

From clean e3724d3 on codex/mission-frontier-hud, applied only the latest three layout requests:

- Added 8px above the day/night control, leaving the existing date/time and lighting behavior intact.
- World and HQ minimap and bottom-right controls track the selected task/base dock’s actual height through a local ResizeObserver. Default/no-selection height is 236px. All three share top and bottom edges; map aspect containment remains intact. Agent-view map sizing is preserved.
- Removed the separate ProjectHud details card from HQ. Existing Tasks navigation, scoped task access and World base-selection counts/preview remain available.

Computer-use inspection: 1280×720 World running/base selection and HQ no selection/repair selection; 1488×1058 HQ repair selection and World base selection. Measured all three bottom panels at top=449/bottom=685/height=236 on laptop and top=787/bottom=1023/height=236 on desktop. Escape clears selection. Source/implementation comparison: height-comparison.png; corrected captures: height-*.png. Existing local lighting kept cycling, so before/after scene colors differ.

Latest local checks: 84 Frontier tests, typecheck, lint, formatting and both builds passed. Existing bundle-size warning remains. Backend/API and Sites tests were not repeated for this layout-only change; the prior refinement’s 18 API and four Sites tests remain a dated checkpoint. Full repository suite, remote CI, real model execution, approvals, extreme zoom and performance benchmarks were not run.

Preview remains running on 5207 with task-owned deterministic companion 4327. User services and original fidelity checkout are untouched. No scenery/assets, robot animation, camera or day/night behavior change; no Goal 6, game merge or game publication. The independent private journal follows its existing update workflow.
