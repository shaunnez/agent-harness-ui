# Agent Harness dogfood campaign — 2026-08-03

## Method

Nine bounded tasks used three identical frozen issue briefs at commit `4c9d56813ae1787f9099d24efd5a8f67ed90234f` under three hidden policy variants. Candidate labels were randomized. Intermediate Grill, specification, and plan decisions accepted the evidence-backed recommendation. Failed gates were not bypassed. No candidate was approved or merged, no campaign branch was merged, and this report does not declare a quality winner.

## Outcomes

| Candidate | Issue | Terminal state | Revision | Gate evidence | Repairs |
| --- | --- | --- | ---: | --- | ---: |
| A | dashboard-progress | blocked | — | No gate evidence | 0 |
| B | agent-skill-contracts | blocked | 1 | No gate evidence | 0 |
| C | agent-skill-contracts | blocked | — | No gate evidence | 0 |
| D | dashboard-progress | blocked | — | No gate evidence | 0 |
| E | agent-skill-contracts | blocked | — | No gate evidence | 0 |
| F | structured-activity | blocked | — | No gate evidence | 0 |
| G | structured-activity | blocked | — | No gate evidence | 0 |
| H | structured-activity | blocked | — | No gate evidence | 0 |
| I | dashboard-progress | blocked | 2 | dev-review:REPAIR | 1 |

## Blind-review handoff

Read [the anonymized manifest](dogfood-campaign-2026-08-03/manifest.json) and the per-candidate brief, verification evidence, and unified diff under `docs/dogfood-campaign-2026-08-03/candidates/<label>/`. Execution-policy identities and task IDs are deliberately absent. Candidate diffs are otherwise unredacted, so product model-catalog literals remain where they are part of the code under review. The private mapping is stored outside Git in `.data/evaluations/2026-08-03/variant-map.json`.

## Limitations

This is a nine-task controlled dogfood sample, not evidence of statistical significance. Wall time can be affected by local concurrency and runtime load. API-rate estimates are not attributable ChatGPT-plan charges. Human and blind quality ratings remain separate from cost and completion.
