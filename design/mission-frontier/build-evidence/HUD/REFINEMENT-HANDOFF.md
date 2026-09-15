# HUD refinement — 15 September 2026

Applied the latest explicit screenshot feedback from clean HUD revision d0d20fc on codex/mission-frontier-hud. Earlier checkpoints remain dated and intact.

- Removed the connected sample demonstration footer and art-preview/comparison footer. Offline/reconnect information remains visible; operational connection distinctions are preserved.
- World/HQ minimap is only the actual map within a thin border. Removed its heading and fit/follow/zoom controls; existing mouse navigation, minimap click/pan and keyboard navigation remain.
- Removed Recorded details and the close button from selected-task HUD. Escape still dismisses selection; full recorded reason, next actor and workflow safeguards remain in Inspect/decision navigation. Portrait has no border, padding or background. Artifact disclosure has a right-aligned caret and real retained cards.
- Bottom-right controls are 340px wide, with unwrapped desktop/laptop labels and instructions. Their bottom baseline matches the selected dock. Panel gradients and inner cards are darker.
- Selected bases show current open/executing/needs-you counts and a static preview generated on selection from the actual headquarters scene using current lighting. Base and task docks share a 236px minimum height. Preview is a capture, not animated or a claim of ongoing activity. A failed preview reports unavailable; late results cannot enter another selected base.
- Day/night control is centered beneath date/time at normal laptop/desktop sizes. Removed the HQ Return to world button; World navigation remains. Needs you is top-aligned and its final row has no bottom border.

Computer-use acceptance: 1488×1058 and 1280×720 World/HQ, no selection, running/repair task selection, base selection/counts/current-lighting preview, Enter base, artifact collapse and Enter expansion, Inspect reason/safeguards, lighting-settings access, and Escape dismissal. Readability and local scrolling inspected. Screenshot evidence: refine-*.png. Source/implementation comparison: refine-comparison.png. No extreme zoom or benchmark used.

Latest local checks: 84 Frontier, 18 Frontier API and four Sites tests passed, plus typecheck, lint, formatting and both builds. Existing bundle-size warnings remain. API disposable fixture commits used command-scoped Git signing override only; global configuration and application signing safeguards are unchanged. Protected hosting/worker/packaging sources are unchanged. Full repository suite, remote CI, real model execution and real approvals were not run.

Preview remains running on 5207 with the task-owned deterministic companion on 4327. User services and original fidelity checkout remain untouched. No scenery, assets, camera, animation or day/night behavior change; no Goal 6, game merge/push/publication. Journal publication follows its separate existing owner-only workflow.
