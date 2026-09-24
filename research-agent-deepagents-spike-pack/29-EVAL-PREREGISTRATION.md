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

**Typography check (24 September).** On A7 roller doors failed a web quote both times. The page was
fetched correctly and the text is in the retained copy, but DeepSeek quoted "$1,800–$2,300" as
"$1,800-$2,300" and rewrote "$1.1k" as "$1,100". Shaun approved two changes ("Go"):

- Checking (every runtime from now on): typographic look-alikes are equal in a quote. Every dash and
  minus sign reads as "-", curly quotes as straight ones, "…" as "...", and soft hyphens and zero-width
  spaces are dropped. Digits, words and every other character must still match, so "$1.1k" quoted
  as "$1,100" still fails. Results recorded before this keep their checks.
- Prompt (API loop only): copy figures exactly as the page writes them, including "k", dashes and
  commas. The OpenCode prompt is unchanged, so A5 stays reproducible.

The API loop with these changes is a tuning state after A7, not a scored arm. Roller doors and facade
were each run twice (12 runs, $0.32, written to `29-eval/typography-check-1/` and `-2/`). Facade
passed both times. Roller doors failed both times, but not on quotes: one run had every source
checked and one had a single failed web quote. The first repetition was disputed on price, with lows
from $9,460 to $12,902. In the second the three bands agreed ($9,240–9,750 low, $13,750–16,500 high),
but the run was scored "different measures" because one run wrote its unit as "ea (one complete
door, … also give x4 total)". The word "total" inside the note beat the leading "ea". That is a
unit-parsing fault in the scorer. It is recorded here and not fixed without Shaun's go-ahead.

**Figures check (25 September).** Shaun asked that a citation be judged on what it means, not on
its characters, and asked who would judge that ("build it"). A model does not judge it; code
does (`server/research/research-quote-figures.mjs`). Three rules, for every runtime from now on:

- Locating: a quote that is not on the page character for character is looked for by its words.
  The quote has to have at least three words, and at least 80% of them must sit together on the
  page; figures are left out of that score. When it is found, the page's own words are what gets
  verified and retained, never the model's rewording.
- Figures: the passage's figures are read off the page and parsed. "$1.1k" is 1,100, ranges are
  read as ranges, and entities are decoded. They are then compared with the component's low and
  high, allowing 3% for rounding, GST (÷1.15), a quantity the component states ("4 doors", "over
  40") and the sum of two figures. The outcomes:
  - **Quote verified**: the figures give the amount, or it sits inside a range the page states.
  - **Worked from quote**: one end is on the page, the band is set within 35% around one quoted
    price, or the component shows the quantities it worked with.
  - **Quote doesn't give it**: the page's figures are different, or there are none, and no working
    is shown.
  "Worked from quote" counts as checked for now; "Quote doesn't give it" does not.
- Units: a note in brackets does not change the measure a band is priced in. "ea (… also give x4
  total)" is priced each.

These change the checks and the frozen pass metric, so every recorded arm was re-checked from its
retained transcripts and page snapshots (408 runs, 482 web citations with page text). Of the 369
re-checked citations that used to verify or fail on the quote: 145 are verified, 175 are worked from
the quote, 34 don't give the amount and 15 are still not on the page. 38 citations whose page could
not be recovered, and the facade transcripts from the two typography repetitions (which shared one
run directory; eval run ids now carry a random tail), keep their recorded checks.

| Arm | Recorded | Re-checked | If "worked from quote" did not count |
|---|---|---|---|
| A0 Opus | 5 | 5 | 5 |
| A2 Luna → Opus | 5 | 4 | 3 |
| A3 Luna | 4 | 4 | 3 |
| A4 | 0 | 1 | 0 |
| A5 DeepSeek, OpenCode | 7 | 6 | 5 |
| A6 API loop | 1 | 4 | 1 |
| A7 API loop, tuned | 5 | 5 | 2 |
| A7 repeat | 3 | 2 | 0 |

The recorded result files are left as they were scored; the table is the re-check. Most amounts
that were "worked from quote" were quantities times a rate, or a rate spread over a count (hours ×
$85, $39.90 over 40 fittings). The check can confirm the quoted rate but not the arithmetic,
because the answer states the arithmetic only in prose.

**Addendum A8 (25 September, registered before its run).** Shaun: "make runs state their arithmetic
in fixed fields … Then run through A7 and see where we get". This is A7's runtime, model, plan, 13
questions, three runs, metric and leader rule, run all 13 at once. What changes from A7:

- Prompt (API loop only): the typography-check rule to copy figures exactly, plus stated working.
  A web component whose amount is not the quoted figure itself gives `rate` (the figure as the page
  states it) and `quantity` (what it was multiplied by, a fraction for a shared cost), and its
  amount must equal rate × quantity.
- Checking (every runtime): the figures check and bracketed-unit rule of 25 September. A component
  that states its working is **Quote verified** only if its rate is the page's figure and its amount
  is rate × quantity, within 3% (or 3% after ÷1.15 GST). Otherwise it is **Quote doesn't give it**.
  It is never "Worked from quote".
- Tuning: one run of the three practice scopes (stud walls, benchtop, switchboard fault rating)
  before the eval set, outside the eval.

The metric is unchanged in form: a question passes when it is agreed and every component of every
run is checked. "Worked from quote" still counts as checked, and the pass count is also reported with
it not counting.

**A8 tuning and run (25 September).** Tuning on the three practice scopes (outside the eval): stud
walls and benchtop passed; switchboard fault rating was disputed, with one run unpriced. 7 of 9
runs used the working fields, and no component was left "worked from quote".

A8 on the eval set, all 13 at once: **3 of 13 passed as run** (interior finishes, metering, open-a2).
9.2 minutes for the set (HV supply's slowest run took 551 s), $1.23, no errors. 69 of 81 web
components stated their working.

Reading the 14 web quotes the run marked "Quote doesn't give it" found three checker faults, fixed
after the run, for every runtime:

- A bare number straight after a word ("runs 10–15 %") was skipped as if it were glued to the word.
- Percentages were not read as multipliers. A rate of 0.10–0.15 quoted as "10–15 %", or written as
  25–40 and multiplied as 0.25–0.40, now matches.
- A stated rate with only one end on the page was marked unsupported, while the same quote without
  working would have been "worked from quote". It is now "worked from quote", so showing the
  working never scores worse than hiding it.

Re-checked with these fixes, A8 passes **4 of 13**, all four with every figure traced (roller doors
joins them). The other arms' re-checked counts in the table above are unchanged by the fixes. The
recorded A8 result files are left as run.

| Arm | Agreed | Re-checked passes | Traced (not counting "worked from quote") |
|---|---|---|---|
| A5 DeepSeek, OpenCode | 7 | 6 | 5 |
| A7 | 7 | 5 | 2 |
| A7 repeat | 4 | 2 | 0 |
| A8 | 6 | 4 | 4 |

A8's remaining failures are mostly disagreement between runs (7 disputed). Of the two agreed
questions that failed, concrete paving cited a QV row that does not exist and emergency lighting had
one run with no price. Only three A8 web quotes still fail, and all three are genuine: a band of
$30–200 citing a page that says $60, a membrane at $115–186 citing $90.62, and a negative omission
citing a thickness.

**A5 repeat (25 September).** Shaun asked for A5 again ("do it") to compare with A8 on the same
checks. Runtime, model, prompt and cap are unchanged from A5, and it runs four questions at a time as
A5 did. It is scored with the checks of 25 September (figures, working, bracketed units). Results
are written to `29-eval/repeat/A5/` and reported beside A5, not as a new arm.

**A5 repeat result.** Four at a time, 15.5 minutes, $1.12, no errors. 5 of 13 agreed, and **4 of 13
passed** (concrete paving, interior finishes, metering, site electrical). Three of the four had every
figure traced; concrete paving passed on "worked from quote". Roller doors agreed but failed on one
unsupported quote.

| Arm | Runs of 13 | Passes | Traced passes |
|---|---|---|---|
| A5 DeepSeek, OpenCode (re-checked) | 1st | 6 | 5 |
| A5 repeat | 2nd | 4 | 3 |
| A8 API loop with stated working | 1st | 4 | 4 |

On two runs A5 averages 5 passes (4 traced). A8's single run is 4 (4 traced). The difference is
within the two-to-three-question swing seen between identical runs. On this evidence the API loop
with stated working is level with OpenCode, not behind it. Most failures in both arms are now runs
disagreeing on price (A5 repeat 8 disputed, A8 7), not sources.

**Why the runs disagree (25 September).** Shaun: "if opencode is getting better results because of
the harness, we need to figure out why and pivot … Dig in". It is not the harness. A5 and its
unchanged repeat differ on 6 of 13 questions' agreement, and A7 and its repeat on 5. Pooled, A5
agreed on 12 of 26 questions and the loop (A7, A7 repeat, A8) on 17 of 39. Opus (A0) agreed on 8
of 13, with median ratios of 1.09 and 1.10 against DeepSeek's 1.18–1.37, so the inconsistency is
DeepSeek's. A8's seven disputes had four causes:

- one run of three made a mistake the others did not (3): a one-off boom-lift delivery added per m²
  (facade), a change priced with no credit for the removed roofing (open-a3), and a $92k–292k hedge
  against two runs at $240–273k (HV supply);
- the main cost was taken from a retail web price instead of a QV row (1): door hardware, where two
  runs priced the lockset at $248 and one at QV's $1,040–1,460 (Opus used QV in every run and agreed);
- a single run's band was far too wide (1): open-a1 at $30–200 per m²;
- the runs were just outside the rule (2): solar's highs at 1.36× and site electrical's lows at
  1.26×. These are left alone.

**Addendum A9 (25 September, registered before its run).** Shaun: "do 1 2 and then do 3. No opus
runs yet." This is A8's runtime, model, plan, 13 questions, metric and leader rule, all 13 run at
once. What changes from A8:

1. Host answer check (`server/research/research-answer-review.mjs`, API loop only). Before a final
   answer is accepted, code checks it and sends any problems back once, and the next answer is
   final. The problems it looks for: a band more than 3× wide (not checked for a change question,
   whose band is a difference); a one-off cost (delivery, mobilisation, a fixed fee) in a rate band,
   unspread, carrying at least a quarter of the band's high end; a change question ("instead of",
   "switching", "cost impact of") with no credit; and the largest component priced from the web
   with no QV search named, unless it is something QV never publishes (network charges, fees,
   certification). Replayed on the recorded answers, it would have sent back 8 of A8's 38 banded runs
   and 7 of Opus's 34.
2. QV-first prompt rule (API loop only). Search QV first for every component and price from a QV row
   when one fits. A retail list price is not a substitute for a QV row pricing the same item. A web
   component names the QV searches that found nothing.
3. Five runs, the three closest scored (every runtime, for any question with more than three runs).
   Of the runs that produced a band, the three whose lows and highs sit closest together, measured
   against the rule's own 1.25× and 1.35×, are scored by the unchanged three-run rule. The other two,
   including a run with no band, stay on the record marked "not scored". Nothing is dropped from three
   runs, from a question with an unfinished run, or when fewer than three runs produced a band.
   Grading uses the scored three. Questions stay at three runs unless five are asked for.

Tuning: one run of the three practice scopes before the eval set. A9's pass count is reported
beside A5's (two runs) and A8's.

**A9 tuning and run (25 September).** Practice scopes: stud walls and benchtop passed; switchboard
fault rating was disputed even on its three closest runs. The host check sent back 1 of 15 runs.

A9 on the eval set, all 13 at once (65 runs): **11 agreed, 10 of 13 passed, 7 with every figure
traced.** 10.7 minutes, $1.99, no errors. Door hardware and open-a3 were disputed, and solar
agreed but failed one quote.

How much of that is the five-run rule: A9's first three runs alone, scored by the three-run rule,
give 6 agreed and 4 passed. That is the same as A8, so fixes 1 and 2 did not move the count on this
run, and the five-run rule added 6 passes. That rule makes agreement easier by construction: it
asks whether three of five runs cluster, not whether all three do. Its count is therefore not
comparable with the three-run arms (A0–A8). What it measures is the product's answer, where a
stray run no longer decides the question. Whether the clustered bands are closer to real prices is
not measured.

A9's HV pass is a wrong answer. Four of five runs priced the connection at about $200k–332k,
mainly from the Electricity Authority's worked example (whose page 4 says the examples "should not
be relied on as a guide to actual costs or charges") and from Vector's posted rates, headed "For
information purposes only" on a page whose connection and development-contribution prices read
"Priced per job". Read against the sources, the recorded answer, no price, is right.

**Checks added after A9 (Shaun: "I agree to your fix"; every runtime).**

- A web figure whose own source says it is not a price is **Quote doesn't give it**. That covers
  anything in a document that says its examples should not be relied on as actual costs, is for
  illustration only, or uses hypothetical zones or examples, and anything within 500 characters of
  "for information purposes", "priced per job", "quoted on request" or "after assessment", or a
  "worked example". "POA", "price on application" and "indicative only" are left out: replayed on
  the recorded runs, they caught priced rows beside a POA row (30 times on roller doors). At 500
  characters the rule catches only HV sources among 612 recorded web citations, plus one on a
  practice scope and one $1 facade component.
- API-loop prompt: such a figure is not a price, and the item is not established, naming who to ask.

**Scope change (Shaun: "1 ok").** Open-a3's scope is pinned to the net change: the membrane roof in
place, including its substrate, less the long-run Coloursteel it replaces. The clarification that
left this open is removed. A9 ran before the change. Any arm compared on open-a3 from now on is
re-run on the new scope.

**Five runs by default (Shaun: "5 is fine for now").** A question in the app now starts five runs,
of which the three closest are scored. Three runs and a one-run Quick remain available.
