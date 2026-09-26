# Age of Agents — look-and-feel prototype

An Age of Empires take on the Harness command centre, in place of Frontier's StarCraft-like look. It is a separate entry over Frontier's fixture data, so the live Frontier app is untouched.

```
npm run dev:empire          # http://127.0.0.1:5198  (add ?skip to bypass the title screen)
npm run build:empire        # dist/empire
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

## Truthfulness

Squads, yards, fires and envoy ships come only from the recorded task, run and package state in the fixtures. Future stages are inert. Townsfolk on the ring roads, caravans on the trade roads, clouds and gulls are scenery. Every command ("Seal the charter", "Send repair crew", "Muster") shows a notice and changes nothing.

## Screens

`01-title` · `02-realm` · `03-workshop-yards` · `04-chronicle` · `05-muster` · `06-tech-tree` · `07-found-kingdom` · `08-research-realm`
