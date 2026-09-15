# Mission Frontier 3D proof — Astra scene

Producer scope: this directory only. Builder owns integration, runtime lighting/water, task state, actual browser evidence and visual acceptance. This is a reviewable real 3D scene, not a raster replacement. No paid generation or new character design was used.

## Deliverables and runtime contract

- `scene.blend`: editable authored scene, separate components and named visibility roots. Preview lights are authoring aids; GLB excludes them.
- `scene.glb`: portable PBR scene, merged by visibility root/material (see current count in `validation.json`). No workers, fixture identities, labels or task status are baked in.
- `worker.blend` / `worker.glb`: retained original cinematic worker type, normalized to 1.8m, feet at origin, glTF +Z forward. One `worker_tool_work` clip reuses original tool/arm motion (1.2 seconds; feet stay stationary). Runtime must play only for an admitted recorded active run; waiting/blocked/historical/disconnected workers remain parked.
- `scene-metadata.json`: actual exported cameras, seven sockets, visibility root/mesh inventory, source component inventory, material inventory, bounds, court route, eight practical light positions and shoreline loops. `measured-bounds.json` records evaluated building, terrain, court and bridge bounds for the shared contract.
- `previews/exterior.png` and `previews/cutaway.png`: inspected Blender renders. These are authoring QA, **not application evidence or user acceptance**.
- `validation.json`, `packaging-report.json`, `source-audit.json` and `rebuild-verification.json`: structural checks, texture packaging and current GLB hashes.

Metres; Blender X/right, -Y/front, Z/up becomes glTF X/right, +Z/front, Y/up. Sea level 0; main floor/court approximately 4.25. Original contract camera/socket values are retained. `MF_Roof` and `MF_ShellCutaway` are independent hideable roots; camera-facing obstructing wall/panels and front portal shell disappear together. `MF_Interior` remains the same building. Practical material names start `practical_`; some architectural strips are descendants of the hideable shell so they do not float after the shell is removed. Control emissive intensity by material name regardless of visibility root.

Shoreline loops are sea-plane sections of the continuous main geological core and the far landing. Scanned cliff outcrops overlap that core and can extend past the core contour; keep wash short and depth-tested. `shorelineExactXZ` retains the closed source section; `shorelineXZ` is a closed RDP simplification at 0.14m tolerance. Metadata records measured maximum deviation and point counts. No shore loop represents a route or task transition.

## What changed after actual browser iteration 1

The builder rejected the initial sandy slab, repeated boulder edge, ball-like trees, generic roof/window treatment and blank cutaway walls. The scene now uses CC0 coastal scan formations, photographic ground/rock PBR maps and geometric cliff relief; retained Quaternius twisted trees with real branches/leaves and preserved vertex alpha; physically separated radial roof armor, raised side armor, deeper framed facade bays and structural entry shoulders; and dark framed service panels/practical strips in the same-building cutaway. The court, bridge abutments, far landing, worker sockets and operational semantics remain the builder contract.

Browser iteration 2 prompted another major-form pass: six overlapping curved service bays at stepped heights (overall shell approximately 27m wide), rooftop service spines, 0.8m console worktop heights with angled controls, inset floor services and a shared equipment bench within the existing two work areas. A second distinct coastal scan interlocks across front/right gaps; the court and bridge corridors are explicit clearance regions. Vertical cliff UVs use metre-scaled facade projection rather than stretched terrain UVs.

Iteration 3 retained those major forms. The final geological joining pass tucks front/right scan rims inward and intersects them with two closed irregular rock contact volumes. These retain photographic metre-scaled PBR and evaluated geometric relief; the court and bridge remain clear. Browser iteration 4 rejected a boundary-fan closure, which is not part of the final recipe.

## Rebuild

From repository root, using Blender 5.2.1 and Python 3 with Pillow:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python design/mission-frontier/assets/staging/3d-visual-proof/astra-scene/source/build_scene.py -- --render
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python design/mission-frontier/assets/staging/3d-visual-proof/astra-scene/source/export_worker.py
python3 design/mission-frontier/assets/staging/3d-visual-proof/astra-scene/source/package_glbs.py
python3 design/mission-frontier/assets/staging/3d-visual-proof/astra-scene/source/validate_assets.py
```

For export only, open `scene.blend` and run `source/export_scene.py`, then package and validate. The exporter temporarily merges static components in memory after the authoring blend is saved. It retains UVs, smooth flags, vertex color/alpha, cameras, sockets and visibility roots. Do not save the merged working scene over the authoring blend unless that is intentional. Opaque texture compression is JPEG quality 95; alpha textures remain PNG. Materials have actual image color/normal/roughness data; terrain displacement is evaluated into geometry. No unexported Cycles procedural effect is required by the delivered GLB.

`source/download_polyhaven.py` can reacquire retained free sources. Downloads are not needed for an ordinary rebuild; all inputs are retained locally. The final recipe was rebuilt independently from scratch in Blender 5.2.1. Mesh/material/image/triangle counts, GLB byte size, cameras, sockets, group/material inventories, routes, lights and shoreline match the frozen delivery; see `rebuild-verification.json` and `rebuild-final.log`. GLB hash differs between fresh-build and saved/reopened export, so byte identity is not claimed. Byte-identical Blender files are not promised across Blender versions.

## Provenance and limits

- Architecture, court, utilities, bridge and continuous terrain core: original procedural Blender authoring in this directory.
- Coastal cliff scans: [Poly Haven Coastal Cliff 01](https://polyhaven.com/a/coastal_cliff_01) and [Coastal Cliff 02](https://polyhaven.com/a/coastal_cliff_02), decimated with UVs retained, placed as coherent coastal formations.
- Terrain maps: [Coast Land Rocks 01](https://polyhaven.com/a/coast_land_rocks_01) and [Seaside Rock](https://polyhaven.com/a/seaside_rock). [Poly Haven CC0 license](https://polyhaven.com/license). Exact source URLs, bytes and hashes: `sources/polyhaven/provenance.json`.
- Trees: existing Quaternius Stylized Nature MegaKit FREE STANDARD CC0 `TwistedTree_3` and `TwistedTree_5`, adapted in proportion and leaf colour. Retained input files and provenance: `sources/quaternius/`.
- Robot: unchanged original cinematic-v1 authored character geometry and original short tool motion; copied original recipe is `source/original-worker-production.py`. No external character asset or model generation.

Builder reviewed the final `a69efbdd9ca1` export in the actual browser and found the front/right contacts solid with no detached fin, sufficient for this bounded proof. Broad geological backing surfaces and scan texture transitions remain candid art-review gaps. Rejected browser iterations remain in builder-owned `build-evidence/3D-VISUAL-PROOF/`; the earlier editable source snapshot is retained as `scene.blend1`. This is builder qualification, not user artistic approval. Remaining artistic differences should be judged in the browser. The roof/court composition is intentionally a bounded one-base proof; it is not a claim of exact reference reproduction or approval. Scans and original meshes still require the builder's actual browser material, occlusion, lighting, contact, selection and laptop performance checks. No application, backend, browser, public asset, shared contract, journal or unrelated worktree files were edited by this producer.
