# Rear walls r1 — pending coordinator scene review

One built-in ImageGen source created the wall-only inverted V using the registered floor and headquarters art references. No generated floor was present, so no floor painting or floor-removal reconstruction was needed. The RGB master and alpha master remain available. No corrective generation was used.

## Registration and inspection

- Export is 1536×1024 straight-alpha RGBA, logical 768×512; common floor anchor logical [384,422]. No crop/trim changes the shared canvas.
- The source walls had their feet too low and their height too large. Two joined deterministic affine face mappings register the contact slope and span and scale visible wall height by 0.78. The split is at export x768 and shares the same central mapping. `geometry.json` and `process.py` record all coefficients and measured source landmarks.
- Registered inner foot path, source/export pixels: left [96.1574,499.9213], rear [768,164], right [1439.8426,499.9213]. This is 24px inward from the floor's rear perimeter at each matching x. The thicker outer structural feet cover the perimeter; the inherited floor corner path remains [64,492] → [768,140] → [1472,492].
- Central top is approximately [768,54.02]; central visible wall height about110px. End piers are roughly98px high. Manual source landmark tolerance is approximately±3px.
- Visually inspected dark/light/magenta wall-only composites, the full floor-plus-wall composite, its registration overlay, and actual 768×512 logical display. Joined rear corner is coherent, the feet sit on the floor, and no obvious open gap or center split is visible. Floor remains unchanged beneath the export. Both front sides remain open.
- 85 contact samples at16px intervals find accepted-floor alpha two pixels below the wall bottom; zero unsupported contacts. This verifies coverage, not a mathematical reconstruction of every wall/floor seam. See `contact-coverage-r1.json`.
- Alpha range0–255, 1,417,870 fully transparent pixels and5,586 edge pixels. No nontransparent canvas-border pixels and no green-dominant visible pixels. The central foreground test rectangle x450–1050/y560–800 contains zero nontransparent pixels, consistent with the wall-only visual inspection.

## Scope and limits

Ceramic structural piers, slate interior panels and dim warm physical utility details match the supplied architectural vocabulary. There are no screens/text, stations, people/robots, props, semantic lights, roof or new floor pixels. Utility details remain baked physical appearance; they must not be treated as evidence of active work.

The shared footprint in `entry.json` is an alignment reference inherited from the floor, not a solid wall hit region covering the interior. Draw this layer behind workers/stations; use its separate attachment path for wall-specific placement. Foreground structure, roof and any internal room anatomy remain separate future assets. Full HQ fidelity and worker occlusion still require coordinator scene proof. This handoff does not claim acceptance.
