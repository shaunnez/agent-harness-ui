# Mission Frontier — 3D proof handoff

16 September 2026. The bounded proof is ready for local artistic review. [Acceptance](acceptance.md) separates builder qualification from user approval and the remaining design gap.

## Open the proof

The isolated Vite server is running on loopback **5207**:

- [Exterior](http://127.0.0.1:5207/?mode=fixture&scenario=workflow&art=cinematic&renderer=3d#world)
- [Same-building cutaway](http://127.0.0.1:5207/?mode=fixture&scenario=workflow&art=cinematic&renderer=3d#project/plancheck)
- [Existing multi-project world](http://127.0.0.1:5207/?mode=fixture&scenario=workflow&art=cinematic#world)

Worktree: `/Users/shaun/.codex/worktrees/7237/mission-frontier-3d-proof`. Branch `codex/mission-frontier-3d-proof`, based on `a6f637fe796bfedae3df476adae97f007ad7b2e0`. Main `0f877a9` was verified an ancestor at start, including merged HUD PR #88; draft coastal PR #89 was preserved. This proof is an **uncommitted local diff**, not an update to that PR. Existing worktrees and the prior 5206 service were left intact. No backend service was started.

If a later session finds 5207 stopped, inspect listeners first, then run `npm run dev:frontier -- --host 127.0.0.1 --port 5207 --strictPort` in this worktree. Do not kill another checkout's service to reuse its port.

## What changed

A lazily loaded Three.js/R3F scene sits behind the existing React controls only for `mode=fixture&renderer=3d` and PlanCheck. Default Pixi and all live data remain on the existing path. Other projects remain accessible through the scope picker and All projects link.

One physical scene contains a segmented ceramic/steel base, recessed entrance court, roof services, interior work areas, props, planted coastal terrain, elevated bridge and small far landing. Exterior/cutaway toggles hide named roof and obstructing shell groups. The existing robot is reused with a short admitted work clip. The browser adds light/shadow, ambient contact shading, restrained bloom, shoreline-distance water and day/dusk/night response. Minimap and base preview are real renders from this scene.

The adapter reuses recorded-state projections. Active runs may work; answer/repair/historical/disconnected workers park. An active sibling run is not erased by the task's blocked status. Existing Inspect, Watch, model/reasoning controls, usage, management and keyboard routes retain their semantics. Missing assets and graphics loss have explicit recovery instead of an endless loader.

## Review these first

1. **Physical direction:** [original/previous/proof comparison](final-comparison.jpg). Does the curved building, recessed court and connected coast provide the right foundation?
2. **Interior:** [HQ comparison](cutaway-comparison.jpg). The cutaway is physically consistent but only demonstrates two representative work areas. It is simpler and more open than the concept.
3. **Light and use:** [day](world-day.jpg), [dusk](world-dusk.jpg), [night](world-night.jpg), [laptop](world-laptop.jpg). Pan, select a robot, open Watch, then try a lighting preset.

There is still a substantial finish gap to the original: symmetric/clean architectural surfaces, broad geological backing and scan texture transitions, sparse ground cover/props, simple foliage and the old robot's detail. The proof improves geometry, depth and the exterior/interior relationship; it is not an exact reproduction or a production-art acceptance claim. Do not multiply this kit before the direction is accepted.

## Code and assets

- `src/frontier/world-3d/`: small renderer boundary, pure admission/manifest model, GLB loader/recovery, scene/camera, worker, water, postprocessing/capture and DOM labels.
- `src/frontier/app/FrontierApp.tsx`: explicit opt-in and narrow existing renderer/control routing. `BaseSelection.tsx` accepts the common preview capability.
- `tests/frontier/3d-proof.test.mjs`: eight admission, identity, labels, manifest and portable-asset tests.
- `scripts/frontier/integrate-3d-proof.mjs`: validates GLBs and writes content-addressed public assets/manifest and inventory. Run from repository root after freezing producer assets.
- `design/mission-frontier/assets/staging/3d-visual-proof/contract.json`: frozen scale, axes, camera, visibility groups, sockets and measured bounds.
- `.../astra-scene/HANDOFF.md`: editable source, complete source rebuild commands, audits and CC0 provenance. `.blend` and original source archives remain local under existing ignore rules; preserve them if preparing a later delivery archive.

Final scene is **76,790,764 bytes**, 55 merged meshes, 817,748 triangles, 29 materials and 21 embedded images. Public SHA: `a69efbdd9ca192ae5044ee0604d8aa7e02b46a6b2e2cb30f306ab1f4e7ecee40`. Worker is 1,118,716 bytes, SHA `aee069a9823b79f201ba7a615313acea18ac83e5844a8f7b3149190262aa370a`. Only final public GLBs remain. These detailed proof assets are not a shipping asset-budget decision.

Astra's independent source rebuild matches counts, bytes and exported structural contracts. Fresh versus save/reopen Blender export differs in hash; that negative evidence is retained in `rebuild-verification.json`. No byte-identical source rebuild is claimed. No paid generation was used.

## Verification and limits

96 Frontier tests, typing, lint and formatting passed. The final asset recheck passed all eight relevant tests. Final main build, four Sites tests and Frontier build passed sequentially. Logs are linked from [acceptance](acceptance.md). Source and evidence hashes are recorded in `source-manifest.json`.

Browser evidence covers actual mesh/label selection, Tab/Enter/Escape/arrows/Space, drag/wheel, camera persistence, project fallback, active/historical/repair/answer controls, policies and usage, laptop task form, connection loss, missing GLB and actual forced WebGL context loss/Retry. Final desktop and laptop views were inspected. `motion-frames.json` / `motion-check.json` retain actual running versus frozen browser frames; `shore-final-frames.json` / `shore-final-check.json` bind shoreline motion to the final scene. These are ordered frames, not captured video.

Vite reports its existing chunk-size advisory. R3F emits an upstream `THREE.Clock` deprecation with Three 0.186. No normal browser render error remains. Native screen-reader/OS reduced-motion switching, full backend tests, real processing, remote CI and performance benchmarking were not run.

## Next boundary

User artistic review, then a deliberate decision on the 3D foundation. If accepted, the next small art slice should refine this base's structure/material wear, terrain transitions and useful dressing before additional project scenes. Full World/HQ/Watch migration and asset distribution need a separate implementation plan. Seabirds, cargo/jetpack choreography, new character production, progression and Goal 6 remain separate.

The independent project journal receives this dated milestone and actual captures through its existing audience-preserving workflow. Its publication receipt belongs to the journal; publishing it does not publish the game.
