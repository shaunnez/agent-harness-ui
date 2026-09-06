# Base floor calibration r1 — pending coordinator scene review

One built-in ImageGen source was generated from the supplied headquarters material reference. No corrective generation. The original 1536×1024 RGB source is retained unchanged. The source platform was deeper than the required projection; authorized deterministic registration maps its four measured upper perimeter corners to the exact 2:1 target diamond. `geometry.json` and `process.py` retain the full mapping.

## Measurements and checks

- Export: 1536×1024 straight-alpha RGBA, logical canvas 768×512. 1,439,654 PNG bytes; 6,291,456 decoded RGBA bytes before mipmaps.
- Alpha range 0–255; 1,016,354 transparent pixels, 5,852 partially transparent edge pixels, no nontransparent border pixels, no green-dominant visible pixels after key/spill cleanup.
- Original top-rim corner intersections, source pixels, back/right/front/left: [767,51], [1508,460], [768,934], [29,461]. Manual visual measurement tolerance approximately ±3 source pixels because small manufacturing chamfers soften the apex.
- Registered top corners, export pixels: [768,140], [1472,492], [768,844], [64,492]. Logical equivalents: [384,70], [736,246], [384,422], [32,246]. The exact mapped landmarks do not mean every generated edge is mathematically straight; residual raster/edge variation is visible in the registration sheet.
- The assigned ground anchor [768,844] is the **front top-surface corner**, logical [384,422]. The visible bottom bevel front maps to [767.9494,878.8932], about 34.8932 export pixels / 17.4466 logical pixels below the surface anchor. Do not align worker soles to the bevel bottom.
- Inspected source corner markers, registered diamond overlay, dark/light/magenta alpha sheet and actual 768×512 logical display. No obvious green matte, detached fragments, scenery, clipping, cast ground shadow or semantic lights.
- Continuous walkable tiled surface with four open areas and low service grooves; no walls, roof, stations, props, workers, labels, counters or occupied task bays.

## Layer handoff

Use this registered export as the reference for back/front/roof generation. Preserve the 1536×1024 untrimmed canvas, top-surface corners and [768,844] reference anchor. The source-to-export transform is valid for this source only; a newly generated layer must be measured against this target, not assumed to inherit the old source pixel geometry. Keep future layer foot/bottom contact aligned with the registered top surface, while retaining authored elevation.

The dark interior versus pale perimeter supports the selected Mission Frontier material vocabulary. This is only a clean floor layer; base architecture, station occupancy, worker placement, edge occlusion and cross-view composition remain for coordinator integration review. No acceptance is asserted.

Reproduction: execute `process.py` with the bundled Python containing Pillow and NumPy. It performs chroma key/spill cleanup, one documented projective raster registration, and QA composition only; no geometry painting, inpainting or redraw. Metadata is provided separately in entry/provenance/checksum files.
