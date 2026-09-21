# Research agents — direction, what we agreed, and what happens next

> 22 September 2026. Written at the end of the session that followed the live-model
> pilot handoff (`09-LIVE-MODEL-PILOT-HANDOFF.md`). This document supersedes that
> one's decision section. The pilot's harness fixes stand; its acceptance gate does not.
>
> Client-identifying data stays out of this document. The extracted dataset it refers
> to is local only.

## 1. What we got wrong, and what replaced it

Four things changed in this session. Each one invalidated work that came before it.

**The pilot measured the wrong capability.** The four frozen cases ask: find a stated
fact in a document and quote it exactly. That is retrieval, and every model can do it —
which is why Opus, Sonnet and Haiku scored identically. The real job is judging whether
evidence *applies*: right jurisdiction, right date, right scope. A rate that is UK, or
2019, or priced for different work, is worse than no rate, because it looks like an
answer and flows into a price.

**There are two loops, not one, and they don't share a runtime.** Outward research
reaches the public web through Firecrawl/Serper — everything it touches leaves the
machine. Inward learning reads completed project documents, which are private and
bounded, and must not. The inward system already exists: it is plancheck, with its
proposer/judge split and corpus guard. The research runtime should not be extended to
cover it.

**Hindsight contamination is not a risk here.** An earlier draft treated learning from
completed projects as a prediction problem needing train/test discipline. It isn't. We
show a user comparables — *other projects with issues like this saw variations of
$x–y* — and a person decides. No model learns outcomes to predict outcomes.

**A human reviews every output before it feeds back.** That is a design decision, and
it moves the quality bar. Correctness is not the bar, because the reviewer catches
wrong answers. The failure modes that matter are: output too thin to teach anything;
output plausible and inapplicable, which burns twenty minutes to falsify; and volume
the reviewer cannot keep up with, at which point they rubber-stamp and the loop
silently stops working.

## 2. The data, as it actually stands

Extracted from the plancheck database, latest register per tender and latest succeeded
pricing job per register. "Unpriced" means `construction_pricing_results.state =
'unmatched'` with `reason = 'no_match'`: the pricing run completed and no scenario in
the catalogue covered the claim.

| | |
|---|---:|
| Unpriced issues | 629 |
| Tenders | 8, across 2 accounts |
| Catalogue scenarios today | 120 |
| Claims priced across all 8 tenders | 22 |

Two claim types are 72% of the population: `deferred_selection` (267) and
`deferred_dimension_or_parameter` (187). Both mean the same thing — somebody has not
made a decision yet.

**Which is why most of these cannot be researched, and should not be.** Real examples:
a drain extent marked TBC pending civil levels; a meter schedule to be confirmed; a
fire interface with no counterparty named. No public source knows this project's
answer. Asking an agent to resolve the deferral is asking it to invent one.

What research *can* establish is what the **class** costs when it moves. A scenario for
"channel drain, additional linear metres, Auckland" prices one claim and every sibling
across all eight tenders.

**So the unit of research output is a scenario, not a claim.** This is the single most
consequential thing in this document. It sets the approval unit, the economics, and the
shape of the review screen.

## 3. What we agreed

**Construction bands first. Remedy pricing deferred.** The test is recurrence. Remedy
pricing is a closed list — thirteen actions, a handful of disciplines, perhaps forty
rate lookups and it is finished, and a QS settles it faster than an agent can. Nothing
recurs: next tender's `CLARIFY_IN_WRITING` uses the same fee scale. Construction bands
are unbounded and compound with every tender. Building for both now means two schemas
and two reviewer flows before either is known to work.

**The approval unit is the scenario.** Approving one output re-prices many claims
across several tenders. That is a different screen from "approve this answer."

**Findings write to a proposals table, never to the catalogue.** The catalogue changes
only on approval, versioned. The pattern already exists —
`construction_catalogue_releases` with `content_sha256` and a single active flag — so a
bad approval is a revert, not an incident.

**The feedback form is the quality metric.** A customer asks why something could not be
priced; it routes to research; an answer goes back; we learn whether it closed. That is
a real outcome signal from real users and it costs nothing to collect. Log the question,
the trigger and whether it satisfied.

**Triage starts as rules, not a classifier.** "Why couldn't you price Z" where Z is a
claim id is a lookup. Let a model earn its place once there are a hundred real messages
showing the actual distribution, rather than tuning against imagined traffic.

**Live agent view is secondary.** Status and findings-as-they-land are useful; a thought
stream is compelling for a week and rarely actionable. Build it for debugging and early
trust, not as the primary surface.

## 4. The return structure

It mirrors `construction_catalogue_releases.content.scenarios[]` and the
`construction_pricing_results.estimate` fields, so a reviewer-approved output becomes a
catalogue scenario with no schema work. Full shape with a worked example is in
`RESEARCH-TRIGGER-SPEC.md` alongside the dataset.

One field is new. **`not_established`** — the list of things the research could not pin
down. An output that resolves nothing but names four unsourceable facts is a real
result: it tells a QS where to spend their own time, and it is the honest alternative to
a confident wrong rate. Bad answers are still worth something, provided they say so.

Provenance fields (`url`, `publisher`, `locator`, publication and effective dates,
`snapshot_sha256`) mirror what QV CostBuilder rows already carry. `centre`, `gst_basis`,
`as_of` and `effective_date` are the disqualifiers — a reviewer should be able to reject
on those four before reading any prose.

## 5. Next steps

1. **Cluster the 629 into candidate scenarios.** One model pass over claim, trigger and
   claim type. Output: a scenario gap list with claim counts per gap. This answers
   whether the real gap is 30 scenarios or 300, and that number decides how much of
   section 3 is worth building. Everything else waits on it.
2. **Run research on the largest 10–20 gaps.** Raw JSON output, no interface.
3. **Sit with a QS over that raw output.** Record time-per-item and, on rejection, the
   *first* fact that killed it. Those reject reasons are the review screen's layout, in
   priority order, and the common ones become cheap automated pre-filters later.
4. **Then** build the proposals table and the review surface.

## 6. What this supersedes

- The four-case acceptance gate as an activation instrument. It measured retrieval.
- Paths A and B from the pilot handoff. Path C was right, for a worse reason than the
  one that now supports it: human review is not a bottleneck to engineer around, it is a
  product feature that produces the measurement for free.
- Any plan to harvest test oracles from repository documents. Some of that prose is
  AI-written doctrine nobody signed off; one instance was caught in this session. A
  human has to say which rules are real.

## 7. What still stands

The harness fixes from the pilot are real and worth keeping: correctable tool errors
return to the model instead of killing a run, and provider outages score as unassessed
rather than as model failures. Those are on `claude/live-model-quality-pilot-ec013d`
(PR #112), 760 tests green.

The confidentiality and spend machinery worked from the first session and never needed a
fix: zero credential leaks across seven paid runs, every provider charge reconciled.
