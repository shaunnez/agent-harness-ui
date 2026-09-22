# The review feed

Two JSON files, ready to render. Generated 22 September 2026 from 90 agent runs on the
Claude subscription.

## Files

| file | size | what it is |
|---|---:|---|
| `18b-review-index.json` | 17 KB | one row per scenario — everything a list view needs |
| `18a-review-feed.json` | 880 KB | the same 30 with full detail: every run, every cited QV row, the pinned scope |
| `18c-ask-feed.json` | 31 KB | three free-text questions answered end to end |

Render the index; fetch the detail record when a reviewer opens a row.

## One scenario record

```jsonc
{
  "scenario_id": "retaining-wall-construction",
  "title": "Retaining wall construction",
  "family": "civil",
  "unit": "m2 of retained face",
  "claims_covered": 29,

  "status": "agreed | disputed | not_established",
  "range":     {"min": 581, "max": 865},   // outer envelope across all runs
  "consensus": {"low": 727, "high": 838},  // median of the runs
  "agreement": {"low_ratio": 1.251, "high_ratio": 1.19,
                "runs_with_band": 3, "runs_total": 3},

  "currency": "NZD", "gst_basis": "exclusive",
  "centre": "Auckland", "as_of": "2026-09-22",

  "basis": "...what the band includes and excludes, in the agent's words",
  "pinned_scope": "...the full fixed specification the runs were given",

  "runs": [ /* each run's own band, components, and open questions */ ],

  "qv_sources": [{
     "row_id": "f8d9cf...:t24:r6",
     "url": "https://costbuilder.qv.co.nz/detailed-rates/external-works/external-works/",
     "section": "External Works / Retaining Walls: Pole",
     "group": "Poles at 1.0m centres, to retain up to:",
     "desc": "2.0m high, 250mm dia poles",
     "unit": "m²",
     "regional": {"Auckland":"727.00","Wellington":"697.00","Christchurch":"734.00",
                  "Hamilton":"671.00","Dunedin":"686.00","Palmerston North":"649.00"},
     "cited_by": 3
  }],
  "web_sources": ["https://..."],
  "open_questions": [ /* everything no run could establish */ ],

  "review": {"state":"pending","decision":null,"reviewer":null,
             "note":null,"decided_at":null},
  "record_sha256": "3f159f36118c5625"
}
```

`qv_sources` carries the actual QV row with its real six-centre prices and a link to
the page it came from, so a reviewer can check the agent's arithmetic against the
source without leaving the screen. `cited_by` says how many of the three runs used it.

`record_sha256` covers everything except the `review` block, so a decision can be
pinned to the exact version of the evidence it was made against.

## Reading status

- **agreed** (18) — three runs within 1.25x on the low end and 1.35x on the high.
  Show `consensus`. The reviewer reads one number.
- **disputed** (10) — show all three runs side by side. The disagreement is the
  signal: it localises the parameter the scope still leaves open.
- **not_established** (2) — no run would price it. Show `open_questions` and
  `suppliers_to_ring`. This is an answer, not an error.

One caution on `disputed`: retaining wall is flagged disputed at 1.251x, but reading
the basis shows QV publishes 1.6m and 2.0m pole walls and not the 1.8m the scope asked
for, so the runs bracketed rather than interpolated. That is correct behaviour scoring
as disagreement. A reviewer sees this immediately from the basis line; a threshold
alone does not.

## Free-text questions work too

Three questions written the way a customer or estimator would write them, one run
each, no pinned scope:

| question | answer |
|---|---|
| "how come you couldn't price the asbestos soffit removal on our tender?" | **$1,500–6,000** lump sum, Auckland, 7 assumptions named |
| "liquefaction-prone ground — what does ground improvement cost for a single-storey light commercial building in Christchurch?" | **$220–420 /m²** of footprint, 8 assumptions named |
| "cost impact of switching the roof from long-run coloursteel to membrane on a 1200m² warehouse" | **+$42–110 /m²** of roof, 8 assumptions named |

Each restates the question as a priceable scenario first, then lists every assumption
it had to invent — *"the tender did not state a technical category or CPT results"*,
*"single storey, ladder or light scaffold access"*. That list is what a reviewer
checks before the number.

This is the feedback-form path: a question in, a ranged answer with named assumptions
out, into the same review queue.

## Running one yourself

```
./18d-ask.sh "your question here" out.json
```

Refuses to start unless `claude auth status` reports `claude.ai`, and strips
ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN and ANTHROPIC_BASE_URL before spawning.

## Totals

30 scenarios covering 258 claims, 28 with a cost band, 90 runs, $149 of plan usage.
Plus three ad-hoc questions at about $1.70 each.
