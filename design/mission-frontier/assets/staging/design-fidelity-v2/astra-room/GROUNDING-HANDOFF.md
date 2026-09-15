# Room ground contact — r1

Candidate `mf.fidelity.room.ground-contact` adds a compact weathered stone/gravel footing beneath the existing room slab. It uses the existing room camera and lighting, original procedural Blender geometry/materials, and no external assets or paid services. The original room layers, `entries.json` and `provenance.json` are unchanged; their SHA256 checks are recorded in the new QA report.

- Export: `renders/ground-contact.png`
- Separate entry: `grounding-entry.json`
- Source: `source/build_ground_contact.py`, `blend/ground-contact.blend`
- Measured geometry: `source/ground-contact-geometry.json`
- Static QA: `source/qa_ground_contact.py`, `qa/ground-contact-checks.json`
- Comparison: `qa/ground-contact-combined.png`, `qa/ground-contact-tiled-0.6.png`, `qa/ground-contact-alpha.png`

All dimensions and registration match the existing room: source **1536 × 1280**, logical **768 × 640**, anchor **[384, 522]**, room footprint **[[384,170],[736,346],[384,522],[32,346]]**. The apron ground surface is at world **z=-0.655**, just below the existing slab bottom **z=-0.60**. Small embedded stones intersect the slab underside and apron; the outer gravel skin has an irregular feathered edge and no raised rim. Only the slab casts contact shadow, received on the narrow apron. No external shadow-catcher plane or large shadow halo is included.

Draw **all contact surrounds before any room floors** using the room's exact position and scale, then retain existing back/entity/front ordering. This allows neighbouring contact patches to overlap beneath tiled rooms without painting over adjacent floors. The static tiled QA uses the requested **0.6 scale**. The same registration applies in Watch.

Verified true alpha, fully transparent canvas borders, source alpha bounds **[28,376,1509,1120]**, anchor source **[768,1043.999996]**. PNG is **692,923 bytes** and decoded RGBA is **7.5 MiB**. SHA256: `15817fbfd2181ad966c540fbf12278a9357b5e3b4711d50d386c8c3539360d2d`.

Rebuild from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python design/mission-frontier/assets/staging/design-fidelity-v2/astra-room/source/build_ground_contact.py
/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 design/mission-frontier/assets/staging/design-fidelity-v2/astra-room/source/qa_ground_contact.py
```

Blender 5.2.1 LTS, Cycles 48 samples with denoising, seed 915640, four render threads. The exported PNG has no post-render pixel edits; Pillow is used only for QA composition and metadata measurement. Integration, blend with the final meadow, and the user's visual acceptance remain builder-owned. No app, public assets or shared manifests were changed by the asset producer.
