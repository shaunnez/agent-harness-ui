# Front cutaway r1 — pending coordinator scene review

One new built-in ImageGen source produced two disconnected low ceramic/slate parapet segments. The wide front entrance, floor and other architecture remain independent. Original source and alpha master retained; no corrective generation needed.

## Visible result and worker check

- Front structure matches the accepted rear layer's white ceramic and dark steel vocabulary. Low parapets and gate-end piers keep the central floor open. No front-spanning beam/threshold, roof, internal partition, floor, stations, props, text or people are included.
- Inspected the complete floor/back/front composition at768×640 logical size, alpha on dark/light/magenta and two58px worker positions. Both workers remain identifiable: worker in the central opening is fully visible; deliberately placing another behind the left parapet retains68.18% of its alpha silhouette, with head/upper torso visible.
- `two-workers-occlusion-r1.png` also shows30% front opacity as a labelled QA example for selection handling. The asset does not implement fade or state logic; the coordinator owns any selected-worker occlusion behavior.
- Gate tips leave over530 source pixels of clear width between the two structures. The conservative central core rectangle[506,780,1030,1150] has zero nontransparent pixels. Three very-low-edge pixels enter a wider test rectangle near a gate tip; these are recorded instead of falsely reporting perfect transparency at the antialiased boundary.

## Geometry and alpha

- Export1536×1280 straight-alpha RGBA; logical768×640, inherited anchor[384,522]. Same front-relative floor corners as backr2; do not align by cropped bounds.
- Source master1374×1145. Independent affine registration maps generated left/right source spans[53,486] and[893,1323] to target[64,500] and[1036,1472]. Height scale0.90 gives approximately85–90px low panels and100–113px gate/outer piers. Coefficients and source foot-line measurements are retained in `geometry.json`.
- Both wall feet register along the front floor-edge directions; thick gate piers have their own inboard return faces. Source manual measurements have approximately±3px tolerance.52 contact samples found floor alpha at least128 two pixels below the wall; no unsupported contacts.
- Alpha0–255;1,884,185 fully transparent pixels,4,629 partial-alpha pixels. Zero visible green-dominant pixels or nontransparent canvas borders. PNG236,367 bytes; decoded RGBA7,864,320 bytes before mipmaps.

## Integration limits

Render this foreground layer after workers. Its common footprint is a shared alignment reference, not an opaque hit area over the whole floor. Two disconnected part rectangles are recorded so the renderer can fade only an occluding part if desired; no separate generated asset ID was introduced. A worker deliberately placed very close behind a gate pier could be more hidden than the tested near-parapet position, so placement/selection treatment still belongs to scene integration.

Final HQ fidelity, live labeling, interaction and occlusion acceptance remain with the coordinator. No original floor/back/worker files were changed.
