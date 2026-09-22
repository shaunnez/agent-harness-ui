# Check QV first — and QV is already on this machine

22 September 2026. Written after being asked whether we should store QV CostBuilder
credentials and log in with Firecrawl. We should not. Total model spend to reach this:
$7.31.

## The short answer to all three questions

**"Research agents should check QV first."** Right, and that is a local lookup. No
login, no crawl, no network.

**"There's a script that pulls the latest rates — we probably don't want to run it
all the time."** It does not pull anything. Its own docstring is *"Index authorised
local DOM captures; never fetch or import application prices."* Re-running it is a
no-op unless a person does a fresh browser capture first. There is nothing to
schedule and nothing to throttle.

**"We could store credentials in an env var and scan it with Firecrawl."** Not
needed. The scan already happened, on 9 September 2026, and the result is sitting in
`~/plancheck-sets/qv_costbuilder/2026-09-09/`.

## What is actually on disk

| | |
|---|---:|
| Pages captured | 141 |
| Tables | 1,026 |
| Source rows | 19,577 |
| Indexed items | 10,880 |
| **Indexed items carrying six-centre prices** | **9,816** |
| Of those, promoted into the active catalogue | **145** |

Every one of the 9,816 carries Auckland, Wellington, Christchurch, Hamilton, Dunedin
and Palmerston North values, a hash-anchored row id, a section path and a unit. Every
one is marked `review_status: unreviewed_source_reference` and
`calculation_eligible: false` — deliberately. The normaliser treats parsed rows as
search aids, and a human promotes them into the catalogue.

**145 of 9,816 have been promoted. That is 1.5%.**

Yesterday I reported the gap as "QV capture expansion". That was wrong. The capture
is done. The gap is the promotion review, and the promotion review is exactly the
human-in-the-loop surface this whole product direction has been circling.

Every item I listed as absent is in the capture:

| I said | In the capture |
|---|---:|
| "no cable rates at all" | 218 rows mentioning cable; Electrical Services, 597 indexed |
| "no switchboard rates" | 54 rows |
| "no fencing rate of any kind" | 27 rows; External Works, 168 indexed |
| "no stud framing rate" | 21 steel stud rows; Partitions, 135 indexed |
| "no luminaire or emergency light rates" | 61 and 8 rows |
| "no preliminaries or site establishment rates at all" | Preliminaries, 167 indexed |
| "no door hardware rates" | Hardware, 454 indexed |

## Proving the lookup works

Built a QV-first retrieval — plain IDF scoring over description and section path,
top 45 rows per scenario, one Opus 5 call to judge whether they build the scenario.
Ran it over the top 12 gaps. $1.23.

| Verdict | n |
|---|---:|
| `sufficient` — buildable from the rows retrieved | 2 |
| `needs_more_qv` — QV clearly has it, retrieval missed it | 8 |
| `needs_outside` — genuinely not QV's territory | 2 |

Ten of twelve were answered inside QV. Only two needed the outside world, and both
were the category predicted: a structural engineer's PS1 and wind-uplift calculation
for solar mounting, and a fault-level and protection coordination study for
switchboards. Consultant fees, not measured work.

**The eight `needs_more_qv` are my retrieval failing, not QV lacking the rate.** IDF
over a one-line description is a weak instrument against 9,816 rows of terse QS
phrasing. The model said exactly where to look each time — *"Electrical Services
sub-sections: Mains and Submains, Cables and Cabling, Power Reticulation, XLPE, TPS,
Cable Tray"* — which is a retrieval brief, not a research brief.

It also did the QS work while it was there. On the ceiling scenario it flagged that
an aggregate row must not be combined with its own components. On the ACP cladding
scenario it substituted a plain aluminium sheet rate and said plainly that a reviewer
could reject the substitution and should then search for Alucobond, Vitrabond,
Alpolic and Larson by name.

## The order of resort

1. **Active catalogue** (145 rates) — already priced, nothing to do.
2. **Local QV capture** (9,816 priced rows) — retrieve, propose, human promotes.
   This is where roughly 70–80% of the population is answered.
3. **Web research** — proprietary systems, statutory and network fees, consultant
   fees. Roughly 15 scenarios, 41 claims.
4. **Supplier quote** — nothing published anywhere; the agent produces a call list
   with a named company and a specific question. Roughly 23 scenarios, 44 claims.

Web research earns its place at step 3, not step 1. That reverses the order I had.

## On credentials and Firecrawl

Three reasons not to, in order of weight:

1. **The data is already here**, captured 9 September, hash-anchored and reviewable.
   Nothing about the top 30 gaps needs a fresh page.
2. **The existing pipeline was deliberately built not to fetch.** "Never fetch or
   import application prices" is a design decision someone made on purpose about a
   licensed subscription product. Wiring a credentialed crawler around it reverses
   that decision, and whether it is permitted under the QV subscription terms is a
   question for you, not a technical one.
3. **A stored credential turns a read-only local pipeline into a live authenticated
   one**, with the audit and secret-handling burden that implies, for no gain against
   the current backlog.

If a refresh is wanted later, the honest version is the one already in place: a
person opens QV, captures the DOM, drops the batch in, and the normaliser indexes it
with a new capture date. That is a deliberate, dated, auditable act. Recommend
leaving it that way.

## Next

**Fix retrieval before anything else.** Section-aware retrieval — pull the whole QV
sub-table the model names rather than 45 loose rows — would likely move most of the
eight `needs_more_qv` to `sufficient`. That is a day of work against a local file and
costs nothing per run.

Then the product is clear: an agent proposes a promotion from the 9,816, cites row
ids and its caveats, and a QS approves or rejects in the review surface. The research
agent runs only on what survives that.

## What has not been checked

Nobody has confirmed a single one of the 9,816 rows is correctly parsed. They are
marked unreviewed for a reason — unit conventions in QV vary by table, and the
existing catalogue's `review_note` records two separate unit conventions already
found and reasoned about. A promotion proposal is a draft for a reviewer, never a
price.

The 12-scenario run is 12 scenarios. The 70–80% figure above is an extrapolation
from it and should be treated as a hypothesis until the full set runs.

## Cost

| | |
|---|---:|
| Research pilot, 3 scenarios, 30 web searches | $3.64 |
| Coverage match, 155 gaps against 145 catalogue rates | $1.63 |
| Source routing, 155 gaps | $0.81 |
| QV-first lookup, 12 gaps against 9,816 local rows | $1.23 |
| **Total** | **$7.31** |
