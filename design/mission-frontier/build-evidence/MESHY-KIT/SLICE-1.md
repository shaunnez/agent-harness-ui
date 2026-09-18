# Meshy scatter kit — slice 1 evidence

Ten Meshy scans substituted into existing Contract 2.0 scatter slots, compressed with Draco geometry
and WebP textures. Item names, metre heights and anchors are unchanged, so `scatter.ts` placement
rules and the seeded per-project layout were not touched.

## Compression probe

One model (`tree.pinkCoastal.A`, the heaviest at 20.6 MB / 174,834 triangles) was exported across
four triangle targets, three texture sizes and both compression options, then rendered from a fixed
camera and compared by eye. Probe script: `assets/staging/meshy-kit/source/probe_one.py`.

| Setting | Bytes | Verdict |
| --- | --- | --- |
| Source, 4K maps, 174,834 tris | 20.60 MB | reference |
| 20k tris, 1024px, Draco + WebP | 1.14 MB | no visible difference |
| 20k tris, 512px, Draco + WebP | 0.52 MB | no visible difference at scatter camera range |
| 8k tris, 1024px, Draco + WebP | 0.96 MB | **rejected** — canopy develops holes, silhouette thins |

Textures dominate these files, so texture format is the larger lever: WebP alone takes the 20k/1024
export from 6.95 MB to 2.12 MB, and Draco halves it again to 1.14 MB. Foliage is the binding
constraint on decimation; solid rock and cliff bodies hold their form far lower, so those slots use
6k–12k.

## Kit result

| Measure | v2 kit (procedural) | v3 kit (scanned) | Budget |
| --- | --- | --- | --- |
| Bytes | 5,845,124 (5.57 MiB) | 4,191,976 (4.00 MiB) | 6,000,000 |
| Triangles | 58,750 | 157,306 | 90,000 → **exceeded** |
| Images | 6 | 40 | 8 per file → **exceeded** |

Cold transfer including the one-time Draco decoder (188 KB wasm + 56 KB wrapper, shared by every
compressed asset and served from `public/frontier/decoders/draco`, not a CDN):

- v2 kit: 5.573 MiB
- v3 kit + decoder: 4.238 MiB
- **Net −1.335 MiB**, measured uncached in the browser

Against the recorded 18.60 MiB cold load and its 20 MiB target, headroom moves from about 1.40 MiB
to about 2.74 MiB.

## Two budgets now exceeded

Both were written for authored procedural geometry and neither has a recorded rationale tied to a
device or a measurement:

- **Triangles, 157,306 against 90,000.** Scanned bodies legitimately need more geometry than
  parametric ones; decimating foliage far enough to fit visibly destroys it (see the 8k row). The
  validator gained a `scatterKitScanned` budget defaulting to 180,000 for this kind.
- **Images, 40 against 8.** Each scan carries its own baked PBR set and cannot share a UV layout
  with the others, so the shared-atlas assumption behind the ceiling does not hold. The ceiling is
  now per-kind, 48 for `scatter3`.

Neither is a resolved question. Atlasing the scanned set would address both and has not been
attempted.

## Measurements and their limits

- Dev build, embedded browser, Apple M5, 1440x900, dusk exterior: **59.7 FPS**, which is the vsync
  cap rather than a headroom figure.
- This is **not** the formal performance gate. That gate is a production build against the
  normal/stress fixtures, and it has not been re-run for this change.
- Texture residency was not re-estimated. 40 WebP images at 512px decode to roughly 40 MiB RGBA,
  which is new resident cost against the 192 MiB target and needs measuring before this is qualified.

## Checks

Typecheck, lint and format pass. 155 Frontier tests pass, zero failures. The v2 kit, HQ shell and
crowns still validate unchanged through the uncompressed path.

## Validator changes

- Draco primitives are accepted for scatter kinds only. glTF keeps `count` on the index accessor and
  `min`/`max` on POSITION when the bufferView is dropped, so triangle totals and bounds stay
  checkable without a decoder. The per-vertex sweep cannot run on compressed geometry, and the kinds
  that need it — shell, crown, parcel, bridge — still require uncompressed geometry.
- WebP dimension parsing added alongside PNG and JPEG (VP8, VP8L and VP8X).

---

# Slice 2 — the transport on the landing terrace

Contract 2.0 already reserved this spot: `interactionSockets.spaceport_pad` (centre [0, 4.25, 0],
radius 14) and slot H, "landing terrace: shared shuttle pad on a small rocky spit". Both notes add
"shuttle itself is Goal 6 scope", so placing it now is ahead of the contract's own staging. The pad
rendered as bare ground until this change — the greybox calls it `empty_landing_pad`.

`spaceship.transport.A` is a hero object, not a kit item: it is seen at close range from the exterior
camera, so it keeps 1024px maps where scatter pieces drop to 512, and it is published as its own GLB
rather than folded into the kit.

| Measure | Value |
| --- | --- |
| Source | 16.0 MB, 114,008 triangles, four 4K maps |
| Published | 0.89 MB, 24,000 triangles, four 1024px WebP maps, Draco geometry |
| Size | 11.98 m long, 7.52 m wide, 3.94 m tall |

Placement checks, read from the published GLB against the contract:

- Landing gear contact plane at y = 0.007, so it stands on `padTop` with no per-scene offset.
- Furthest extent 10.80 m from the pad centre against a 12 m pad radius, offset 3.2 m and turned
  −0.42 rad so it reads as parked rather than centred and square.

Scale was judged against a 1.8 m reference figure on a 12 m pad disc before the length was fixed.

The shuttle is scenery. It reads no task or run state, and nothing about it encodes status.

## Not done

- No close-up in-app capture of the shuttle on the terrace. The World view uses fixed framing and
  will not push the camera onto the hub parcel, and the hub is not a project so it has no exterior
  view. Placement above is verified numerically and in an isolated render, not in the running scene
  at close range.
- Texture residency still not re-estimated across both slices.
- The formal production-build performance gate has not been re-run.
