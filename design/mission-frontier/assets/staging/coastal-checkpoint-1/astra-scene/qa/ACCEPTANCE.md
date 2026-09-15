# Final asset acceptance evidence

Status: ready for builder integration and final normal-scale World acceptance. Architecture/composition was approved by the builder; Astra has not claimed app, browser, publication or backend acceptance.

## Measured checks

- Seven required straight-alpha RGBA PNGs, each 2560×1920 source / 1280×960 logical, anchor [640,600].
- All hashes, byte counts, image dimensions, alpha bounds and transparent canvas edges verified. No footprint warnings.
- Terrain bounds relative logical: [-514.5,-359.5,577,293.5]. Base: [-233.5,-341.5,161.5,-21].
- Maximum measured socket error: 0.000076 logical pixels. Crossing width 42 logical pixels; final 70-pixel approach tapers to 26.4 at the unchanged join.
- Shore alpha overlap with opaque scene geometry: 0 pixels. Lights black-matte pixels: 0.
- Cutout qualification: 614×1209 base matte outside the base footprint, alpha max 0 and nonzero alpha 0. Camera holdouts preserve original non-camera lighting; 64 transparent bounces avoid foliage-stack termination.
- Packed blend: all 4 file-backed textures embedded. Main terrain 2356 faces and far terrain 992 faces have zero downward normals. Five fixed court fixtures clear the protected patrol region.
- Exact raster EDT independently checked against two analytic seeds: max error 4.745102888e-07 grid pixels. World grid spacing 0.01719026143; conservative rock-waterline approximation is documented in HANDOFF.md.
- Final separated composite visually inspected on a light background: no black floating piers or foliage residues. Canonical transparent pixels discard invisible RGB render dither.

## Final files

| ID | File | SHA-256 | Bytes |
|---|---|---|---|
| mf.coastal.terrain | `renders/terrain.png` | `c49c5f61b8c2e7196b2fe374a71ce4bdddabc4c7eca87d6da6a8ffd8ce68396d` | 2142776 |
| mf.coastal.base | `renders/base.png` | `084fcde0cabaaa68b4f76ddac8195bca62ca71c3951fe24b2394b3d4917760ca` | 498377 |
| mf.coastal.bridge | `renders/bridge.png` | `36441a90b2a5c80b92902f3799bedcd3e20586480b447cb3ff2c397beb04cac5` | 149692 |
| mf.coastal.front | `renders/front.png` | `0307198f323f84c183c52e6ecb3fd6bd85fa7beb2ce1faec9fd85870a8015e33` | 26644 |
| mf.coastal.lights | `renders/lights.png` | `4f00bf3fc82c921fca5d7260c2ecb19dd7a52248b4c031cbdbae58bfbf4060c3` | 25059 |
| mf.coastal.shallows | `renders/shallows.png` | `af15c065afe0caaf4dd10d6e974fe6051db80d3c4b940655ade358b0e5d618cb` | 230694 |
| mf.coastal.shore | `masks/shore.png` | `c1048aea28311c3338ea12aff5f543ba8a45451e9fecfb710e27e5d174793804` | 260342 |

Packed source: `blend/coastal-detailed.blend`, SHA-256 `64358d442c38a24c2476f7a660fb567e29e8503433996b93fe21ef06b6869b0a`.

Primary evidence: `registration-audit.json`, `static-qa.json`, `blend-audit.json`, `cutout-holdout-calibration.json`, `terrain-normal-correction.json`, `assembled-light.jpg`, `assembled-dark.jpg`. Reproduction, source provenance, mask encoding and exact keep/exclude guidance are in `../HANDOFF.md`.

Astra changed only the assigned astra-scene subtree. The builder owns product integration and final UI/shader evidence.
