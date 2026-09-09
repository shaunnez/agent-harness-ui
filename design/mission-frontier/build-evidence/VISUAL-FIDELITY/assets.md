# Goal 3 asset handoff

Runtime revision `cinematic-v1-final`, status `qualified-in-app`. Canonical new manifest: `public/frontier/assets/cinematic/manifest.json`; 21 content-hashed PNG entries, all source hashes, dimensions and provenance paths verified, with no orphan PNG files. The 35 base entries remain available. Their image bytes are retained; artifact/cargo hit bounds were corrected in metadata only.

Use `?mode=fixture&art=cinematic#world`; the oldest-created project receives the new island deterministically (PlanCheck in the standard fixture). `art=classic` or removing `art` restores the prior presentation. No persisted task state or user preference is changed by this URL. New and old detail backgrounds are demand-loaded. The new water replaces the initial old water load.

## Production and provenance

Blender 5.2.1 LTS, fixed 30-degree elevation / 45-degree azimuth orthographic 2:1 projection, 2× source raster density, Cycles with denoising and AgX. Water is a top-down tile and is explicitly recorded as such. Root environment uses 72 samples, seed 602617 and four CPU threads; Astra exports use 64 samples. Common upper-left warm light comes from +10,-6,+16. Ground anchors and logical sizes are recorded per entry; no scene-wide invisible hotspot image was introduced.

Both free Standard packs were acquired from the publisher on 6 September 2026. Source evidence is under `assets/staging/cinematic-v1/astra/sources/` relative to the design pack. Retain archive files, acquisition.json, publisher HTML, licences and imported texture directories.

| Pack | Archive SHA256 | Actual ingredients |
| --- | --- | --- |
| Quaternius Modular Sci-Fi MegaKit, CC0 | 6fae60cf5189e44dff0bd91097f094a765acc6d57d64a85a0cc0dd56e03035e3 | 8 WallAstra_Straight, 8 WallAstra_Straight_Window, 2 Door_Frame_Square; publisher trim textures |
| Quaternius Stylized Nature MegaKit, CC0 | 298f6732b872e4cf7b30e6e7abf9641c7f6dc6b326df37ac089533ed7e3d58c9 | TwistedTree_3, TwistedTree_5, Bush_Common; Rock_Medium_1/2/3 |

Publisher sources: https://quaternius.itch.io/modular-sci-fi-megakit and https://quaternius.itch.io/stylized-nature-megakit . No paid edition, donation or asset purchase was made. Invalid Sci-Fi glTF texture URI references were repaired in derived prepared copies; publisher originals remain unchanged. Worker geometry, landscape mesh, bridge composition and observatory drums are custom procedural Blender work.

## Final sources

All following directories are below `design/mission-frontier/assets/staging/cinematic-v1/`:

- `environment/final/`: island, water, bridge and bridge-se .blend/.png/.json. Island is 2048×1536, logical1024×768; anchor[511.999969,372.016205]. Coast is irregular, with continuous dense topography, 510 staggered cliff rocks, gravel and meadow patches. Water is1024² with a periodic material/crop calibration; bridges1024×768 use physically rotated geometry rather than mirrored lighting.
- `astra/exterior-production/`: `blend/exterior.blend`, `entry.json`, `renders/exterior.png`; 1536×1280, logical768×640, anchor[384,522]. 18 imported facade pieces support three observatory drums and dish. Final64-sample geometry matches the qualified24-sample calibration. Closed wall mass fixes the earlier floating cavity.
- `astra/production/`: `blend/worker-production.blend`, entries/checksums/worker-metadata and QA. Idle,12distinct100ms work frames and portrait at384², logical192². Body/feet stay registered; probe excursion is<=2.0611logical px. Portrait anchor is centre[96,96], worker ground anchor[96,167].
- `astra/vegetation-production/`: use `entry-r2.json`, `renders/spreading-grove-r2.png`, `blend/spreading-grove-r2.blend`. 768², logical384², anchor[192,340]. R2 changes leaf albedo without geometry or shadow-registration changes. Keep original r1 blend because the exact wide-shadow render reads it.
- Grove shadow: `shadow-entry.json`, `renders/spreading-grove-shadow-final.png`, source`blend/spreading-grove.blend` (r1),1536×768,logical768×384,anchor[384,340]. Independent physical Cycles catcher; 12 alpha noise subtracted and16px edge feather; all edges zero. Raw render retained. Metadata now identifies the actual source blend.

The 12 worker frames stay as independent small textures (about1.39MiB total worker PNGs) rather than introducing a new packed atlas. Frame swaps reuse cached textures. This bounded choice stays below the measured memory/transfer limits; existing v1 atlases and their non-rotated registration remain intact. The maximum new raster dimension is2048. Source archives and .blend files are outside public/ and never transfer to the browser.

## Rebuild

Run from the repository root. Preserve source trees; the export scripts are not an acquisition substitute.

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --threads 4 --python scripts/frontier/blender/environment.py -- --asset island --quality final
/Applications/Blender.app/Contents/MacOS/Blender -b --threads 4 --python scripts/frontier/blender/environment.py -- --asset water --quality final
/Applications/Blender.app/Contents/MacOS/Blender -b --threads 4 --python scripts/frontier/blender/environment.py -- --asset bridge --quality final
/Applications/Blender.app/Contents/MacOS/Blender -b --threads 4 --python scripts/frontier/blender/environment.py -- --asset bridge-se --quality final
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/frontier/blender/astra_worker_production.py
/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/frontier/blender/astra_worker_qa.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/frontier/blender/astra_vegetation_albedo_production.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/frontier/blender/astra_vegetation_shadow_wide.py
/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/frontier/blender/astra_shadow_qa.py
/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/frontier/blender/astra_vegetation_metadata.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/frontier/blender/astra_exterior_production.py
/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/frontier/blender/astra_exterior_production_qa.py
node scripts/frontier/integrate-assets.mjs
node scripts/frontier/integrate-cinematic.mjs --final
npm run build:frontier
```

The metadata refresh was added and run twice against the final grove image: idempotent output, unchanged image/blend bytes, validated measured alpha bounds and luminance. Package HANDOFF files retain prerequisites and calibration/rejected versions. Initial dome/slab, dark vegetation, narrow/noisy shadow and early terrain experiments remain evidence, not runtime assets.

Remaining review limits: fixed light/camera; clean new worker materials beside weathered v1 interiors; broad asset replacement is deferred. In-app qualification is this folder's acceptance record, not historical pending-review text in staging metadata. Any new geometry, scale or light change requires fresh in-app qualification.
