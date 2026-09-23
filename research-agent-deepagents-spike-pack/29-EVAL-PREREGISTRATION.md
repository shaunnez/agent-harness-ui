# Eval pre-registration: single agent against scope → Luna retrieve → Opus reason

Frozen 24 September 2026, before any eval run. Plan: `28-SCOPE-PACK-EVAL-PLAN.md` §3. Shaun
authorized the runs in the same instruction that asked for the scoping step and the pack runtime.
Nothing below may change after the first run; a change starts a new, separately registered eval.

## Question set (13)

Files: `29-eval/question-set.json` (pinned), `29-eval/open-scopes.json` (open).

**Ten pinned scopes**, chosen by rule, not by hand. Each scope's recorded status is the 22 September
Opus 5 baseline (`17a-top30-results.json`, three runs, local capture). Within each status the scopes
are sorted by id; agreed and disputed take every third scope starting from the first, and not
established takes the first.

| Recorded | Scopes |
|---|---|
| agreed (6) | acp-facade-cladding-install, concrete-paving-slab, emergency-lighting-exit-signage, interior-finishes-to-schedule, metering-control-instrumentation-wiring, p-solar |
| disputed (3) | door-hardware-sets, industrial-roller-doors, site-electrical-reticulation |
| not established (1) | network-supply-connection-hv-metering |

Every run is given the scope file's text as its objective, unchanged.

**Three open customer questions** (`18c-ask-feed.json` a1–a3), each scoped once by the new scoping
step (GPT-6 Luna, medium, 6–8 s, about $0.001 each) and frozen as drafted, with no human edits: the
same path an external request takes. Every arm is given the same question plus the same pinned-scope
text (`scopedObjective`). All three came back `per m²`.

## Arms (3 runs per question, all High, all on PlanCheck's rate library)

| Arm | Runtime | Models | Plan |
|---|---|---|---|
| A0 | `claude-cli`, one agent | Opus 5.5 High | Claude subscription |
| A2 | `pack` | GPT-6 Luna High retrieves; the host checks the pack; Opus 5.5 High reasons, `request_evidence` ≤ 2 | ChatGPT plan + Claude subscription |
| A3 | `codex-cli`, one agent | GPT-6 Luna High | ChatGPT plan |

Same code revision, recipe, host tools (`fetch_source`, `read_source`), row kinds
(`rate,elemental,benchmark,build_up,percent,fee`), and the `standard` budget
(`resolveResearchBudget("standard")`) for every arm. Runner: `scripts/research-eval.mjs --arm <id>`.

## Decision metric (one, frozen)

**The share of the 13 questions that end `agreed` with every component of every run checked**: a
QV row found in the rows that run was shown, a web quote verified on the retained page, or a
labelled allowance. Status and checks are computed by the product's own `questionRecord`, so the
agreement rule (low 1.25×, high 1.35×), the unit-measure check (against the other runs, and for the
open questions against the pinned scope's measure) and the one-run rule are exactly what the
research window shows. No model's judgement enters it.

**Corrected by Shaun, 24 September, mid-run ("Fix and commit and push"):** one band among three
runs agreed with itself (A0 industrial-roller-doors: one run banded, two found nothing). The
product now reads that as `disputed` with no consensus (`loneBand` in `questionRecord`); the
recorded rule in `agreement.mjs` is unchanged, so the 22 September baseline still reproduces. Two
banded runs that agree still count as agreed. Every recorded result was re-scored with
`scripts/research-eval.mjs --rescore`; only that question changed.

A leader is named only if it beats the next arm by at least 2 of 13 questions; otherwise the arms
tie on the metric and the diagnostics are reported without a winner.

## Budget (equal per arm)

**$4.00 API-rate per question per arm** (three runs together). Claude's figure is the CLI's own
`total_cost_usd`; Codex's is the rate-card estimate. An arm with any question over the cap is
**disqualified**, and its results are still reported in full. The runner does not stop a run at the
cap (`AGENTS.md`: breach is classified at scoring time).

**Amended by Shaun, 24 September, mid-run:** "Remove disqualified it's fine." A0 had one question
over the cap (site-electrical-reticulation, $4.80). The cap is now a reported diagnostic, not a
disqualifier, for every arm. Nothing else changes; the decision metric and set stand.

## Diagnostics (reported, never decisive)

API-rate cost per question and per stage; wall time per question and per run; runs with a band;
unit mismatches; band distance from the recorded Opus 5 consensus on the pinned scopes (a
different model on a different QV source, so a direction, not a score); how often Opus requests
more evidence; tokens by stage; failed runs by cause.

## What would change the plan

- A plan limit or provider outage fails runs through no fault of the arm. Those runs are reported
  as unassessed and the question is re-run once, after the window resets; that is the only re-run.
- If PlanCheck's library is down, the eval pauses. It never falls back to the local capture.

Results: `30-EVAL-RESULT.md`, with the raw per-question files in `29-eval/results/<arm>/`.
