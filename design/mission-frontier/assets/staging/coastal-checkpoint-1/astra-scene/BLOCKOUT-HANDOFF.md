# Coastal checkpoint 1 — assembled blockout

**Awaiting builder composition feedback. No detailed material production started.**

`renders/blockout.png` shows the assembled massing with an ocean datum. `renders/blockout-transparent.png` excludes the global ocean plane and is suitable for temporary composition review at the exact existing World camera. It is historical calibration art, not a final runtime layer.

Use logical **1280 × 960**, source **2560 × 1920**, anchor **[640,600]**, scale **1** at the featured project origin. Actual measured anchor is [640,599.999971]; ground basis per Blender world unit is **X[-32.000008,16.000014]**, **Y[31.999969,16.000014]**, vertical **Z[0,-39.191837]** logical pixels. All four supplied route sockets match within **0.00008 logical pixels**. Camera, lights, Blender coordinates and requested/measured socket values are retained in `qa/blockout-calibration.json`.

The base is a stepped ceramic/steel mass behind an open courtyard. A continuous approach runs to an elevated deck over a real inlet, then reaches a separate rocky abutment and route spur. Deck top is world z=0; ocean top is z=-2.82. The court preserves both task-worker points and all points in the two existing World ambient patrol loops. Purple crowns and the rooftop dish are explicitly composition proxies; facade/terrain materials are blockout swatches.

Known calibration issues for review:

- Terrain left bound **-618.69** exceeds proposed **-600** by 18.69 logical px. It is inside the image canvas.
- Base left bound **-227.12** exceeds proposed **-225** by 2.12 px; roof/dish top **-340.90** exceeds proposed **-310** by 30.90 px.
- Main approach overlaps the court at exactly the same plane, producing a black coplanar patch. Before detail, trim approach geometry to the court boundary while retaining the entrance socket on the continuous court surface.
- Terrain tiers are coarse massing and use large planar faces. Final cliffs, relief, vegetation and facade detailing remain pending composition acceptance.

Transparent preview: 3,126,985 bytes; source alpha bounds [42,395,2437,1797]; every outer canvas edge is transparent. SHA256 `6f5960600c069d7032979b3d71e08eb06176de75f975c5cc47bfed44b931c1d2`. See `qa/blockout-preview-entry.json` and `qa/blockout-registration.png`. No final `entries.json` exists yet, so this preview cannot be mistaken for a complete accepted layer manifest.

Sources: `source/blockout.py`, `source/preview_blockout.py`, `source/qa_blockout.py`, `blend/coastal-blockout.blend`. Rebuild sequentially with Blender at four threads, then bundled Pillow Python for QA. The assembled render is Cycles 32 samples; transparent preview 16 samples, both denoised. No paid tools, external acquisitions, workers, labels, task states or artifacts are baked into this art. Shared contract, app, public manifests and journal remain builder-owned.
