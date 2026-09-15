# Art checkpoint 1 — review handoff

15 September 2026. One connected coastal exterior is integrated and locally qualified on `codex/mission-frontier-coastal-checkpoint-1`. Current main, including HUD PR #88, was merged at `aeec649`. Review is for the new art branch, not merged PRs #86–#88.

## Review the result

Preview: http://127.0.0.1:5206/?mode=fixture&scenario=workflow&art=cinematic#world

Start with `final-comparison.jpg`, then `world-day.jpg`, `world-night.jpg` and `world-laptop.jpg` beside this document. Escape clears the selected dock to expose the court. The original design still has considerably richer world composition; this is the first bounded exterior checkpoint, not final artistic equivalence.

## Delivered

- Astra authored one packed Blender scene: articulated ceramic/steel base, open live-agent courtyard, elevated headland/coves and raised bridge with real approach/abutment sockets.
- Seven content-hashed layers share a measured orthographic camera and ground anchor. Terrain, base, bridge, front kerbs, practical lights, shallows and shore mask integrate independently with existing live entities.
- Existing graph topology/project positions are preserved. Matching geometry receives the authored crossing; incompatible layouts fall back to the existing kit. Corrected junction arms and local vegetation clearance keep both ends visible.
- Registered shoreline shader moves a crest shoreward and fades its wash, with dark offshore water, independent shallows and night exposure. Existing motion/connection admission freezes the effect.
- Fixed mixed ground normals, submerged/buried pier bleed and cutout-leaf black pixels through geometry correction and camera-only holdouts with sufficient transparent bounces. Failed captures remain clearly historical.
- Merged the accepted compact HUD from main. HQ/Watch behavior, tasks, agents, artifacts, policies and backend semantics remain intact.

## Qualification

After final art integration and HUD merge: 88 Frontier tests, 18 Frontier API tests, 4 Sites tests, typing, lint, formatting, main build and Frontier build passed. Builds ran sequentially. Browser checks covered 1568×1003 and 1280×720, day/dusk/night, motion-off, active/repair/unknown connection, art-error recovery and HQ/Watch navigation. No browser errors were captured. See `acceptance.md` and individual logs.

The `shore-sequence.json` timestamps describe ordered samples spanning multiple cycles. `motion-pixel-check.json` records zero changed shore-crop pixels with motion off and forced disconnection. These fixture checks do not assert fresh model execution or remote CI.

## Source and reproduction

Builder contract: `assets/staging/coastal-checkpoint-1/` beneath the Mission Frontier design folder. Integration script: `scripts/frontier/integrate-coastal-assets.mjs` from the repository root. Astra owns `astra-scene/`; its HANDOFF explains complete reproducible commands and retained/excluded files. `blend/coastal-detailed.blend` is the packed standalone export authority. `entries.json`, registration/static QA and source provenance accompany it. Public manifest is `public/frontier/assets/coastal/manifest.json`. `source-manifest.json` inventories delivered source/evidence by SHA-256.

Run the retained `integrate-coastal-assets.mjs` from the repository root after regenerating entries. The measured 2560×1920 layers map to 1280×960 logical pixels with anchor [640,600]. No newly paid acquisition/generation was used.

## Review decisions and next boundary

Please judge the normal-scale base silhouette, court proportions, bridge contact, terrain/grass treatment and subtle shoreline strength. Main remaining difference: original architecture is more asymmetric/weathered, ground cover denser and more varied, water richer, and the whole map more connected. Other project islands still use the previous kit. At laptop size the selected dock covers lower scenery; Escape clears it.

Do not automatically multiply this kit or start Goal 6. After artistic feedback, the separate next slices are HQ/Watch architectural fidelity, broader landscape continuity and coastal/robot life. New cargo, jetpack or seabird behavior requires its own truthful animation contract.

## Delivery record

Draft PR #89: https://github.com/shaunnez/agent-harness-ui/pull/89 — open, draft and mergeable at source 55001c68a6706485e6fb2e15d13619b3cda31570. GitHub returned no CI checks when inspected. Journal version 20 is published at https://mission-frontier-journal.shaunnesbittuk.chatgpt.site/notes/connected-to-the-coast/ (article 21). Existing owner-only access is preserved. Saved source e928e34aee28a2effe9a39b841ad3879ce0a1f71; the deployment succeeded and the published article was inspected. Exact receipt: `journal-publication.json`. Journal tests (5), typecheck, lint and static build passed; the article, comparison tabs and images were checked in the browser. Game preview remains local and fixture-only. No game merge or publication.

All required implementation, qualification and delivery work for this checkpoint is complete. Artistic approval remains the next gate. The final follow-up commit contains delivery documentation only; game code/assets were qualified at 55001c6.
