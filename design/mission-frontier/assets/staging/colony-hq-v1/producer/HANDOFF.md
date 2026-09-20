# Colony HQ producer handoff — 16 September 2026

Complete bounded Command kit, bound to frozen contract **1.0.1-frozen**. All output is confined to this producer directory. No shared source kit, contract, application code or repository state was modified by the producer.

## Deliverables and measurement

| GLB | Triangles | Bytes | Embedded images |
| --- | ---: | ---: | ---: |
| `hq-shell.glb` | 45,468 | 2,767,696 | 6 |
| `crown-command.glb` | 25,412 | 1,707,568 | 4 |
| `bridge-span-27.glb` | 6,588 | 988,788 | 6 |
| `bridge-end.glb` | 680 | 432,896 | 4 |

The four editable `.blend` files retain separate authored components, bevel modifiers and the accepted material library. Export merges static meshes only by material and visibility group. `hq-metadata.json` binds every GLB hash and stores measured bounds by group, materials, component inventory, lights, door frames, 28 equipment footprint obstacles and exact exported socket positions. The 53 worker sockets plus `base_label` are glTF nodes, never meshes.

## Integration contract

- All coordinates already use absolute parcel-local heights. Apply only parcel X/Z translation. Ground4.0, court4.25, HQ floor4.30.
- Load shared `hq-shell.glb`, then the separate `crown-command.glb`. Hide **both assets' `MF_Roof` groups** and `MF_ShellCutaway` recursively in HQ/Watch. Shell `MF_Roof` owns the bay roof; crown root owns the hex deck/crown.
- Front flats30/90, bay front/right and upper glazing have dedicated children under `MF_ShellCutaway`. Each of the six rooms is a child under `MF_Interior`.
- Span root is from-abutment face, +X along bridge, exact extentX0..27, deckY4.25. Three piers atX6.75/13.5/20.25 reachY-3; guardrail top5.35. End root is pad centre, outward abutment faceX4, foundationsY-3 (hidden concrete cap4.24 sits1cm below the terrain pad to prevent coplanar surfaces) and graded inboard kerb4.0→4.25.
- Neutral `identity_*` channels remain available for runtime project tinting. Screen traces and warm practicals are ambient equipment only; no runtime state is baked in.
- `obstacles` are floor-level equipment collision footprints. Door/opening and room polygons remain the frozen contract's authority.

## Verification performed

`source/validate_hq.py` independently re-imports each exported GLB and passes **187 checks**: SHA256, embedded PBR textures and image dimensions, triangle/byte budgets, root/cutaway/room groups, all53 exact worker sockets, neutral identity materials, measured bounds, crown envelope and bridge/foundation levels. `validation.json` retains the results; `validation.log` retains the Blender output.

Producer rendered and visually inspected `previews/command-exterior.png`, `command-cutaway.png`, `bridge-span-27.png`, and `bridge-end.png`. Exterior and cutaway use the contract camera values. The first cutaway exposed a coincident dark bay foundation/floor; the foundation was lowered to4.26 and the exported floor is now correctly visible at4.30. Bridge piers and abutments were corrected to the seabed level. This is asset-level QA; the lead still owns browser acceptance with runtime robots, HUD, terrain and selected camera framing.

## Rebuild, validation and previews

From repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python design/mission-frontier/assets/staging/colony-hq-v1/producer/source/build_hq.py
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python design/mission-frontier/assets/staging/colony-hq-v1/producer/source/validate_hq.py
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python design/mission-frontier/assets/staging/colony-hq-v1/producer/source/render_previews.py
```

Optional rebuild selectors after `--`: `shell command bridge end`. Metadata updates only selected assets. Preview rendering uses bounded CPU threads; Metal device discovery hung in this headless environment and is deliberately avoided.

## Provenance and limits

See `PROVENANCE.json` for source hashes. The central Command assembly and physical bridge component meshes derive directly from accepted editable Astra kit sources, accessed read-only. The new shell, roof fit, room equipment, bay and court are deterministic Blender geometry using that material library. A bulky cliff-textured bridge pier material was replaced by the shared ivory ceramic to fit the2MB span budget. No new paid generation or downloads occurred.

Relay/Foundry variants are optional follow-on assets and are not delivered here. This producer pass does not authorize live adoption, Goal6 or publishing. Lead owns staging/commit and final browser acceptance.
