# Exterior bases — ready for local review, 16 September 2026

Publication follow-up: Shaun subsequently requested a PR. Fresh qualification and the stacked review base are recorded in [PR-3D-PROOF/HANDOFF.md](../PR-3D-PROOF/HANDOFF.md). The uncommitted status below describes the original review capture, not current Git delivery.

Latest user clarification is implemented: one base belongs to each project across the same 3D map. Three structural choices are available per project, independently of colour and task state. This extends the accepted single-base 3D experiment; it does not deploy the game or start Goal 6.

Review: `http://127.0.0.1:5207/?mode=fixture&scenario=workflow&art=cinematic&renderer=3d#world`.
Worktree: `mission-frontier-3d-proof`, branch `codex/mission-frontier-3d-proof`, baseline `a6f637fe796bfedae3df476adae97f007ad7b2e0`. Original proof and this follow-up remain uncommitted. The separate prior fidelity worktree, user services, backend/database and original proof evidence are preserved.

## Delivered

- **Command:** curved twin bays, segmented circular command crown, recessed coloured roof.
- **Relay:** asymmetric stepped communications tower and radio dish, lower service wing.
- **Foundry:** broad curved hangar crown, service silos and roof vents.
- Robots enlarged from 1.8m to 3.1m at their foot origin; three crate assemblies measure 2m, utility cart scales 1.35. Astra's ground/contact audit reports 0.807m cart/crate clearance.
- Warm window/entry strips, marker lights, modelled sensors and exterior computer housings. Identity and ambient instrument materials receive a slow ±7.5% emission pulse; practical illumination follows day/night. Station life is scenery, not task progress.
- Appearance panel with matching thumbnails and Blue/Red/Orange/Purple. Stable initial assignments distribute the first three buildings; explicit Randomise is also available. Choices persist by project/repository in browser storage. Current review choices: PlanCheck/Command/Blue, Agent Harness/Relay/Red, MyStrataAssist/Foundry/Purple.
- One base and translated worker/route set per active fixture project. World, per-base Exterior, same-building Cutaway, minimap, model picking and Watch remain connected to the correct task/project.
- Quiet initial world selection and single-line exterior cards keep the laptop world readable. Extra workers use clear floor positions instead of intersecting the analysis console. Returning from headquarters/Watch resets a stale exterior focus.

## Qualification

**101 Frontier tests**, **4 Sites tests**, typing, lint, formatting, main build and Frontier build passed. See adjacent logs. Three.js/Vite retain the dependency Clock deprecation and large-chunk advisory; neither is a runtime failure. No remote CI, backend suite, real model run, API execution or performance campaign was run for this visual adapter change.

Actual browser checks at 1568×1003 and 1280×720 covered:

| Acceptance | Evidence/result |
| --- | --- |
| Three bases visible together; correct project identity | `world-day.png`, `world-laptop.png`, `browser-final.json` |
| Three structures and four palettes | `base-lineup.jpg`, `picker-laptop.png`, `foundry-orange-laptop.png`; saved Blue/Red/Purple in final world |
| Choices survive refresh and affect only the chosen project | Browser reload plus independent project appearance tests |
| Larger grounded robots and cargo | `command-day.png`, `comparison-details.jpg`; producer authoring audit |
| Light windows, entry strips, sensors and coloured roofs | `command-dusk.png`, `command-night.png`, producer model/material audits |
| Gentle pulse and motion-off | `motion-captures.json`, `motion-check.json`: roof/instrument/sea pixels change when enabled; all sampled regions have zero changed pixels when disabled |
| Same-building cutaway in every project | `command-cutaway.png`, `relay-cutaway.png`, `foundry-cutaway.png` |
| Active vs historical Watch and own-project robot picking | `watch-active.png`, `watch-historical.png`, `watch-laptop.png`; clicking MyStrataAssist robot selected MS-090 |
| Multi-task crews clear the central console | Revised `relay-cutaway.png` and regression test |
| Return to world and laptop layout | Final 1280×720 browser record and screenshot |

Reduced-motion and disconnected admission retain the existing input gates and are covered by adapter checks; native OS reduced-motion and connection/graphics-loss browser injection were not repeated in this follow-up. The prior proof's dated recovery evidence remains intact. Ambient light can change pixels on a parked robot; this is not a transform/run change. Motion-off freezes the entire sampled scene.

## Source and review pointers

- Brief: `design/mission-frontier/EXTERIOR-BASES.md`.
- Asset contract and editable producer package: `assets/staging/exterior-bases/contract.json` and `astra-kit/HANDOFF.md`.
- Reintegrate final exports: `node scripts/frontier/integrate-3d-proof.mjs`. It validates groups, PBR and identity materials and writes content-addressed GLBs/previews plus manifest v2. No new paid generation or asset purchase.
- Application: `src/frontier/world-3d/`; Root retains the existing runtime and controls. `appearance.ts` owns local choices; `layout.ts` and `model.ts` own project/worker mapping; Base, Camera, Labels and Scene are separate focused components.
- Final design review: root `design-qa.md`, paired `comparison-world.jpg` / `comparison-details.jpg`, plus `base-lineup.jpg`. Original full proof QA is archived in `previous-design-qa.md`.

## Remaining boundaries

This is a fixture-only local preview; appearance is not yet a backend project setting. Initial placement is a deterministic preview layout, not user placement. More than the three supplied project scenes/high-density crews were not visually qualified. All bases intentionally share the accepted environment and occupied lower plan; their crowns/silhouettes differ. The original study remains richer in terrain continuity, weathering, asymmetry, courtyard props, robot character and coastal life. Those are follow-up art/adoption decisions, not a claim of full concept parity.

Before a production renderer adoption: decide backend appearance persistence, asset distribution/cleanup (the old proof export is retained), and a broader World/HQ/Watch migration. Goal 6's operational event work, live end-to-end delivery and v2 placement/upgrades are separate. Journal publication uses its independent Site and existing audience only.
