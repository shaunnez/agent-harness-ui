# Accepted exterior geometry —64sample production

`entry.json` supplies`renders/exterior.png`:1536×1280 straightRGBA, logical768×640, groundAnchor[384,522]. Top alpha margin30source pixels. Full perimeter facade reaches floor z=0; entire exterior shell is removed in HQ. The retained v1 floor/back/front remain independent. No geometry or anchor changes were made after actual World acceptance.

`geometry-check.json` compares all346mesh objects, vertex coordinates, world transforms and polygon membership with the accepted24sample `.blend` (polygon ordering normalized). `qa/retained-v1-interior-composite.png`, `qa/overview-comparison.png` and`qa/roof-alpha.png` provide native/scale/alpha evidence. Root owns final in-app and payload qualification.

Editable source:`blend/exterior.blend`. Exact rebuild from repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python /Users/shaun/.codex/worktrees/7237/agent-harness-ui/scripts/frontier/blender/astra_exterior_production.py
```

Cycles64samples, denoising,4CPUthreads, fixed30°elevation/45°azimuth and unchanged warm lighting. QA uses`astra_exterior_production_qa.py`; geometry comparison uses`astra_exterior_geometry_check.py`.

Imported assets are16WallAstra modules (Straight and Straight_Window),2Door_Frame_Square meshes, and their publisher trim diffuse/normal/roughness textures. Every source path and placement is recorded in entry. Free Standard Quaternius CC0 licence, archive SHA and public acquisition evidence remain under sibling`sources/`; prepared glTF copies only resolve texture URIs. Preserve that source directory with the editable blend because publisher images are referenced there. Drum terraces, segmented shells, glazing supports, plenum details and dish assembly are agent-authored Blender geometry. `checksums.json` records the production PNG/blend/entry.
