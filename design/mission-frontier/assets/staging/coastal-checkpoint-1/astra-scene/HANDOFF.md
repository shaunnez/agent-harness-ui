# Coastal checkpoint 1 — Astra scene

One registered Blender scene authored against contract revision 2. The builder approved the corrected architecture/composition for integration. Product acceptance remains the builder's normal-scale World review with live workers, neighboring projects, water shader and day/night controls.

The final scene replaces the first detail's blank upper mass with a recessed structural gallery, separate ceramic armor, cornice, roof cooling assemblies and receiver pedestal. A carved vestibule opens the entrance. Court drains, flat loading marks, a fixed side service apron and bridge approach curbs preserve the live court. Raised rear grading, retained vegetation and irregular Quaternius rock forms replace the flat fan and repeated proxy stones. Final fixes orient the ground normals upward and ground the exposed ledges at the shoreline.

## Runtime contract

All seven straight-alpha PNGs have source size 2560×1920, logical size 1280×960 and ground anchor [640,600]. Entries resolve relative to `entries.json` in this directory. IDs: `mf.coastal.terrain`, `.base`, `.bridge`, `.front`, `.lights`, `.shallows`, `.shore`.

Draw shallows, terrain, bridge, base, live workers, front, then practical emission. The front layer contains only the low front court corner kerbs. Daytime architectural layers already contain their practical fixtures; the lights-only layer provides a controlled night boost. It contains occluded visible emitters with reconstructed straight alpha and no black matte. It must not be treated as a full-canvas black image or a replacement for runtime state indicators.

The court origin is z=0. Named sockets retain the measured contract positions: entrance [0,10], near [250,-115], far [430,-205], join [520,-250]. The approach/crossing is 42 logical pixels wide perpendicular to its axis, tapering to 26.4 over the last 70 logical pixels at the real junction. A camera-ray-only sea-datum holdout at z=-2.82 clips submerged feet while preserving ocean bounce lighting. Other layer holdouts retain true camera occlusion, preventing buried pier sections from drawing over foreground cliffs. Cutout opacity selects Transparent versus Holdout inside the camera branch; 64 transparent bounces prevent dense foliage stacks terminating as black pixels. The targeted 614×1209 foliage crop measured zero nonzero-alpha pixels before the full surface refresh. The beauty preview includes a neutral ocean and its shadows; that ocean is not exported as a rectangle.

Worker/patrol clearance is x[-110,54], y[12,84]; task workers [-30,25], [32,25] remain open. Retained-artifact positions [-131,10], [-89,10] remain open. No workers, task cargo, IDs, labels or operational states are baked into the kit.

## Masks

`masks/shore.png`: R is raw linear normalized offshore distance, 0 at the shoreline to 1 at 1.35 world units. G/B are zero. Alpha combines actual water visibility, a soft outer edge, broad irregular world-space breaking patches and open-water-facing shoreline exposure. Sheltered sections have reduced breaking. R carries no tint or foam colour. The builder shader unpremultiplies the sampled data and moves its crest toward shore.

`masks/depth.png` is retained source, not an eighth runtime entry. R is normalized distance used as a shallow-water depth proxy over 1.5 world units; it is not a physical bathymetric survey. Alpha is water-only coverage with an outer fade. `renders/shallows.png` is subdued registered shallow-water colour with independent coverage; it remains visible where surf strength is reduced.

Distance is calculated on a 2048² world-XY grid from authored coastal-core waterline polygons and conservative sea-intersecting rock ellipses, then projected at the exact sea plane. It is therefore an approximation of irregular rock intersection, not a claim of exact mesh signed distance. Final visible land, supports and architecture alpha suppress water effects over opaque geometry. `qa/static-qa.json` records grid spacing and the independently verified EDT error. `source/shore-geometry.json` is the retained geometry input. `source/edt.cpp` computes the exact distance transform of that raster; generated raw buffers/executable are disposable.

## Reproduction

Use Blender 5.2.1 LTS; production uses at most four render threads. Run commands from the repository root, replacing `SCENE` below with `design/mission-frontier/assets/staging/coastal-checkpoint-1/astra-scene`.

1. Standalone re-export: `Blender -b -t 4 --python SCENE/source/export_layers.py`. This reads only the packed `blend/coastal-detailed.blend`; original acquisition sources are not required.
2. Run `python SCENE/source/package_outputs.py` using Python with NumPy and Pillow plus `clang++` on PATH. It creates the masks, straight-alpha lights, seven measured entries and review composites.
3. Optional exporter qualification: `Blender -b -t 4 --python SCENE/source/export_layers.py -- --calibration` produces the cropped base matte outside the base footprint; expected alpha is zero. `--surfaces-only` refreshes only base/bridge/front.
4. Run `python SCENE/source/verify_registration.py`, then `Blender -b -t 4 --python SCENE/source/audit_blend.py` for independent registration, source packing and clearance evidence.

Full geometry rebuild is separate: `Blender -b -t 4 --python SCENE/source/build_detail.py`. It starts from historical `blend/coastal-blockout.blend` and needs retained free source inputs. Set `MF_COASTAL_FREE_SOURCE_ROOT` to the retained `cinematic-v1/astra` directory containing `sources/stylized-nature-megakit/glTF/` and `vegetation-production/blend/spreading-grove-r2.blend`. Default lookup tries the sibling staging source, then the original local worktree path. Missing inputs produce an explicit error. `source/rebuild-inputs.json` records source hashes and the licence/acquisition evidence. No paid generation or new acquisition was used.

The packed final blend is the portable export authority. Source configuration was made portable after the final geometry build; `qa/detail-calibration.json` preserves as-built source hashes, while `qa/registration-audit.json` records the delivered source hashes. The configuration change does not alter geometry. The retained normal-correction record changes face winding only; source fan/ring faces now orient upward consistently.

## Keep and exclude

Keep `entries.json`, this handoff, `BLOCKOUT-HANDOFF.md`, `source/*.py`, `source/edt.cpp`, `source/*.json`, the final and historical blockout `.blend` files, all seven final entry PNGs, `masks/depth.png`, `masks/source-world-waterline.png`, assembled/blockout review PNGs and comparison JPEGs, plus measured QA JSON. The seven staging PNGs may be force-added alongside their identical public copies; Git shares identical blobs and fresh integration needs no rerender.

Retain failed/intermediate review evidence locally or explicitly as historical comparison material: `qa/detail-first.png`, `qa/detail-corrective-r2.png`, and blockout QA imagery. They are not final runtime art.

Exclude `*.blend1`, `source/__pycache__/`, `qa/edt`, `*.raw`, `qa/*process-sample.txt`, render logs and `renders/lights-raw.png` from the final tracked handoff. These are generated diagnostics or intermediate buffers, not necessary inputs. Do not delete earlier review evidence or original source assets.

No app/public/shared contract changes were made by Astra. The builder owns integration and final product evidence.
