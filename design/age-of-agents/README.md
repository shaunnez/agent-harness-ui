# Age of Agents — look-and-feel prototype

An Age of Empires take on the Harness command centre, in place of Frontier's StarCraft-like look. It is a separate entry over Frontier's fixture data, so the live Frontier app is untouched.

```
npm run dev:empire          # http://127.0.0.1:5198  (?skip bypasses the title, ?skip&replay starts the replay)
npm run build:empire        # dist/empire
npm run test:empire         # replay engine tests
```

## The mapping

| Harness | Age of Agents |
| --- | --- |
| Project | Kingdom: a town centre in the project's banner colour |
| Base type (Bastion / Command / Foundry / Relay) | Civilisation: The Stoneward / The Crown Legion / The Forgeborn / The Starwatch (research only) |
| Research project | A walled realm across the river, reached by one bridge; scholars mine the rate library, explorers ride out to search |
| Task | Campaign: a squad standing at its current stage's building |
| 10 workflow stages | 10 buildings in a ring, grouped into four ages: Dark (Triage, Scouts, Grill), Feudal (Specification, Plan), Castle (Implement, Dev review, Test), Imperial (Final review, Approval) |
| Work packages | Walled yards beyond the Great Workshop: planned (stakes), running (scaffold and villagers), failed (rubble and fire), integrated (finished house) |
| Model | Unit type: Luna = Man-at-Arms, Sol = Knight, Opus 5.5 = Paladin, DeepSeek = Scholar (research only) |
| Reasoning effort | Rank I–VI (Militia → Mythic) |
| Workflow profile (fast / standard / high-risk) | Doctrine: Skirmish / Campaign / Siege |
| Stage policies (Settings) | Muster the Armies (the barracks) |
| Grill | The Council: one question at a time, with the recommended decree |
| Needs you / next decision | "Awaiting your decree" panel and the `.` key (next decree), like AoE's idle-villager button |
| Tokens and cost | Resources: Food = input, Wood = output, Stone = cached, Gold = approx. cost (Unavailable without a rate card), Pop = runs in the field |
| Pipeline | Tech tree, with the red repair road back to the Workshop |
| Linear | The Grand Market, where caravans arrive |
| GitHub PR | An envoy ship sailing to the GitHub Capital |
| Integrations | Diplomacy |
| New project / new task | Found a Kingdom / Raise a Campaign |

## Second pass (26 September 2026)

- **Replay a march** (`R`, the Replay button, the title menu or the Tech Tree): a labelled sample campaign, MS-100, marches through all ten buildings on MyStrataAssist's roads. It shows a Linear caravan arriving, triage, two scouts riding out, a Council decree, a sealed charter and plan, and S1 → S2 + S3 built in walled yards. Candidate r1 is assembled, a P1 finding sends the squad down the red repair road, and r2 makes the old verdict stale until a fresh review. After that come the test, the Keep, your seal, and an envoy ship sailing to the GitHub Capital. It has play/pause (`Space`), 1–8× speed, a scrubber with ten stage marks, and camera follow. The script is pure data (`src/empire/replay/`) with unit tests.
- **Inside a building** (`E`, or Enter on a building or campaign):
  - Watch Tower: the order as received.
  - Scout Stables: riders out, and unused scouts shown as stabled.
  - Council Hall: the Council's questions.
  - Scriptorium and War Room: the charter, and the plan as dependency batches (MS-092's 12 packages).
  - Great Workshop: the yards, the candidate and its diff.
  - Monastery: P0–P3 findings and stale verdicts.
  - Proving Grounds: target rows, opening on the failed one, with a way back to the list.
  - The Keep: the journey stage by stage.
  - Royal Harbour: the envoy's branch and PR state.

  The data comes from Frontier's richer sample scenarios (`enrichWorkflowScenarios`).
- **Watch a crew** (`F`): the camera follows the squad, and a panel shows the run's unit, model and reasoning, elapsed time, tokens and recorded activity. A finished run on a waiting campaign says so rather than showing work.
- **Barracks tabs:**
  - Armies: the stage policies.
  - Special corps: the Codex and Claude design models, plus the research realm's fixed DeepSeek API-loop scholars.
  - Standing orders: the Grill policy, the repair mode, per-package attempts and per-doctrine candidate attempts (0–10).
- **Day and night:** one real hour per world day, or pinned to Day, Dusk or Night (saved in this browser). Lit windows still mean recorded work. Door lanterns and hearths appear after dusk as scenery.
- **Tidy-up:** the renderer is split so no source file passes 500 lines. The terrain is cached at 0.75 scale (about 30 MB instead of 57 MB). Package yards are allocated per campaign, so two campaigns in one kingdom no longer share yards.

## Truthfulness

Squads, yards, fires and envoy ships come only from the recorded task, run and package state in the fixtures, or from the replay, which is labelled "Replay · sample" on the map, in the bar, in the herald and in the panel. Future stages are inert. Townsfolk on the ring roads, caravans on the trade roads, clouds and gulls are scenery. Every command ("Seal the charter", "Send repair crew", "Muster") shows a notice and changes nothing.

## Screens

`01-title` · `02-realm` · `03-workshop-yards` · `04-chronicle` · `05-muster` · `06-tech-tree` · `07-found-kingdom` · `08-research-realm` · `09-replay-workshop` · `10-replay-repair-road` · `11-replay-envoy` · `12-watch` · `13-interior-monastery` · `14-interior-proving-grounds` · `15-interior-war-room` · `16-night` · `17-muster-corps` · `18-muster-orders`
