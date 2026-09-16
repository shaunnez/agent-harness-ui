# Colony slice 1 terrain handoff — 16 September 2026

Delivered against corrected frozen contract **1.0.1-frozen**. Source ownership remains `terrain/**`; no runtime or frozen contract edits were made here.

| Asset | Bytes | Unique exported triangles | Embedded images |
| --- | ---: | ---: | ---: |
| parcel-hub.glb | 4,182,108 | 18,841 | 6 |
| parcel-a.glb | 4,133,044 | 17,626 | 6 |

Both include a continuous, closed outward core, single-sided portable materials, exact flat r34 plateau at y4, independent six pad/spur groups, the 27.5–32.5 ring road, compact retained CC0 planting, restrained meadow/gravel and limestone palette, rear relief and grounded rim stones. Hub additionally has the empty r14 landing pad. No task/actor/identity state is baked in. Front-side-only previews are in `previews/`; they use the contract exterior viewing direction. A project's HQ/court assets cover the central plateau at integration.

`parcel-metadata.json` records full hashes, bounds, exported triangle counts (plus evaluated instance counts), 97-point closed shoreline loops, plateau polygon, ring/spur/pad route polylines, pad centres and planting exclusions. Maximum shoreline simplification error is 0.063824 m for hub and 0.060912 m for A. `lightPositions` is empty: bridge-end practicals belong to the HQ producer. Source `.blend` files are independently editable and contain packed inputs; `provenance.json` binds the sources and outputs.

## Verified

- `export-validation.json`: actual exported GLBs have zero core boundary/nonmanifold edges, zero exposed downward core faces, zero triangle/vertex-normal disagreements across **all** meshes, zero degenerate triangles, no double-sided materials, all required operational visibility groups, and budgets satisfied.
- `export-raycast-validation.json`: fresh GLB imports, welded only at coincident UV/material seams, pass vertical and exterior-camera 0.5 m grids. Hub: 25,003 cells / 50,006 rays. A: 25,005 cells / 50,010 rays. **Zero see-through cells and zero back-face hits.** Signed core volume positive; seabed bottom faces deliberately face down.
- Source ray tests are also in per-file metadata. Source normal repair removes inherited Quaternius custom-normal attributes before export; merely recalculating normals did not remove those attributes.
- Both front-side-only PNGs visually inspected. Final browser composition and runtime water/lighting remain lead acceptance responsibilities.

## Integration details and explicit interpretations

- Hide each `MF_Road_Spur_E<phi>` and `MF_Pad_E<phi>` independently when its connection is absent. Terrain remains a complete island with hidden pads. No arbitrary project root rotation.
- Frozen `movement.spurs` has identical start/end radius32.5. Lead approved short junction mouths in ring r30–32.5 as its visible transition; pads retain exact r32.5–40.5 and width6. Metadata records this interpretation.
- Core plateau is exactly y4. Ring visuals sit 0.014m above it to avoid coplanar z-fighting. Thin safety markings and junction details have intentional closed-box undersides; they are not inverted top surfaces.
- Each pad is a closed abutment block from y-3 to4.25. The global seabed under the **open bridge channels** remains runtime-owned at y-3; parcel geometry stays within the r46 envelope.
- Terrain core relief reaches the permitted shoulder/backdrop envelope. Retained trees may extend above y9; y9 is the contract's cliff limit, not a tree-height limit. Planting remains outside r34 and away from connection corridors.
- No B/C parcels, crystals, shuttle, arrival, travel animation, new practical lights or Goal6 work was added.

## Rebuild and audit

From repository root, use Blender with **two threads** alongside other producers:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python design/mission-frontier/assets/staging/colony-hq-v1/terrain/source/build_terrain.py
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python design/mission-frontier/assets/staging/colony-hq-v1/terrain/source/compact_sources.py
python3 design/mission-frontier/assets/staging/colony-hq-v1/terrain/source/validate_parcels.py
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python design/mission-frontier/assets/staging/colony-hq-v1/terrain/source/validate_export_geometry.py
python3 design/mission-frontier/assets/staging/colony-hq-v1/terrain/source/finalize_metadata.py
```

The build is deterministic in geometry and palette; byte hashes can change with Blender exporter/library versions. Regenerate metadata whenever exporting. No server or Blender job remains required for these assets.
