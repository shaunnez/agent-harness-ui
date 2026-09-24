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

Web search: pinned to OpenCode's `parallel` provider (Shaun: "pin parallel"), where A4 used
`random`. The Go plan's providers served A4 and the tuning runs; by provider, Parallel returned
results on 91 of 91 searches, Tavily 59/59, TinyFish 50/50, Exa 40/40, Firecrawl 48/91 (43 empty),
and `random` keeps one provider for a whole session. Separately, 37 searches failed with HTTP 401
before any provider was chosen; pinning may not remove those, and A5 reports them if they recur.

Reasoning variant: none. On three tuning scopes outside the eval (stud partition walls, benchtop,
switchboard fault rating) `#max` was no more consistent than the default and took about twice as
long; `#xhigh` is not offered.

**Disclosure.** The first two prompt rules were written after seeing A4's failures on eval
questions. They are general rules, not answers, but the eval set is not unseen for this prompt.
Shaun declined a further, more specific rule about unsourced study and engineering fees; the base
prompt already says a professional fee with no source is not established. The tuning scopes' results
are not reported as a score.

**A5 run (24 September).** Shaun ran it four questions at a time ("run it 4 at a time"), so A5's
wall times are not comparable with the other arms'; pass count and cost are. One
industrial-roller-doors run failed with "The PlanCheck rate library is unreachable" while another
agent restarted PlanCheck; the question was set aside to `results/unassessed/A5/` and re-run once,
as this document allows. Result: 7 of 13. Written up in `30-EVAL-RESULT.md`.

## Addendum A6 (24 September, before any A6 run)

Shaun: "build the thin loop now, and lets test it against the 13 questions".

| Arm | Runtime | Model | Search | Keys |
|---|---|---|---|---|
| A6 | `api-loop` (`server/research/api-loop/`) | `opencode-go/deepseek-v4.1-flash`, no reasoning setting | Parallel, as the host's `web_search` (`fast` mode) | `OPENCODE_API_KEY`, `PARALLEL_API_KEY`, in the host only |

What changes from A5 is the harness, not the model or the plan: no CLI and no child process; the
loop calls the model's OpenAI-compatible API, runs the tools each step asks for concurrently
through the run's host-tool socket (the same exposure check, strikes and terminal stop as the CLI
relays), and web search is a host tool on Parallel instead of OpenCode's pinned `parallel` provider.
The prompt is A5's recipe (Codex's, with its three rules) in plain tool names, without the Code Mode
lines, plus "you may call several tools in one step". Same 13 questions, three runs, PlanCheck
library, row kinds, `standard` budget, metric and leader rule. Hard cap 15 minutes; at about 50
tool calls the model is told to answer and asked once more with no tools. Cost is the models.dev
rate card (OpenCode Go DeepSeek 4.1 Flash: $0.15 in, $0.003 cached, $0.60 out per million), an
API-rate estimate. The question it answers: does the thin loop keep A5's 7 of 13 at lower memory
and no slower, so it can be the production worker (with Baseten in place of OpenCode Go).

**A6 run (24 September).** All 13 questions at once (39 runs): 1 of 13 passed. Every run finished;
peak memory 1.66 GB for 39 runs; 6.3 minutes for the set; no rate limits; $1.29 API-rate. Against
A5: 37 tool calls a run (15), 13 failed web quotes (2), 11 of them PDF rows cited with no page.

## Addendum A7 (24 September, before any A7 run)

Shaun: "Run". A6's runtime after tuning on the three scopes outside the eval; same model, plan, 13
questions, three runs, metric and leader rule, run all 13 at once. Changes from A6:

- Prompt: quote only from fetched text, never a search snippet; a PDF quote must give its physical
  page; the "you may call several tools in one step" line removed.
- Search: Parallel `advanced` mode with the objective "Find current New Zealand prices (NZD, GST
  exclusive) for: <query>", up to 8 results with excerpts to 3,000 characters (v1 refuses
  `max_results`, `country` and `location`).
- Checking (every runtime from now on, approved by Shaun): a PDF quote that names no page is looked
  for on every retained page of that PDF, still word for word. Results recorded before this keep
  their checks.
- Grading (every runtime, approved by Shaun): a question with any finished run that produced no
  price is Review, never Confident. It does not change the frozen pass metric.

On the tuning scopes: stud walls and benchtop passed with no failed checks; switchboard fault rating,
unpriced by the Opus baseline, was priced by all three runs ($20k–46k) and read Review only because
one web quote failed. The eval set was not used for this tuning.

**A7 run (24 September).** All 13 at once: 5 of 13 passed (concrete paving, emergency lighting,
open-a2, solar, site electrical). 4.9 minutes for the set, peak 1.55 GB for 39 runs, $1.15, no
errors, 3 failed web quotes. On HV supply one run returned no price and two priced it (disputed,
Review). Shaun asked for one repeat of A7 unchanged ("Rerun"), to see how much a set of 13 varies
between runs; it is written to `29-eval/repeat/A7/` and reported beside A7, not as a new arm.

**A7 repeat (24 September).** Unchanged, all 13 at once, 4.7 minutes, $1.18: 3 of 13 passed
(emergency lighting, interior finishes, metering). Six of the 13 questions changed outcome between
the two A7 runs; only emergency lighting passed both times. So one pass over 13 questions moves by
two or three questions from chance alone, which is the size of every gap between arms in this eval:
A5's 7 against A7's 5 and 3 is not, on this evidence, a difference in the arms.
