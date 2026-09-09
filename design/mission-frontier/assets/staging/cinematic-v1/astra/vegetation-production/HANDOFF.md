# Vegetation production

Approved spreading composition rendered at64samples. `entry.json` is the foliage entry:768²/logical384², anchor[192,340]. `shadow-entry.json` is independently registered:1536×768/logical768×384, anchor[384,340]. Place both at the same world origin and logical scale, shadow beneath terrain props and foliage. No ground is baked into either export.

The final shadow uses the same warm key(+10,-6,16), fill and camera orientation as foliage. Doubling width and orthographic scale preserves vertical coverage and pixel/world density. Cycles shadow catcher receives actual hidden-to-camera tree geometry. `qa/shadow-ground-composite.png` is a tan-ground composition; `qa/shadow-checks.json` records raw edge alpha and cleanup. Low background noise was removed by subtracting12alpha, measured as99.5percentile in empty top200rows. Outer16px residual alpha was feathered to exact zero at every edge. RGB and physical shadow silhouette were not redrawn. Raw narrow, steeper-key and final wide experiments are retained; only the final wide entry is proposed for integration.

Rebuild foliage/source blend with `astra_vegetation_production.py`; final physical shadow with `astra_vegetation_shadow_wide.py`; deterministic alpha/export QA with `astra_shadow_qa.py`. Scripts live under`scripts/frontier/blender/`. Nature mesh names/transforms and archive provenance are in entry and shared`sources/acquisition.json`. Included publisher licences are CC0. In-app shadow contact and intensity remain the coordinator's gate.

## Albedo revision2

Use`entry-r2.json` and`renders/spreading-grove-r2.png` for the brighter approved-range foliage. Original r1 dark PNG/blend and entries remain as iteration evidence. R2 changes leaf albedo only, with shader endpoints[.45,.12,.53] and[.82,.40,.75]; geometry, camera, key and fill are unchanged, so the existing separate shadow entry stays registered. Final64sample opaque-purple luminance P10/P50/P90 is11.14/55.42/129.42 versus retained v1's27.34/58.83/133.84. The deepest canopy remains darker because of dense geometric occlusion; midtones/highlights now meet the reviewed range. R2 proof:`qa/r2-shadow-composite.png`.

Exact rebuild from repository root: `/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/frontier/blender/astra_vegetation_albedo_production.py`. Editable source:`blend/spreading-grove-r2.blend`. Runtime integration remains the coordinator's responsibility.

## Complete repeatable final rebuild chain

Run from the repository root with the retained source directories present. These commands rebuild foliage r2, rebuild the wide shadow from its exact retained r1 source blend, clean the shadow alpha, and refresh final metadata/checksums:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/frontier/blender/astra_vegetation_albedo_production.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/frontier/blender/astra_vegetation_shadow_wide.py
/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/frontier/blender/astra_shadow_qa.py
/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/frontier/blender/astra_vegetation_metadata.py
```

The shadow script intentionally reads`blend/spreading-grove.blend`, not the albedo-r2 blend. Preserve that original source. If regenerating it is necessary, run`astra_vegetation_production.py` with Blender before the chain above; that also retains its original narrow shadow experiment.

`astra_vegetation_metadata.py` performs no rendering and never writes image/blend files. It verifies768²RGBA, logical384², anchor[192,340],64samples and approved alpha bounds[110,266,689,746]; computes SHA256 and opaque-purple P10/P50/P90 with the same sampling rule used for qualification; refreshes retained checksum records; and checks that artwork bytes remain unchanged. It can be run alone after a final image already exists. Geometry drift fails explicitly for review.

Final in-app and performance qualification lives in`design/mission-frontier/build-evidence/VISUAL-FIDELITY/` and the coordinator's handoff. Historical staging “pending review” strings record the asset handoff boundary and are not the final product acceptance authority.
