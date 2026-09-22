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

---

# Pinning the scope — three more runs

Rewrote the scenario with the three parameters fixed: light commercial duty, 100mm
nominal, 20m continuous run, one connection at 1.0m invert, and an explicit list of
what is in and out. Three Opus runs, $4.50 of plan usage.

| | unpinned (5 runs) | pinned (3 runs) |
|---|---|---|
| bands | 400–800, 310–860, 520–1050, 530–1040, 520–1050 | 570–620, 620–700, 580–800 |
| low spread | 1.71x | **1.09x** |
| high spread | 1.31x | 1.29x |
| full envelope | 310–1050 (**3.39x**) | 570–800 (**1.40x**) |
| QV rows cited by every run | 1 of 18 | **5 of 10** |

The three pinned bands overlap. A reviewer looking at 570–620, 620–700 and 580–800
is looking at one answer of roughly **$580–700 per metre**, not three.

## What is now identical across every run

| component | value |
|---|---|
| channel and grate, light commercial 100mm | 416.00 /m |
| sawcut existing paving, both sides | 28.20 /m |
| break out and cart 150mm RC paving | 70.4–105.6 /m |
| stormwater connection, amortised over 20m | 31.85 /m |

The rate lookup was already stable. Pinning the scope made the *build-up* stable too.

## What still varies, and why it is not a scope problem

Two things, both quantity conventions rather than rates:

1. **Reinstatement width.** Run 1 assumed 0.10–0.25 m² per metre, run 2 assumed
   0.40–0.60, run 3 assumed 0.15–0.30. Same rate ($144/m²), three different strip
   widths. That is a measurement convention a QS settles once and it applies to every
   trenching scenario in the catalogue.
2. **Whether the $416/m channel rate already includes its concrete haunch.** Run 3
   added a separate haunch component at 0–125/m; runs 1 and 2 treated it as included.
   The agent has flagged this same uncertainty in every run since the first one:
   *"whether t16 rates include concrete haunching — strongly indicated by rate level,
   not confirmed."*

Neither is fixed by more prompt text. The first needs a house measurement convention;
the second needs one person to open QV's item notes for table t16 and read them.

**That second one is worth stating plainly: a single unanswered question about one QV
table is responsible for a chunk of the remaining spread, and it is a thirty-second
lookup for whoever holds the login.**

## What this means for the other 154

The recipe is: pin duty/size, pin a nominal quantity so amortisation is defined, list
inclusions and exclusions, run three times, show the reviewer all three. Roughly
$4.50 of plan usage per scenario, and the scope text is a few minutes of QS time.

Untested beyond this one scenario.
