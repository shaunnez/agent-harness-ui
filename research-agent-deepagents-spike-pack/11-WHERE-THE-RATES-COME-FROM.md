# Where the missing rates actually come from

22 September 2026. Written after running research against three of the top gaps
and then checking what we already own. Total model spend: $6.08.

## The headline

We pointed a research agent at the open web to price work our catalogue could not
cover. It came back with almost no rates, and it was right to. Then we checked the
catalogue against the gaps and found the reason:

**Only 7% of the unpriced population needs outside research. 72% needs a reference
we already pay for.**

| Route | Scenarios | Claims | Share |
|---|---:|---:|---:|
| **QV CostBuilder capture** — standard measured items we never captured | 101 | 390 | 72% |
| **No rate needed** — deferred aesthetic choice, rate does not move | 16 | 68 | 13% |
| **Supplier quote** — no published rate exists anywhere, phone a named supplier | 23 | 44 | 8% |
| **Web research** — proprietary, statutory or vendor-priced; research is the right tool | 15 | 41 | 7% |
| | **155** | **543** | |

## How we found out

Three scenarios went through a full research run: one Opus 5 call each, server-side
web search, the model writing its own search plan with no query template. Cost $3.64,
thirty searches.

The output was honest and nearly rateless. For channel drain installation the model
returned one number — a GST-adjusted Mitre 10 retail shelf price for the lightest
possible channel — and twelve entries in `not_established`, including:

> "THE HEADLINE RATE IS NOT ESTABLISHED. No published New Zealand source was found
> giving an installed NZD rate per lineal metre for proprietary channel drainage in
> paving."

> "Rawlinsons NZ Construction Handbook could not be consulted. Search returned only
> bookseller, library catalogue and third-party listings... Same for QV CostBuilder
> and CoreLogic Cordell — both are paywalled and neither exposed a channel drain line
> item publicly."

It also recorded the sources it refused to use — three NZ drainage lead-generation
sites quoting $80–$150/m with no author, no method and no GST basis — and stated
explicitly that no Australian or UK figure had been imported even as a sanity check.

That is a good research output. It is also a $1.21 restatement of the obvious: **NZ
installed rates live behind paywalls, and we are on the paid side of one of them.**

The catalogue holds 145 QV CostBuilder rates with per-centre bands, source URLs,
capture hashes and GST evidence. Among them: `channel_100_commercial`,
`ceiling_grid_600`, `ceiling_tile_acoustic_1200`, `timber_pole_retaining_wall_1_2m`.

All three scenarios we researched already had a QV rate sitting in the catalogue.

## What is actually missing

We matched all 155 material gaps against the 145 rates we hold:

| | Scenarios | Claims |
|---|---:|---:|
| Covered — existing rates are enough | 13 | 59 |
| Partial — backbone present, a significant component missing | 65 | 263 |
| Absent — no meaningful rate for the work | 77 | 221 |

The "absent" reasons are not exotic. They read: *no cable rates at all*, *no
switchboard, distribution board, busbar or protective device rates*, *no fencing
rate of any kind*, *no rate for the stud framing itself*, *no preliminaries or site
establishment rates at all*.

QV CostBuilder publishes every one of those. Our 145-rate capture is a thin slice of
it, and the slice is where the gap is. By family, the capture job is 83 claims of
electrical, 56 fitout, 53 civil, 48 joinery.

**The bottleneck is capture coverage, not research capability.**

## What research is genuinely for

The 15 scenarios routed to web research are the ones QV will never carry, because
they are not measured work:

- Proprietary PV mounting systems and their PS1 design (12 claims)
- Lines-company connection and metering charges (6) — network-operator fees, not rates
- Fire engineer and sprinkler designer fees (4) — professional services by quotation
- EV charge points (3) — vendor equipment with published NZ list prices
- Roof walkway, ladder and anchor systems (3) — proprietary, non-penetrating brackets

Plus 23 scenarios where nothing is published anywhere and the honest answer is a
phone call. The model named the suppliers: Hynds, ACO NZ and Allproof for drainage
products; Argus Fire and Wormald for foam suppression; Grundfos NZ and Davey for
booster sets; Geotechnics Ltd for compaction certification.

**That naming is the research agent earning its place.** Not the rate — the routing.
Working out that an item is unpublishable, and who holds the number instead, is a
judgement call that took a model six dollars and would take a QS a week.

## What this changes

1. **Do not run the 30-scenario research batch.** Roughly 22 of the 30 would be
   researching work QV already prices. That is the run I was about to authorise.
2. **The next job is a QV capture expansion, not a research run.** Target the
   electrical, fitout, civil and joinery sections. That is a licensed-source capture
   through the pipeline that built the existing 145 — hash-checked rows, recorded
   capture dates, the same `review_note` discipline.
3. **Research runs second, on 15 scenarios, not 155.** Smaller, sharper, and every
   one of them is a case where no reference we own could have answered it.
4. **Supplier quotes are a human workflow the research agent feeds.** The output is
   a call list with a named company and a specific question, not a price.

## What has not been checked

**Nobody has opened QV CostBuilder and confirmed it carries these items.** The
routing above is a model's professional judgement about what a reference of that
kind publishes. It is a strong prior — cable, switchboards and stud partitions are
core measured work — but it is a prior. The check is one person with a login
searching for "cable" and "stud partition", and it should happen before any capture
work is scoped.

The scenario scopes themselves are still model-written and unreviewed. That was true
before this exercise and is still true.

One of the three research runs hit `max_tokens` and returned unparseable output. The
call was billed. If the research script is used again it needs a higher ceiling.

## Cost

| | |
|---|---:|
| Research pilot, 3 scenarios, 30 web searches | $3.64 |
| Coverage match, 155 gaps against 145 rates | $1.63 |
| Source routing, 155 gaps | $0.81 |
| **Total** | **$6.08** |

The $3.64 that produced no rates is the most useful money spent. Without it we would
have run the full batch and found this out at $36 instead.
