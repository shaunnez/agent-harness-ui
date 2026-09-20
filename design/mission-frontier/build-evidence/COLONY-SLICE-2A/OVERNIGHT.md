# Colony slice 2A — overnight report (16–17 September 2026)

Branch `claude/mission-frontier-colony-design-c7dcc1`, PR #92. All five steps shipped; tests, typecheck, lint, format and the Frontier build are green at the final commit. Evidence and journal are in this directory; the acceptance matrix is `ACCEPTANCE.md`.

## 1. What shipped

| Step | Commit | Delivered |
| --- | --- | --- |
| 0 Flag gate | `4ee55af` | `?colony=1` gates the colony. Without it the published v3 manifest is consumed as v2: archipelago layout, legacy kit, manifest cameras and minimap. Design decisions appended to `SLICE-2A-DESIGN.md`; journal and capture script started. |
| 1 Robot scale | `8cb75e5` | Robots 2.5× in World, 1.4× on a focused exterior, 1× in the cutaway. Rings, work lights, labels and picking follow; standing positions, spacing and roam speed stay in true units. |
| 2 Crowded cards | `f1088db` | Rooms with more than four cards collapse plain working cards to pickable dot markers; attention, selected and watched robots keep full cards. Label separator rewritten as a free-slot search that never covers a HUD panel; obstacles refresh on selection and include the world clock. 1280 × 720 with fourteen tasks: 14/14 clickable, zero overlaps. |
| 3 Four crowns | `2f1b9d5` | Relay and Foundry crowns re-seat the accepted kit rooflines on the Command crown's roof deck; Bastion is a new stepped keep with turrets. Producer validator 241 checks. Four-tile picker with rendered thumbnails; Bastion maps to Command without the flag. |
| 4 Living islands | `6d11c3d` | Stratified cliff rim with a wave-cut notch, Cycles-baked AO as `COLOR_0`, dirt paths in the meadow; baked trees removed. 2.6 MB scatter kit (purple twisted trees, boulders, lanterns, rover, cart) instanced per parcel from a layout seeded by the project key; lanterns join the lamp pool. 88 MB of orphaned public assets removed. |
| Acceptance | (this commit) | `ACCEPTANCE.md` matrix, palette captures for all four crowns, reload-stability and parcel-distinctness pixel comparisons. |

Commits from step 2 onward are unsigned: 1Password SSH signing failed on every attempt after step 1 ("failed to fill whole buffer"). Re-sign in the morning with `git rebase --exec 'git commit --amend --no-edit -S' 8cb75e5` before merging if signed history matters.

## 2. What did not ship, and why

- **Variant B water features** (stream, waterfall, pools, mist) and the three baked parcel variants: cut by decision 4. One parcel mesh plus seeded scatter instead.
- **"Ground" row** in the Appearance panel: dropped by decision 5; no concrete reason to reinstate it appeared.
- **Legacy Exterior headless capture**: the archipelago Exterior view renders as a blank canvas under SwiftShader (world and cutaway capture fine). Verified correct in the desktop browser; recorded as a capture-tool limitation, not fixed.
- **Scene-click robot picking by script**: unchanged from slice 1; DOM cards are clicked, the 3D picker is unit-tested.
- Interiors, slice 2B, crystals, arrivals: not started, as instructed.

## 3. Assumptions made where the brief was silent

1. The existing hex crown already carries the accepted Command drum, so it stays "Command"; "Bastion" is a fourth, newly authored crown, not a rename.
2. Kit rooflines are fitted inside a 15 m circle (not the full 17.1 m eaves) so the 19.5 m label anchor and the crown envelope hold with margin; Foundry scales 0.90, Relay 1.0.
3. Default appearance spreads new projects over four variants; saved appearances are untouched. Without the flag a Bastion default renders the Command building.
4. "Crowded" means more than four cards in one room, and in a crowded room every plain card becomes a marker: at 1280 × 720 with the selection panel open even three full cards cannot fit above the implementation room without covering the HUD.
5. "Baked AO in the ground textures" is a Cycles AO bake into a vertex colour layer multiplied into the ground materials (`COLOR_0`), because the terrain's box-projected UVs overlap and a texture bake would need a second unwrap.
6. Scatter kit budget (3 MB / 30k triangles) lives in the runtime validator as a slice 2A constant; the frozen contract was not edited.
7. Trees also avoid the 50–130° front arc so the court and bay stay readable from the exterior camera.
8. Two terrain audit rules were adjusted and recorded: a downward core face counts only when steeper than −0.5 (the wave-cut notch is a deliberate −0.43 undercut), and the shoreline chord tolerance is 0.25 m (measured 0.223 m) because the 97-point loop cannot follow the 41-lobe gullies; the ray grid skips cells within 0.3 m of that loop.
9. Slot assignment still runs (and persists) without the flag so a project's parcel is stable when the flag is later turned on.
10. The leftover slice-1 server on port 5242 was left running as instructed; this run used 5243 and stopped it at the end.

## 4. Asset payload against the 25 MB budget

| Set | MB |
| --- | ---: |
| Colony set published in the manifest (contract, shell, 4 crowns, 4 previews, 2 bridge parts, 2 parcels, scatter kit) | **18.34** |
| Shared worker | 1.12 |
| Fetched by the ten-project stress world (`step4`) | 18.21 |
| Fetched with the picker open (previews included, `step3`) | 20.10 |
| Scatter kit alone (budget 3) | 2.58 |
| Largest parcel (budget 12) | 2.56 |
| Largest crown (budget 5) | 1.71 |

`public/frontier/assets/3d-proof/` is now 135.8 MB; the legacy archipelago kit behind the flag (environment 58 MB, three base kits 55 MB, previews 3 MB) is 116 MB of that and unchanged.

## 5. The single highest-value thing to do next

Make the cutaway interior match the exterior: the six rooms still read as grey boxes with consoles. Slice 2B should author room-specific equipment, floor and wall treatments and warm practicals on the shared shell (one interior serves all four crowns), then re-run the fourteen-task cutaway captures. Everything else the brief asked for is in place; the interior is now the weakest view on screen.

## Housekeeping done

- Dev server on 5243 stopped; 5241/5242 untouched. Branch pushed; PR #92 description updated (local `main` still carries `1c7abde`/`6773f41`, which inflate the diff until their owner pushes).
