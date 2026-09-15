# Exterior base kit — Astra

Four real GLB assets, derived from the accepted coastal proof. Producer edits are confined to this directory. Builder owns project assignment, palettes, worker scaling, labels, ray picking, motion gates, browser evidence and acceptance.

- **Command:** curved twin bays, segmented circular command crown and recessed identity disc.
- **Relay:** asymmetric stepped communications tower, concave radio dish, lower service wing and offset identity disc.
- **Foundry:** broad segmented barrel-vault hangar, closed gables, rear utility silos and roof vent banks.
- **Environment:** unchanged evaluated coastal terrain, planting, bridge and landing geometry. Far landing bollards and their caps move into the environmental hierarchy.

All bases retain the same two furnished work areas, court, seven sockets and walkable route. Crate assemblies measure 2m high from their original floor contact. Cart components scale together by 1.35 around ground contact. The front-right crate moves to x10.5,z17.6 to clear the enlarged cart. Robots are not embedded; builder scales the original worker from 1.8m to 3.1m.

## Integration

`kit-metadata.json` contains per-asset bounds, building bounds, root/mesh/material/source-component inventories, per-variant `baseLightPositions`, `environmentLightPositions`, and retained camera/shore/route data. Base groups match the shared contract. Hide **MF_Roof** and **MF_ShellCutaway** together for the same-building cutaway; station details attached to those groups disappear with them.

Tint only `identity_roof_inset`, `identity_roof_ring` and `identity_trim`. They are neutral in source. `ambient_screen_service` and `ambient_sensor_navigation` are stationary scenery materials suitable for gentle builder-controlled emission changes. `practical_*` materials are warm lighting, independent of task attention. No project identity, task status, actor or progress animation is baked into the kit.

`previews/command.png`, `relay.png` and `foundry.png` are transparent exterior appearance previews using the same camera and neutral palette; they are suitable for a building picker. Matching `*-cutaway.png` renders are producer QA. These source renders do not establish browser acceptance.

## Reproduce and export

From the repository root, using Blender 5.2.1 and Python with Pillow:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python design/mission-frontier/assets/staging/exterior-bases/astra-kit/source/build_kit.py -- --render
python3 design/mission-frontier/assets/staging/exterior-bases/astra-kit/source/package_glbs.py
/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python design/mission-frontier/assets/staging/exterior-bases/astra-kit/source/export_saved.py
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python design/mission-frontier/assets/staging/exterior-bases/astra-kit/source/audit_authoring.py
python3 design/mission-frontier/assets/staging/exterior-bases/astra-kit/source/validate_kit.py
```

The build reads the sibling accepted `3d-visual-proof/astra-scene/scene.blend` and shared contract without changing either. Each delivered `.blend` retains independently editable components and packed image inputs. Saved-source export does not need to rebuild geometry; it reopens those blends and writes to `export-check/`. Static meshes merge by visibility root/material only during export. Embedded normals, UVs and leaf colour/alpha are preserved. Geometry displacement is evaluated before export. Packaging converts opaque images once per fresh export, preserves alpha PNGs and uses its hash report to avoid repeated lossy recompression.

`validation.json` records current delivery hashes and structural checks. `independent-export-check.json` compares independently reopened/exported blends. `authoring-audit.json` verifies all 92 retained environment components have unchanged evaluated geometry, the three cargo assemblies are exactly 2m high and the cart/crate clearance is 0.807m. `packaging-idempotence.json` verifies rerunning packaging leaves delivered hashes unchanged. No claim of byte-identical Blender serialization across versions is made.

## Provenance and limits

Accepted source provenance remains in `../../3d-visual-proof/astra-scene/HANDOFF.md` and its retained Poly Haven CC0 / Quaternius FREE STANDARD CC0 source records. This kit adds original Blender-authored architecture/detail meshes and uses the existing accepted materials. No new character, paid generation, downloaded asset or terrain campaign was introduced. `provenance.json` binds the inputs and generated source scripts by hash.

The three crowns are structurally different while lower occupied architecture remains shared by design. Artistic acceptance, project-scale visibility, day/night intensity, local appearance persistence and performance must be judged in the actual browser by the builder. The accepted environment’s broad rock backing and scan transition limitations remain unchanged.
