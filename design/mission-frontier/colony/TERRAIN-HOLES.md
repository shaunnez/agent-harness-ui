# Terrain holes diagnosis — 16 September 2026

**Verdict: missing and unclosed geometry inside the single island asset, not a tile-seam artefact.** The gaps sit where the scanned cliff shells meet the gravel terrace and the limestone core of `environment.glb`. Instances of the island do not touch each other at three projects, so no seam between tiles exists to z-fight or cull. A secondary, latent defect exists: the walkable terrace and the two "contact geology" solids have inverted normals. Double-sided materials hide that today, so it is not the cause of the visible holes, but it must not survive into the rebuild.

**Cost consequence:** this is part of the terrain rebuild, not a cheap standalone application fix. No line of application code changes the result, because the missing surfaces are absent from the asset. A standalone Blender patch (close the rim, flip the terrace normals, re-export the 58 MB environment) is possible if the current preview must look clean before the rebuild lands, but it would be discarded when the parcel tiles replace the island.

## What the holes are

1. **Open scan shells at the rim.** `coastal_scanned_formation_0/1/2`, `rear_rocky_terrace` and `interlocking_scanned_cliff_0/1/2` are open surfaces, not solids: 11,323 and 8,804 boundary edges each (an evaluated closed mesh has zero). The game camera looks down at 28 degrees and sees into the unlit inside of those shells wherever the terrace edge does not meet them. Those interiors render near-black and read as holes.
2. **Terrace edge not joined to the rim.** `continuous_gravel_terrace` (96 boundary edges) is a radial fan disc laid over the core. Its edge tucks under the shells with slivers and gaps; the fan's wrap seam produces a folded sliver from the centre pole toward the front-right, visible in the renders below (the court and plinth cover most of it in the game).
3. **True see-through gaps are small.** Ray casts along the game camera direction on a 0.4 m grid over the 19,154 inland cells found 15 cells where the ray passes through the land and reaches sea level inside the shoreline. Vertical rays on a 0.5 m grid found 28 cells with no terrain beneath. Both clusters are on the front-left and rear-right rim (see `hole-map.png`). The dark patches you see are mostly shell interiors, not sky or water.

## Evidence

All files are in [build-evidence/COLONY-DESIGN/terrain-holes/](../build-evidence/COLONY-DESIGN/terrain-holes/).

| File | What it shows |
| --- | --- |
| `double-sided-as-app.png` | Blender Workbench render of `environment.blend` from the game camera direction with double-sided shading, as the browser renders it. Rim cavities and the terrace fan seam are visible. |
| `front-side-only.png` | Same view with back-face culling on. The entire terrace disappears: its faces wind downward. The contact solids also vanish. |
| `rim-front-left-double-sided.png`, `rim-front-left-front-only.png` | Close-up of the front-left rim showing the unjoined terrace edge and the shell interiors. |
| `hole-map.png` | Plan view. Orange: first surface hit from the camera direction is a back face (12,408 terrace cells, 1,020 contact-geology cells). Red: true see-through cells. Magenta: no terrain beneath (vertical). |
| `raycast-oblique-app-camera.json`, `raycast-vertical.json` | Raw counts and cell coordinates. |
| `source/glb_normals.py` output | Exported GLB check: `MF_Terrain__terrain_gravel_sand` has 4 percent of horizontal faces winding up; cliff scans 65 to 70 percent; limestone core 88 percent. Vertex normals agree with winding, so this is authored orientation, not an export flip. |
| `source/browser-diagnostic-page.html` | Throwaway Three.js page (not application code) that loads the public environment GLB with the app's GTAO settings and toggles front-side-only rendering; it reproduced the same result in the browser on this machine. |

The exported GLB materials are all `doubleSided: true`, so Three.js renders both faces and lights them correctly. That is why the terrace looks lit in the game despite inverted normals. The GTAO pass renders its normal/depth buffer with a front-side-only override material, so the terrace is absent from the ambient-occlusion buffer. On the current scene the visible effect is negligible; it becomes a problem the moment any single-sided terrain, decal, or shadow-only pass is introduced.

## What it is not

- **Not gaps between tiled island instances.** With three projects the instances sit 80 to 95 m apart with open sea between them. Only from the fourth project onward would the current placement formula overlap island footprints (slot 4 lands on slot 2's terrain), which would create real z-fighting. The colony plan replaces that formula.
- **Not culling.** All materials are double-sided; the browser diagnostic with culling forced on looks different from the game, not the same.
- **Not the performance commit.** `fdcf054` changed shadow refresh, worker batching and labels only; the same cavities appear in the retained EXTERIOR-BASES captures.

## Rules carried into the contract

- Land is a closed manifold core with outward normals; scan shells are detail on top of it and never the only surface.
- Terrain and road materials are single-sided; the integration validator checks winding against vertex normals and rejects a parcel whose horizontal faces wind downward.
- The validator ray-casts a 0.5 m grid from the exterior camera direction over every parcel's shoreline polygon and rejects any cell that reaches sea level inside land.
