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

**Corrected by Shaun, 24 September, after A0–A3 finished ("yeah fix it"):** a unit that opens with
a rate ("$/m2 finished slab, and total for 300 m2") was read as a whole-job total, because the
total pattern matched "total for 300 m2". `unitMeasure` now reads a leading rate first. Re-scored
with `--rescore`: only A3 concrete-paving-slab changed, disputed → agreed (low 1.12×, high 1.24×);
it still fails the metric on a citation, so no arm's pass count moved.

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

## Addendum A4 (24 September, before any scored A4 run)

Shaun asked to test DeepSeek 4.1 Flash through OpenCode ("opencode deepseek 4.1 flash, lets test
this", then "run it"). Registered as a fourth arm after the three frozen arms finished; it does not
change them.

| Arm | Runtime | Model | Plan |
|---|---|---|---|
| A4 | `opencode-cli`, one agent | `opencode-go/deepseek-v4.1-flash` (no reasoning setting) | OpenCode Go plan (workspace region: Global) |

Same question set, three runs, PlanCheck library, row kinds, host tools, `standard` budget, decision
metric and leader rule as A0–A3. The prompt is Codex's (it allows a total from stated, cited
assumptions), rewritten into OpenCode's vocabulary: QV and research tools are called through Code
Mode (`execute` → `tools.<server>.<tool>`), web search is OpenCode's `websearch`, and the prompt
adds three Code Mode lines (tools load a few seconds late, so retry once; one page per
`fetch_source` call; a page read with the sandbox's own `fetch` cannot be cited). Every action but
`execute`, the configured servers' tools and `websearch` is denied; no provider key reaches the CLI.

Known difference from the other arms: Code Mode scripts can make their own HTTP requests. Such a
page was never retained, so a figure quoted from it fails the citation check (it can only lower the
score). Cost is OpenCode's own per-model price from the session export, an API-rate estimate on a
flat plan. One unscored smoke run (open-a3, results outside `29-eval/`) set these prompt lines; the
scored A4 runs start after it.

**A4 stopped by Shaun at 10 of 13** ("Stop the deepseek run... we can try tune it... just 3
questions"). The 10 recorded questions stand as recorded: 0 pass. Open-a1..a3 were not run. Tuning
happens on three pinned scopes outside the eval (stud partition walls, benchtop, switchboard fault
rating); a tuned DeepSeek is a new arm, registered before it touches the eval set.

## Addendum A5 (24 September, before any A5 run)

Shaun: "add the soft limit to the prompt ... make it fifty, and add the ten minute cap make it
fifteen minutes. Then ... the evaluation that both Opus and Luna and Opus plus Luna did but for
deep seek", and "they all need to be evaluated on the same ones".

| Arm | Runtime | Model | Plan |
|---|---|---|---|
| A5 | `opencode-cli`, one agent | `opencode-go/deepseek-v4.1-flash` (no reasoning variant) | OpenCode Go plan |

Same 13 questions, three runs, PlanCheck library, row kinds, host tools, `standard` budget, decision
metric and leader rule as A0–A3, run one question at a time. What differs from A4 is the prompt
and one cap:

- An excerpt is one continuous passage copied exactly (A4's 14 failed web citations stitched
  passages with "..." or wrote a literal `\n`).
- Before finishing, an unsourced largest component means not established (A4 priced the HV supply
  question, which every other arm correctly left unpriced).
- A soft budget of about 50 tool calls, stated in the prompt; the host does not count Code Mode's
  inner calls.
- A hard 15-minute cap per run, below the shared 20 minutes. Every A0 and A3 run finished inside
  5 minutes, so the stricter cap binds only this arm. A run that hits it fails.

Reasoning variant: none. On three tuning scopes outside the eval (stud partition walls, benchtop,
switchboard fault rating) `#max` was no more consistent than the default and took about twice as
long; `#xhigh` is not offered.

**Disclosure.** The first two prompt rules were written after seeing A4's failures on eval
questions. They are general rules, not answers, but the eval set is not unseen for this prompt.
Shaun declined a further, more specific rule about unsourced study and engineering fees; the base
prompt already says a professional fee with no source is not established. The tuning scopes' results
are not reported as a score.
