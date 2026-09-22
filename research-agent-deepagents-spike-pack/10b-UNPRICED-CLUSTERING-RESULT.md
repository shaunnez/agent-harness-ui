# Scenario gap analysis — result

22 September 2026. Three model passes over the 629 unpriced issues. **Total spend $3.45**,
of which $0.50 was wasted on a bug of mine (read `content[0].text` when Sonnet 5 returns a
thinking block first; the calls were billed and discarded).

## The answer

**~155 material scenario gaps.** The question was whether the catalogue was short by 30 or
by 300. It is short by roughly its own size again: 120 scenarios exist, 155 more are needed
to cover what these eight tenders alone threw up.

| step | count |
|---|---:|
| Unpriced issues extracted | 629 |
| Judged priceable as a work class | 587 |
| Distinct work subjects | 343 |
| Scenarios after consolidation | 173 |
| After cross-family dedupe | 163 |
| **Material (high or medium)** | **155, covering 543 claims** |
| Immaterial (low) | 8, covering 53 claims |

## Two findings that change what to do

**Almost everything is priceable as a class, which I predicted wrongly.** I expected most of
the 629 to be unresearchable deferred decisions. They are not: a drain extent marked TBC is
still *channel drain installation*, and a class rate can exist even when this project's
quantity does not. Only 42 of 629 are genuinely unpriceable, and they cluster tightly —
undefined tenant fitout scope, nominated subcontractors with no named party, commercial terms.

**But priceable is not the same as worth pricing.** 53 claims are colour and finish
selections where the rate does not move: same paint, same labour, same m². The materiality
pass caught these and drew the line sensibly rather than dismissing all finishes — polished
concrete scored `high` because grind passes and dye do move the rate, and joinery finishing
scored `medium` with "finish system change matters; like-for-like colour change does not."

Without that second judgement the headline would have been 587 claims needing research. It
is 543, and the 44-claim difference is entirely work nobody should pay to research.

## The distribution decides the plan

The head is concentrated and the tail is long:

| scenarios researched | material claims covered |
|---:|---|
| top 10 | 151 of 543 (27%) |
| top 20 | 225 (41%) |
| top 30 | 280 (51%) |
| top 50 | 367 (67%) |

So do not research 155. **Research the top 20–30 and you cover half the population.** The
remainder is a long tail of one- and two-claim scenarios that should wait until the loop is
proven and then be fed by the customer feedback form rather than by a bulk run.

## What the budget actually is

Model cost for researching 30 scenarios is somewhere near $15 — irrelevant. **The entire
constraint is reviewer time.** At ten minutes per scenario that is five hours of QS
attention, and that number, not the API bill, decides the batch size.

This is the strongest argument yet for the return structure in `10a-RESEARCH-TRIGGER-SPEC.md`:
if the disqualifiers (`centre`, `gst_basis`, `as_of`, `effective_date`) are on the first line,
a reject takes thirty seconds instead of ten minutes, and the batch size roughly triples for
the same human cost.

## Top 15 material gaps

| claims | scenario | unit | what research must establish |
|---:|---|---|---|
| 29 | Retaining wall construction | m2 | Wall type, retained height, surcharge, foundation conditions |
| 23 | Channel drain installation to paving | m | Channel/grate load class rates, haunch concrete, connections |
| 19 | Suspended tile ceiling supply install | m2 | Tile type/NRC, grid system, height and seismic restraint |
| 17 | Mains and feeder cable installation | m | Cable size and type, route length, containment, terminations |
| 14 | Internal doorset supply and install | ea | Rates by leaf core, fire/acoustic rating, timber vs steel frame |
| 12 | Solar array mounting structural support | sum | Array size and weight, roof capacity, strengthening |
| 10 | Aluminium composite panel cladding | m2 | Panel system rates, subgirt spacing, access, flashings |
| 9 | Switchboard fault rating and protection | ea | Prospective fault current, breaker kA, discrimination |
| 9 | Solar connection switchboard works | ea | Inverter capacity, board modification extent, export limits |
| 9 | Facade and soffit coating | m2 | Coating spec, substrate prep, coats, access |
| 8 | Glazed vision panel to door | ea | Factory vs site cut, fire-rated glazing rates |
| 8 | Site establishment and compound relocation | sum | Fence length, shed size, crane needs, number of moves |
| 8 | Door hardware set installation | ea | Rates for standard, security and closer sets by grade |
| 8 | External concrete paving and slabs | m2 | Slab thickness, reinforcement, subbase, surface finish |
| 7 | Metering and control wiring installation | m | Cable type, run lengths, terminations, BMS interface |

## What this is not

These 163 scenarios were produced by a model in three passes, and nobody has checked them.
Two known weaknesses:

- **Scope bounds are invented.** "Retaining wall up to approximately 3m retained height" is a
  plausible bound, not a researched one. A QS may say the break is at 1.5m, or that the wall
  type matters more than the height.
- **The dedupe merged 9 groups and may have missed others, or merged wrongly.** It found three
  retaining-wall duplicates across civil, structure and external_works; there may be pairs it
  did not catch.

Before any research spend, someone who prices this work should read the top 30 and rule on
whether the scope bounds are the right ones. That is the cheapest possible check and it
governs everything downstream — a scenario scoped wrong produces research that answers the
wrong question.

## Files

- `scenario-gaps-final.json` — all 163 scenarios with merges, materiality and research need
- `research-batch-1.json` — the top 30 material scenarios, ready to trigger
- `labelled.json` — all 629 issues with subject, family, priceability
- `unpriced-issues.json` — the raw extract
