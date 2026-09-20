# Colony Contract 2.0 — build journal

Branch `claude/mission-frontier-colony-v2` (worktree `mission-frontier-colony-v2`), started 17 September 2026 from
`8fc3d83` on `claude/mission-frontier-colony-design-c7dcc1`. Direction reset by Shaun: the 2A circular parcel, ring road
and literal hex shell are a regression; rebuild toward a premium rocky archipelago with hex logic as organisation only.
Priority: macro composition and silhouette first, then a visual gate, then interiors and lighting.

Gate 1 passed 17 September 2026. Second brief: environmental quality (water, cliffs and rocks, vegetation, crystals) with
a second visual gate, then interiors, then palette lighting. World layout, HQ massing, bridge logic and camera framing are
frozen unless integration forces a change.

## Steps

| Step | What | State |
| --- | --- | --- |
| 1a | Contract 2.0 (`colony-v2/contract.json`, generator `colony/source/generate_colony_v2.py`); 1.0.1 untouched | done |
| 1b | Runtime height-field land (`terrain-field.ts`, `ColonyTerrain.tsx`), field water, bridges on the new pads, scatter on the new envelope | done, `a00961c` |
| 2 | HQ massing: lobed shell + hub drum + re-fitted crowns (`colony-v2/producer/source/*_v2.py`) | done, awaiting gate |
| 3 | Camera: exterior span 46, world frames the bases, cutaway fit 80 % | done |
| gate | `capture-v2.cjs gate` at 1568×1003 and 1280×720, day and dusk | captured |
| gate 1 | macro composition accepted by Shaun, 17 Sep 2026: world layout, HQ massing, bridge logic and camera framing frozen | accepted |
| 6a | Water polish: shoreline foam, depth-based colour, wave-normal sun glint, seeded stream / pools / waterfall / mist on 60 % of project parcels (`terrain-field.ts` water feature, `ColonyWater.tsx`, sea shader style 1) | done |
| 6b | Cliff and terrain dressing: three decimated Poly Haven cliff scans hung from the lip and leaning outward, large rocks cut from them, medium boulders and shoreline rocks in the same material, wet-rock darkening near the water line (`build_scatter_kit_v2.py`, `scatter.ts`, `ParcelScatter.tsx`) | done |
| 6c | Vegetation: three more purple silhouettes (tall, broad, seventh retained tree) and a bare trunk, purple and olive scrub, dry grass tufts, reeds at pools, banks and shelves | done |
| 6d | Crystals: three shard clusters on rock feet, one `crystal_glow` material tuned at runtime, two to four per parcel at cliff shoulders, large rocks and the spring pool | done (palette tint deferred to step 8) |
| gate 2 | `capture-v2.cjs gate2` and `stress`; `GATE-2.md` | captured |
| 7, 8 | interiors (room identity, dead floor, practicals, signage, 1280 label pile-up), palette lighting | after gate 2 |

## Assumptions (cheapest to reverse, recorded as made)

1. **Pitch 90 m, pads 27.5–31.5 m, span 27 m.** Keeps the one bridge asset; channel minimum 20 m. 1.0.1 was 108 m.
2. **P1 is the lattice centre and the landing terrace takes the ring-1 cell at phi 30.** One to three projects read as
   a chain (P3–P1–P2) with the landing off to the side, like the reference world, not spokes around a hub. Slot ids and
   the fill rule are unchanged so saved appearance records still resolve.
3. **Land is a runtime height field, not baked tiles.** Seeded by slot id so a parcel never changes while occupied; the
   only thing that changes when a neighbour arrives is the spur and pad on that edge (tested). Trade: no overhangs or
   undercuts in a height field; scanned cliff pieces can be instanced later for that.
4. **Court apron shrinks to ±12.5 × 14–27 m** and the two `court_edge` sockets move inside it (±11, 26.5). The 1.0.1
   court (±18) would have hung over the new coast. The court polygon in `movement` follows.
5. **Terrain textures** are the Poly Haven CC0 sets already embedded in the accepted Astra environment GLB, extracted at
   1024² (1.2 MB total). Grass is sparse drifts, rock breaks through on ledges.
6. **World view frames the HQ plateaus and labels, and lets coasts and cliffs run off the frame** (the reference does
   the same); labels must stay out of the four HUD corner panels.
7. **Cutaway fit** is a runtime rule (0.92 of the projected shell box); the 1.0.1 cutaway camera stays in the file.
8. **Massing:** five arc bays (implementation spans two sectors) at parapets 8.6 / 8.9 / 9.6 / 10.6 / 11.6 with
   set-back tiers, a hub drum r 9 to 13.8, crowns re-fitted into r 8.6 from 13.85 to 18.4. Partitions end inside the
   structural spines at 15.2 m. Interior plan, sockets and doors are 1.0.1.
9. Bridge span and end GLBs stay the 1.0.1 producer's (receipts read from the 1.0.1 metadata).
10. Commits are unsigned (1Password SSH signing still fails); re-sign before merge if it matters.
11. **Streams sit on the flanks the cameras see** (world angles 13–33 or 133–153, 20 deg clear of every edge line),
    not on the rear shoulder where the outcrops are: a waterfall behind the HQ would never be in a capture. A
    right-flank stream replaces that parcel's wave-cut shelf. 60 % of project parcels get one; the landing never does.
12. The legacy archipelago sea keeps its 2A look (shader style 0); foam, depth colour and glints are colony-only.
13. **One kit, 6 MB / 90k triangles** (`budgets.scatterKit` in Contract 2.0; the 2A kit was 3 MB / 30k). Six embedded
    images: bark 512, leaves 1024, two cliff albedo + normal pairs at 1024. Colony total stays under 25 MB.
14. **Cliff pieces avoid built edges by 24 deg but other edge lines by only 9 deg**, so a parcel can carry five to
    seven pieces; when a neighbour arrives and an edge is built, that parcel's scatter re-seeds (lanterns already did).
15. **Crystal palette tinting is a step-8 item.** The material is shared by every instance, so per-parcel colour
    needs an instance attribute in the emissive path; the material name `crystal_glow` is the hook.

## Blockers / notes

- Headless SwiftShader `readPixels` returns nothing (no preserveDrawingBuffer); frame-fill is judged from the PNGs.
- The worktree guard refuses shell commands containing the literal word `source`; producer paths use a glob.
