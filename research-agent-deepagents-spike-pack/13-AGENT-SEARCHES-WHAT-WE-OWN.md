# The agent has to be able to search what we own

22 September 2026. Written after being told, correctly, that the QV capture was
scripted rather than hand-done, and that the point of all this is making deep
research agents solve questions about plancheck and our other projects — not
cataloguing QV.

## Two corrections first

**The capture was scripted.** The README records "authenticated read-only DOM
captures", 143 capture events, all 246 in-scope sidebar URLs resolved, three batch
files. That is automation. I described it as a person capturing pages, which was
wrong. The tool that produced the batches is not in the plancheck repo; the batches
and the normaliser that consumes them are.

**"Fix retrieval" was the wrong diagnosis.** I said the IDF ranking was too weak. It
was not the ranking. Of the 12 scenarios in the earlier run, **all 12 ended by
writing a follow-up query they had no way to execute**:

> "In the same drainage document, pull the FULL table t16 including its sub-headings"

> "Electrical Services sub-sections: Mains and Submains, Cables and Cabling, XLPE,
> TPS, Cable Tray"

I had retrieved 45 rows once and handed over a fixed list. The model spent its last
tokens asking for a second query. **The bug was that searching was something I did to
the agent instead of something the agent could do.**

## What changed

Gave it three tools over the local QV capture and told it the order of resort:

| tool | what it does |
|---|---|
| `search_qv` | keyword search across 9,816 priced rows, optional section filter |
| `get_qv_table` | every row of the table a hit belongs to — siblings, size variants, tiers |
| `list_qv_sections` | what the capture actually covers, with row counts |

Plus server-side `web_search`, explicitly ranked below QV: web is for proprietary
equipment, network and lines-company charges, statutory and consultant fees.

Same 12 scenarios. 9.2 turns each, 10 to 22 QV queries per scenario.

| | web-only pilot | QV-first agent |
|---|---:|---:|
| Scenarios with a cost band | 0 of 3 | **11 of 12** |
| Components cited from QV | — | 89 |
| Components cited from web | 1 | 20 |
| Resolved inside QV alone | — | 4 |
| Resolved QV + web | — | 8 |

The one with no band is switchboard fault rating, where the missing piece is a fault
level and protection coordination study. That is a consultant's fee, and no band is
the right answer.

## What the output looks like

Channel drain, the scenario the web-only run could only answer with a Mitre 10 shelf
price. The agent ran 15 QV queries, pulled two whole tables, and built:

- Channel and grate installed, three price tiers, 297–561/m
- 160mm clear opening variant, 393–661/m
- Break into existing stormwater line, by depth, 583–1,590 each
- Lateral pipe, trench excavation, paving breakout, concrete reinstatement

Band: **310–561 per metre, Auckland, GST exclusive**, with the basis spelled out and
connection, lateral and reinstatement explicitly excluded and measured separately.

Its caveats are the interesting part:

> "Which QV tier equals which AS 3996 load class — sub-heading rows r9, r13, r16 of
> table t16 not captured; mapping inferred from the price ladder only"

**That is the agent diagnosing a gap in our own capture.** Sub-heading rows were
dropped during extraction, so the load classes are unlabelled and the agent had to
infer them from price order. That is a specific, fixable defect in the capture
pipeline, found by an agent trying to use it. It is the feed-and-heal loop working in
the direction that matters.

## The generalisable part

Nothing above is about QV. The pattern for any research agent on any of our projects:

1. **Every owned corpus becomes a search tool, not a pre-retrieval step.** If the
   agent cannot ask a second question, it will end its turn asking you to. The
   difference between 0 and 11 cost bands here was entirely that.
2. **Give it both a search and a "show me the whole neighbourhood" tool.** `search_qv`
   finds one row; `get_qv_table` gives the tiers and variants around it. Nearly every
   good build-up came from the second call, not the first.
3. **State the order of resort and make the agent declare which source answered.**
   `resolved_from` is how you find out whether you need better sources or more of
   them. Here: 4 QV-only, 8 QV+web, 0 web-only. Web is genuinely the last resort and
   now we can prove it rather than assert it.
4. **`not_established` is a feedback channel into the corpus, not just a caveat
   list.** The t16 sub-heading finding is a capture ticket. Route those somewhere.

Same shape for the completed-project loop, the variation register, or anything else:
a search tool per corpus, a stated order, a declared source, and gaps routed back.

## Cost, and why it is fixable

$33.54 for 12 scenarios — $2.80 each. At 155 scenarios that is roughly $430.

| | |
|---|---:|
| Input tokens | 5,780,687 → $28.90 |
| Output tokens | 152,192 → $3.80 |
| Web searches (83) | $0.83 |

**86% is input, and it is the same conversation re-sent 9.2 times.** No prompt caching
is in this script. Adding `cache_control` to the conversation prefix drops cache reads
to a tenth of input price and should bring this near $1 a scenario. That is the first
change to make, before scaling to 155.

The web search budget should also drop. Eight searches per scenario were allowed and
mostly used even where QV answered; four would do.

## What has not been checked

No QS has looked at any of these 11 bands. They are model output built from unreviewed
QV rows, and the whole point of the review surface is that a person rules on them.
The channel drain caveats say plainly that whether the t16 rates include concrete
haunching is "strongly indicated by rate level, not confirmed" — that is exactly the
kind of thing a reviewer settles in seconds and an agent cannot settle at all.

12 scenarios is 12 scenarios.

## Running total

| | |
|---|---:|
| Web-only research pilot, 3 scenarios | $3.64 |
| Coverage match, 155 gaps | $1.63 |
| Source routing, 155 gaps | $0.81 |
| Pre-retrieval QV lookup, 12 gaps | $1.23 |
| QV-first agent, 12 gaps | $33.54 |
| **Total** | **$40.85** |
