# Coastal checkpoint 1 — acceptance

15 September 2026. **Visual and technical matrix passed for this bounded checkpoint; delivery packaging in progress. Artistic approval remains with Shaun.**

Branch `codex/mission-frontier-coastal-checkpoint-1` includes main `0f877a9` / merged HUD PR #88 through merge `aeec649`. Final seven-layer Astra export is integrated; earlier blockouts and first-detail captures are historical.

| Check | Status and evidence |
| --- | --- |
| Coherent composition | Pass. Normal 1568×1003 World and 1280×720 laptop inspected. `world-day.jpg`, `world-laptop.jpg`, `final-comparison.jpg`. Base, court, raised crossing and shore read together. Original/current differences remain explicit below. |
| Building quality | Pass for one exterior. Recessed gallery/facade, stepped roof, service machinery, entrance and live court. Base matte and hit bounds remain inside the authored footprint. |
| Terrain relief | Pass. Raised planted shoulder, terraces, irregular cliff blocks and waterline ledges. Ground normals corrected. This is not a full-world terrain replacement. |
| Bridge/road contact | Pass. Measured endpoints connect existing graph without moving projects. Authored approach replaces old segment; two-arm junction removes unused stubs. Camera holdouts hide buried supports; neighboring canopy clearance exposes far landing. |
| Coastal depth and motion | Pass. Registered shallows and water-only distance/exposure mask; seven-second shoreward crest and fading wash. `shore-0.jpg`–`shore-3.jpg`, actual timestamps in `shore-sequence.json`, `shore-contact-sheet.jpg`. These are ordered samples across multiple cycles, not evenly timed frames of one cycle. Synthetic shader evidence separately qualifies direction. |
| Lighting and motion controls | Pass. `world-day.jpg`, `world-dusk.jpg`, `world-night.jpg`; dark sea/foam and practical night lights. Motion-off and disconnected shore crops are pixel-identical across later captures: `motion-pixel-check.json`. Existing reduced-motion admission retained; no OS preference change was needed. |
| Runtime truth and access | Pass. Active task selection; repair selection → Inspect → Watch shows completed run, parked worker, reason and eligible action; World → HQ → Watch → World works. `hq-repair.jpg`, `watch-repair.jpg`, `world-blocked.jpg`. Disconnection shows Last known and removes Watch, then sample connection restoration recovers Working. `world-disconnected.jpg`. Fixture Reconnect alone does not change the deliberately forced sample connection; QA toggle restores it. |
| Export correctness | Pass. Seven hashes/dimensions/anchors checked on integration and in tests. Packed Blender source, reproducible exporter, provenance and independent registration audit retained. Missing required art produces recoverable World unavailable / Retry artwork; `incomplete-kit-error.txt`. |
| Regression checks | Pass after final assets and main/HUD merge: 88 Frontier, 18 Frontier API, 4 Sites tests; typecheck, lint, format, main build, then Frontier build. Named logs in this folder. Browser error log empty. |
| Delivery | Final handoff and source inventory prepared. Draft PR and separate journal publication recorded in HANDOFF when confirmed. Preview on port 5206. No merge or game publication. |

## Limits and remaining visual difference

The original study remains denser, more asymmetric and more weathered, with richer vegetation transitions, connected terrain, stronger water detail and busier courts. This checkpoint establishes one reusable registered scene, not an exact full-world clone. Its grass is still comparatively smooth, cliff forms broader and court deliberately clear for live entities. These are appropriate subjects for artistic review before another production batch.

Other projects and roads retain the existing kit. The authored crossing is enabled only when the real route geometry matches; single/changed layouts retain existing art and infrastructure. The depth mask approximates shore distance, not physical bathymetry. HQ/Watch architecture, robots/cargo/jetpacks/seagulls and Goal 6 remain separate.

At 1280×720 all controls fit without document scrolling (scroll size 1280×720), but opening the existing selected-task dock covers much of the lower scene. Escape exposes the complete court again. This pass preserves the merged HUD and camera; it does not claim an unobstructed world while every overlay is open.

No real model task run, full backend suite, remote CI, performance benchmark, extreme zoom or user artistic approval is claimed. Existing bundle-size warning remains. No paid generation or game publication.
