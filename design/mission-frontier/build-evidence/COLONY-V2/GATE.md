# Contract 2.0 — macro-composition visual gate (17 September 2026)

What Shaun asked to see before interiors, lighting polish or dressing: irregular parcel chain + water + bridges, the new
HQ massing, and corrected camera framing. Captures are headless Chromium (SwiftShader) against this worktree's dev
server on port 5243, `workflow` fixture, fixed hour 11 (day) and 20 (dusk), motion off. Reproduce:

```sh
npm run dev:frontier -- --host 127.0.0.1 --port 5243 --strictPort
```

```sh
FRONTIER_BASE=http://127.0.0.1:5243/ node design/mission-frontier/build-evidence/COLONY-V2/capture-v2.cjs gate
```

| Frame | What to judge | File |
| --- | --- | --- |
| World, day | Chain of three rocky parcels through the centre cell, landing terrace off to the side, 27 m bridges over 25 m channels, land bleeding off the frame, labels clear of the HUD | `gate-world-day-1568x1003.png`, `gate-world-day-1280x720.png` |
| Exterior, day | New massing: five stepped arc bays (8.6 to 11.6 m), set-back tiers, hub drum to 13.8 m, crown, framed warm windows, spines, roof equipment, bay canopy; camera span 46 | `gate-exterior-day-1568x1003.png`, `gate-exterior-day-1280x720.png` |
| Exterior, dusk | Warm windows, tier clerestories, lanterns and bollards lit | `gate-exterior-dusk-1568x1003.png`, `gate-exterior-dusk-1280x720.png` |
| Cutaway, day | Roof and front bays hidden, six rooms (interior unchanged from 1.0.1), fit fills about 75–80 % of frame height | `gate-cutaway-day-1568x1003.png`, `gate-cutaway-day-1280x720.png` |

## Against the success criteria

1. World no longer reads as a circular strategy map: chain lattice, irregular coasts, cliffs, outcrops, no ring road. **Yes.**
2. Base no longer reads as a flat hex block: curved stepped bays and a drum; the hex survives only as the room plan. **Yes, first pass.**
3. Rocky parcel and bridge composition restored: one land mass per parcel with cliffs to the water, spurs to pads, 27 m spans. **Yes.**
4. HQ silhouette more premium and modular: better; roofs and facades still want detail (item 2 polish after the gate).
5. Framing tighter and more cinematic: world frames the bases and lets coasts run off; exterior span 58 → 46. **Yes.**
6. Cutaway fills the frame better: about 75–80 % of frame height at both sizes (was 60 %). **Yes.**
7. Each room has clear identity: **not started** (item 4, after the gate).
8. Palette lighting: **not started** (item 5, after the gate).
9. Closer to the original concept than 2A: the archipelago, bridges and bay massing are back; water still lacks foam and the rock lacks scanned undercuts.

## Known gaps to decide on at the gate

- Water is the 2A shader with a tighter shallow band; no foam lines or waterfalls yet.
- Cliffs are a height field: steep and stratified but no overhangs; scanned cliff pieces would add undercuts.
- The landing terrace is a plain pad; markings and the shuttle are later scope.
- Label pile-up in the cutaway at 1280 × 720 is the 2A separator; unchanged.
- Bridge span and end are the unchanged 1.0.1 assets.
