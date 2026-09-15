# Registered cinematic room kit — r1

Builder integration and visual acceptance are pending. This is original procedural Blender geometry, based on the original headquarters and Watch studies. No external meshes, textures, paid services or generated raster assets were used.

## Integration

All layers are **1536 × 1280 source pixels**, **768 × 640 logical pixels**, with untrimmed logical ground anchor **[384, 522]**. The logical ground footprint is back **[384, 170]**, right **[736, 346]**, front **[384, 522]**, left **[32, 346]**. `source/geometry-final.json` measures the actual Blender camera projection.

Draw `mf.fidelity.room.floor`, then `.back`, then independent runtime stations/workers, then `.front`. The layers share exactly one orthographic camera, 45° azimuth / 30° elevation, and preserve contact shadows from the full room. The floor is a 10 × 10 world-unit square at z=0; centre [-3.6, -3.6] through [3.6, 3.6] remains clear. Front parapets are interrupted by open access spans and are below 0.67 world units, compared with 2.7-unit back walls. Maintain runtime depth sorting and labels separately.

`mf.fidelity.room.lights` is an **optional practical-emission boost**, with the same registration. It contains only physically visible lamps and unlabelled screen emission; solid walls occlude light geometry. Apply sparingly above a night treatment after floor/back and before runtime stations/workers, using normal alpha compositing. Front renders afterward and therefore repaints its own practicals; the single overlay intentionally gives no independent front-lamp boost. Never put the full overlay above a worker that can stand in front of a wall screen. The regular floor/back/front PNGs already contain daytime practical lights, so do not composite this overlay into the unmodified daytime base. This is environmental light, with no task-state meaning.

The three primary PNGs are untouched Blender renders. `renders/room-combined-r1.png` is a deterministic alpha composite for inspection, not a fourth room background. Runtime should use the separated files.

## Sources and QA

- `entries.json`: measured file entries, dimensions, alpha bounds, checksums, anchors and texture sizes.
- `provenance.json`: actual source/tool/settings and source/export hashes.
- `blend/room-final.blend`: editable final scene, with all regular materials and camera visibility restored.
- `blend/room-lights-pass.blend`: exact source for the opaque-black occluder / emission pass.
- `blend/room-calibration.blend`, `renders/calibration-combined.png`: retained initial calibration. The final changes add thinner chamfered coping, dark service seams, asymmetric bay equipment, smaller-scale material variation and flush floor maintenance hatches.
- `qa/rejected-coping-transform/`: retained rejected intermediate renders. Their left coping had an incorrect transform origin; they are never runtime candidates.
- `qa/static-checks.json`: alpha, no clipped canvas edges, registration and checksum checks.
- `qa/alpha-backgrounds.png`: actual logical-scale dark/light/magenta comparison.
- `qa/registration.png`: measured footprint and anchor over combined art.

Rebuild from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python design/mission-frontier/assets/staging/design-fidelity-v2/astra-room/source/build_room.py -- --quality final
/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 design/mission-frontier/assets/staging/design-fidelity-v2/astra-room/source/qa_room.py
```

Cycles, AgX, 64 samples, denoising, fixed seed 9152026, maximum four render threads. The lights-only auxiliary pass uses 16 samples. The optional overlay alpha is derived reproducibly from the occluded RGB render after removing <=4/255 black dither; original raw pass is retained.

## Limits

This is static asset QA, not browser acceptance. The builder must judge fidelity against the old image-generated shell at actual HQ/Watch scale, check independent workers and station contact, and qualify foreground occlusion. The geometry retains a regular modular room footprint; it does not reproduce the entire multi-building composition of the flattened study. Materials are controlled original procedural finishes, with less irregular painted micro-detail than the study. No new workers, stations, task labels, semantic rings, artifacts or activity animations are baked into this kit. No application/public/shared manifest files were changed by the asset producer.

Verified delivery: 4 RGBA PNG entries, 3048636 compressed bytes total; 30 MiB decoded RGBA for all four, or 22.5 MiB for the three structural layers. All outer canvas edges are fully transparent. Actual camera footprint error is below 0.0002 source pixels. `qa/static-checks.json` passed on the final files.
