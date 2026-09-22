# Five runs of one scenario

Channel drain installation, Opus 5, identical prompt, five times. $6.92 of plan usage.

| run | band | QV rows cited | queries | turns |
|---|---|---:|---:|---:|
| 1 | 400–800 /m | 7 | 12 | 17 |
| 2 | 310–860 /m | 8 | 16 | 21 |
| 3 | 520–1050 /m | 7 | 15 | 22 |
| 4 | 530–1040 /m | 4 | 12 | 16 |
| 5 | 520–1050 /m | 8 | 13 | 18 |

Low end varies 1.71x, high end 1.31x. Three of five agree closely (520–1050,
530–1040, 520–1050); two sit lower. Every run reported `medium` confidence and
listed exactly 6 `not_established` items.

## Where the variance is not

**The QV lookup is stable.** Every run found the same channel rate and read it the
same way:

| run | cheapest channel component |
|---|---|
| 1 | 297–310, residential duty |
| 2 | 310, residential 100mm |
| 3 | 310, residential class 100mm |
| 4 | 310–661, supply and install |
| 5 | 297–310, footpath/residential duty |

Retrieval, the group labels and the rate itself reproduce. 18 distinct QV rows were
cited across the five runs, but the disagreement is about which rows *belong*, not
what any row says.

## Where the variance is

The assembly. All five priced channel, haunch, reinstatement and connection. Three
added sawcutting; two added trench excavation. More importantly, they differ on how
much of the surrounding work gets amortised into a per-metre figure at all — a
connection point spread over a 6m run and over a 20m run give very different
per-metre numbers, and nothing in the scenario says which.

The scenario scope reads: *"Supply and install proprietary channel drain with grate
in paved external area, including connection to stormwater."* It does not state the
duty class, the run length, or whether reinstatement is in or out. Those three
choices are the entire spread.

**This is the unreviewed scope problem, showing up as measurement noise.** It is not
model randomness and it will not be fixed by a better model or a lower temperature.

## What to do

1. **Pin the three parameters in the scenario scope** — duty class, nominal run
   length, and what is in versus out. That is a QS decision, it takes minutes per
   scenario, and it is the same scope review flagged before any of this started.
2. **Run each scenario three times and show the reviewer all three.** Where the three
   agree, the reviewer reads one. Where they diverge, the divergence is the signal —
   it localises exactly which assumption is unstated. Three Opus runs cost about
   $4 of plan usage per scenario.
3. **Do not average them.** The median of a scope disagreement is not a price.

## Caveat

Five runs of one scenario. Whether the same pattern holds elsewhere is untested, and
the scenarios that resolved from a single QV row may well be stable at one run.
