# Contract 2.0 — environment pass visual gate (17 September 2026)

What Shaun asked to see before the interior pass: the accepted macro scene with water polish, cliff undercuts and
rock dressing, trees and vegetation, and crystals. World layout, HQ massing, bridge logic and camera framing are
unchanged from gate 1. Captures are headless Chromium (SwiftShader) against this worktree's dev server on port 5243,
`workflow` fixture, fixed hour 11 (day) and 20 (dusk), motion off; `colony-stress` for the ten-project world.

```sh
npm run dev:frontier -- --host 127.0.0.1 --port 5243 --strictPort
```

```sh
FRONTIER_BASE=http://127.0.0.1:5243/ node design/mission-frontier/build-evidence/COLONY-V2/capture-v2.cjs gate2
```

| Frame | What to judge | File |
| --- | --- | --- |
| World, day | Foam band along every shore, sand showing through the shallows, sun glints; PlanCheck and Agent Harness carry a stream, pool and fall on a camera-facing flank (MyStrataAssist has none); scanned cliff pieces and shoreline rocks break the coast; scrub, grass, reeds; violet crystal clusters | `gate2-world-day-1568x1003.png`, `gate2-world-day-1280x720.png` |
| Exterior, day | PlanCheck: spring pool with reeds, channel, fall over the front-right lip with churn rings and mist; cliff pieces leaning over the toe, wet dark band at the water line; large rock, boulders, scrub and tufts on the shoulder; a crystal cluster on the left shoulder | `gate2-exterior-day-1568x1003.png`, `gate2-exterior-day-1280x720.png` |
| Exterior and world, dusk | Fresh water and sea dim with the hour; crystals glow; windows, lanterns and bollards as before | `gate2-exterior-dusk-*.png`, `gate2-world-dusk-*.png` |
| Cutaway, day | Unchanged from gate 1 (interiors are the next pass) | `gate2-cutaway-day-*.png` |
| Stress, day | Ten parcels: six with streams, every parcel a different scatter, kit still one draw call per item mesh | `stress-world-day-*.png` |

## Against the brief

**Water.** Shared sea system kept (one shader, style 1 for the colony, style 0 keeps main's archipelago unchanged).
Shoreline foam: yes, a broken band that breathes in and out plus the wash lines. Shallow/deep transition: from a depth
channel in the shore texture, sand under the shallows to teal to deep. Surface movement: vertex swell plus a
wave-normal sun glint and grazing tint. Stream, pool and waterfall: seeded per slot on 60 % of project parcels
(spring pool on the highest ground of a camera-facing band, channel descending at least 6 cm/m, fall over a notched
lip); mist: two soft sprites at the foot, plus churn and rings in the sea.

**Cliffs and terrain.** Height field kept as the macro geology. Scanned pieces: three decimated Poly Haven coastal
cliff scans (CC0, from the accepted Astra environment), hung from the lip and leaning outward so they overhang the
face; five to seven per parcel, clear of built edges by 24 deg and of the fall by 16 deg. Silhouette: the pieces and
the shoreline rocks break the procedural coast. Rock clusters: two to three large rocks (cut from the scans), seven
to eleven boulders, six to ten shoreline rocks in the toe water. Wet treatment: kit rock darkens and goes glossy
below 1.6 m, matching the terrain splash zone; stream banks and beds are wet rock. Plateaus, aprons, spurs, pads and
bridge lines untouched (tested).

**Vegetation.** Purple language kept. Silhouettes: tall and slender, broad and low, and the seventh retained tree
recoloured purple (three new), plus a bare trunk (at most two per parcel). Scrub: purple and olive bushes, six to
ten; grass tufts fourteen to twenty-two; reeds at the pools, along the channel banks and on wave-cut shelves. Islands
are not overfilled: the copse count and arcs are the gate-1 rules.

**Crystals.** Three cluster variants (five, three and seven shards on a rock foot), two to four per project parcel at
a cliff shoulder, beside a large rock and at the spring pool; one `crystal_glow` material with a restrained emissive
that bloom lifts at dusk. Palette tinting per parcel is a step-8 item (the material is shared; the hook is the name).

## Known gaps to decide on at the gate

- Cliff pieces are three scans; from the world camera the far side of an island can show two of the same piece.
- The fall curtain is a convex sheet; seen almost edge-on (left-flank streams) it thins to a line and the churn and
  mist carry it.
- The pool rim is the 1 m terrain grid: soft, not a crisp stone edge.
- Grass and reeds are untextured blades (no alpha cards), which keeps the kit at six images.
- Kit is 5.8 MB of the 6 MB budget; colony set total about 22 MB of 25.
- Interiors and palette lighting not started (steps 7 and 8).
