# Colony slice 2A — journal

Overnight run, 16–17 September 2026, lead on Fable. Decisions are in `design/mission-frontier/colony/SLICE-2A-DESIGN.md` (final section). Evidence captures are produced by `capture-2a.cjs <step>` against a Frontier dev server on port 5243.

## Step 0 — flag gate `?colony=1`

- `colonyRequested(search)` and `withoutColony(manifest)` in `model.ts`: without the flag the published v3 manifest is consumed as v2 (colony section dropped, legacy `bases`/`scene` kept), so the asset requests, layout, cameras, lamps and workers all take the pre-colony path.
- `layout.ts` gained `archipelagoBases` (main's staggered coastal grid, no slots) and `viewCamera(..., legacy)` (manifest cameras plus the archipelago world fit). `ProjectBase.slot` is now optional; `occupiedSlots` filters it. `ProofCamera` keeps the archipelago minimap when legacy; `ProofLabels` takes the base label anchor as a prop (manifest socket for legacy, contract anchor for the colony).
- Test: "without ?colony=1 the v3 manifest is consumed as v2 and the archipelago layout is unchanged". 140 Frontier tests, typecheck, lint, format pass.
- Evidence: `step0-legacy-{world,exterior,cutaway}-*.png`, `step0-colony-world-*.png`, `measurements-step0.json`. Legacy fetches only the archipelago kit; the colony fetches shell, crown, bridges and parcels (15.35 MB).
- **Headless limitation:** the legacy Exterior view renders as a blank canvas under SwiftShader (world and cutaway render). Checked in the desktop browser: the exterior renders correctly with the island, base and workers. Recorded as a capture-tool artefact, not a defect.

## Step 1 — robot scale 2.5× / 1.4× / 1×

- `model.ts`: `ProofView` ("world" | "exterior" | "cutaway"), `proofView(input, focusId)`, `workerViewScale = { world: 2.5, exterior: 1.4, cutaway: 1 }`, `workerScale(view)`, `workerHeight(view)`. `ProofWorker` scales the body, the attention ring, the work light and therefore ray picking by the view factor; the group origin stays at the true standing point so allocation, spacing (3.3 m at 1×) and roam speed in world units are unchanged. `ProofLabels` lifts task cards by the scaled robot height.
- Test: "robots render 2.5x in World, 1.4x on a focused exterior and true size in the cutaway". 141 Frontier tests, typecheck, lint, format pass.
- Evidence: `step1-{world,exterior,cutaway}-*.png`, `measurements-step1.json`. World robots now read as figures beside the HQ rather than specks; exterior robots stand about a storey tall against the bay; cutaway unchanged.
- Also captured the **step 2 baseline** before touching cards: `step2-before-cutaway-*.png`, `measurements-step2before.json`. At 1280 × 720 with fourteen tasks: 5 overlapping card pairs, COL-001 covers a HUD panel, 8 of 14 cards clickable at their centre. At 1568 × 1003: 0 overlaps, 14 of 14 clickable.

## Step 2 — crowded cards (criterion 4)

- `compactWorkerLabels` in `model.ts`: once a room (or a focused exterior court) shows more than four cards, every plain "Working"/idle card collapses to a 24 px dot marker; attention (answer, approval, repair, failed, blocked, ready), selected and watched robots keep full cards. Markers keep the full `aria-label`, gain a `title` tooltip and stay pickable; selecting one expands it. `ProofWorld` renders `data-compact`, `proof.css` styles the marker.
- `labels.ts` placement rewritten from a greedy walk to a slot search: upward slots nearest the anchor first, then the nearest free slot below, then a fallback that covers no HUD panel and the fewest cards. The old clamp piled cards on the top edge whenever the selection panel blocked the downward walk.
- `ProofLabels` refreshes its HUD obstacles immediately when the selection or Watch target changes (the selection panel appears in that commit) and now treats the world clock text as an obstacle: a marker parked above the world-time panel was sitting under the clock's date text and could not be clicked.
- Tests: "crowded rooms collapse plain working cards…", "a card that fits nowhere covers another card before it covers a HUD panel". 143 Frontier tests, typecheck, lint, format pass.
- Evidence before/after at both sizes: `step2-before-cutaway-*.png` / `step2-after-cutaway-*.png`, `measurements-step2before.json` / `measurements-step2.json`. 1280 × 720, fourteen tasks: before 5 overlapping pairs, 1 card over a panel, 8/14 clickable; after 0 overlaps, 0 over panels, 0 outside the viewport, **14/14 clickable at their centre**. 1568 × 1003: 14/14 before and after. The pick harness now waits for the card layout to settle before clicking (SwiftShader frames are slow) and clicks each task in turn, so every click happens with the selection panel open.

## Step 3 — four crowns on one shell, four-tile picker

- Producer (`producer/source/build_crowns.py`, wired into `build_hq.py -- relay foundry bastion`): every crown shares the Command crown's sealed hex roof deck. **Relay** re-seats the accepted Relay roofline (asymmetric service tower, clerestories, parabolic dish, louvred housings, identity disc and ring) from `base-relay.blend`, grounded on the deck and fitted inside a 15 m circle (scale 1.0), plus three rear antenna masts. **Foundry** re-seats the segmented barrel vault, closed gables, vent banks, twin utility silos and identity platform from `base-foundry.blend` (scale 0.90) plus two front heat exchangers. **Bastion** is new: a stepped hex keep over the hub with a tinted disc and illuminated ring, six buttresses, warm clerestory slots, identity trim, six corner turrets with lamps and a sensor mast. `identity_*` materials stay neutral in source (validator check). Kit blends were read only.
- Producer validator (`validate_hq.py`, now checks every `crown-*`): **241 checks pass**, including hex-eaves envelope and height for all four crowns. `render_crown_previews.py` renders each crown on the shell for the picker tiles (720 × 480, transparent).
- Sizes: crown-bastion 0.90 MB / 10.8k tris, crown-relay 1.11 MB / 14.1k tris, crown-foundry 1.49 MB / 23.6k tris, crown-command 1.71 MB / 25.4k tris (budget 5 MB / 40k each). Four previews 0.31 MB each.
- Runtime: `baseVariants` is `bastion, command, relay, foundry`; `legacyBaseVariants` keeps the archipelago trio and `legacyVariant()` maps Bastion → Command there, so the flag-off path still resolves every saved appearance. Manifest v3 gains `colony.crownPreviews`; `integrate-colony-assets.mjs` publishes `crown-bastion.glb` and the four previews. The picker shows four tiles from the crown previews in colony mode and the three legacy tiles otherwise. `colonyModels` already composed shell + per-variant crown; room allocation has no variant input (test).
- Tests: "four crowns render on one shell and a missing crown falls back to Command", "one room table serves every crown", appearance defaults/legacy mapping. 145 Frontier tests, typecheck, lint, format pass.
- Evidence (`measurements-step3.json`): picker with four tiles at both sizes (`step3-picker-*.png`); each crown on PlanCheck's parcel (`step3-exterior-{bastion,command,relay,foundry}-*.png`); palette tint on Foundry (red, purple) and Bastion (orange, red); world with three different crowns. Slots P1/P2/P3 unchanged through every switch and the base label anchors' x positions identical before and after. Fetched colony assets with all four crowns and previews: **20.1 MB** (budget 25 MB).

## Assumptions

- The existing hex crown already carries the accepted Command drum, so it stays "Command"; "Bastion" is a fourth, newly authored crown (stepped keep and turrets) rather than a rename of the existing one.
- Kit rooflines are fitted inside a 15 m circle rather than the full 17.1 m eaves so the label anchor at 19.5 m and the crown envelope both hold with margin; Foundry scales to 0.90, Relay needs no scaling.
- Default appearance now spreads new projects over four variants; existing saved appearances are untouched. Without the flag a project defaulting to Bastion renders the Command building.
- 1Password SSH signing became unavailable part-way through the run ("failed to fill whole buffer" on every attempt after step 1); commits from step 2 onward are unsigned and can be re-signed with `git rebase --exec 'git commit --amend --no-edit -S'` in the morning.

- "Crowded" means more than four cards in one room; in a crowded room every plain card becomes a marker (not just the overflow), because at 1280 × 720 with the selection panel open even three full cards cannot fit above the implementation room without covering the HUD.

- Slot assignment still runs (and persists) without the flag; it is harmless in the archipelago and keeps a project's parcel stable when the flag is switched on later.
- The two dev servers left over from slice 1 (5241 stopped on its own; 5242 still running) were left alone per instructions; this run uses 5243.
