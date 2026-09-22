# Live-model research pilot — handoff and decision

> Status, 21 September 2026. Written at the end of the session that produced live sessions 1-7.
> Every figure here comes from retained artifacts under `.data/research-model-pilots/`, not from
> recollection.
>
> **Revision 2**, after review. Section 4 and recommendation A were wrong in the first revision and
> have been rewritten; section 9 records what changed and why. The receipts, PR contents, CI results
> and spend below have been reviewed as claims but not independently verified by a second party.
>
> The plan this reports against is `08-LIVE-MODEL-QUALITY-PILOT-PLAN.md`, which is **not on this
> branch**: it lives on `codex/research-live-model-pilot-plan` at commit `333c050` and has not been
> merged. Read it alongside this document.

## 1. The short version

Seven paid live sessions, $8.75 total, seven defects found and fixed. Opus 5, Sonnet 5 and Haiku 4.5
now all pass every automated check on the frozen four-case manifest.

That is not a pass. Those checks are eleven of twelve, the twelfth is human review and it has not
been run on any session that scored 4/4, and the runs that scored it came after five rounds of
harness repair on a metric the plan allows to be spent once.

**Status against the plan's own gate: not passed, and not yet assessable.**

| | |
| --- | --- |
| Paid sessions run | 7 |
| Total spend | $8.75 |
| Defects found and fixed | 7 (5 harness, 2 scorer) |
| Sessions with human entailment review | 1 of 7 |

## 2. Read this before quoting any number below

The plan specifies **one** paid live session, no retries, scored as a *first-attempt task gate
success rate*. We ran seven, fixing harness defects between them.

The plan is explicit about what that means:

> A second paid pilot requires a new manifest revision, new explicit allowance, and separate
> first-attempt metric; do not overwrite the failed session or present the repair attempt as the
> original first pass.

So the headline "Opus 4/4" is **session five, after five rounds of harness repair**. It is a
debugging result, not a first-attempt pass. Under the plan's own rules the first-attempt metric for
this manifest revision is spent, and a genuine Q7 requires a fresh manifest revision and one clean
run.

Separately: the twelfth check in the gate is human claim/evidence entailment. Sessions 5-7 — every
session that scored 4/4 — have **no** human verdicts. None of them constitutes a pass.

## 3. What actually happened

Every session used the identical frozen manifest
(`sha256:f3d3c0ea392da85a05ebbc799e0463e37274194c460f94da44795084d648a243`). Only the model
identity differed, and only in the last three.

| # | Model | Outcome | Cost | What it taught us |
| --- | --- | --- | --- | --- |
| 1 | Opus 5 | 0/4 | $0.30 | Session stopped early. All three cases that ran died on harness bugs, not research. |
| 2 | Opus 5 | 3/4 | $1.64 | Tool-error fix worked. One case still died on an out-of-range page read. |
| 3 | Opus 5 | 3/4 | $1.69 | A different case lost — Firecrawl could not fetch a page it had fetched an hour earlier. |
| 4 | Opus 5 | 3/4 | $1.83 | Another different case lost, to a Firecrawl outage. **Human-reviewed: 16/16 claims `supports`.** |
| 5 | Opus 5 | 4/4\* | $1.92 | First clean sweep of the automated checks. Not human-reviewed. |
| 6 | Haiku 4.5 | 4/4\* | $0.55 | Matched Opus on every automated check at a third the price. |
| 7 | Sonnet 5 | 4/4\* | $0.82 | Also matched. Fewest model calls of the three. |

\* 4/4 on the eleven automated checks only.

### The seven defects

Five in the harness, two in the scorer. Every one of them amounted to **scoring the harness as if it
were the model**.

1. **Tool errors were fatal.** No `ResearchToolError` was ever caught, so a correctable mistake — a
   malformed locator, an exhausted capture slot — killed the whole run. This alone destroyed three
   cases in session 1.
2. **The tool schema contradicted the host.** `submit_finding` advertised `section`, `selector`,
   `charStart` and `charEnd` in its locator while the host rejected any PDF locator that was not
   `page` alone. The model obeyed the schema it was given and the run was destroyed over a field
   name.
3. **Out-of-range page and offset reads were fatal** rather than correctable.
4. **A source that would not load was fatal** rather than a cue to choose another source.
5. **Provider outages were scored as model-quality failures.** A Firecrawl outage failed six checks
   and counted against the headline metric, which measures Firecrawl's uptime rather than research
   quality.
6. **Scorer: amounts were compared as raw substrings.** Bunnings renders `$73.04` as `$73 .04`. The
   model read it correctly, normalised it, and said so in its own claim — and was recorded as having
   invented a price.
7. **Scorer: every PDF excerpt had to sit on an expected page,** so a model that answered from the
   right page *and also* cited the two pages leading to it failed for showing its work.

Defects 6 and 7 changed scoring rather than the harness. Both were put to the owner as explicit
decisions before being written, rather than quietly applied after seeing results.

## 4. The finding that matters most

**Opus 5, Sonnet 5 and Haiku 4.5 all scored 4/4 on all eleven automated checks**, on the identical
manifest, on the same four cases.

The gate does not distinguish a $0.55 model from a $1.92 one.

**That is not, by itself, a defect.** An acceptance test exists to decide whether a candidate meets a
required quality bar, reliably and repeatably. It is under no obligation to rank candidates that all
clear it. A gate that passes three adequate models is behaving correctly. These are two separate
questions and the rest of this document keeps them apart:

- **Acceptance.** Does the harness reliably measure the quality this work requires? Unresolved — the
  first-attempt metric is spent, the four cases are narrow, and the twelfth check is unrun on every
  session that scored 4/4.
- **Model selection.** Which model do we ship, at what cost? Not answered here, and not answerable
  from an acceptance result whether or not it separates models.

What remains genuinely open is whether these four cases measure the right thing. They all ask the
same kind of question: find a stated fact in a document and quote it exactly. That is retrieval, and
any model that can read will do it. The one measurable difference the checks do not score is evidence
density — Opus produced 17 claims across the four questions, Sonnet 12, Haiku 7 — and whether that
reads as concise or thin is a human judgement nobody has made.

Four cases cannot distinguish "the test is too easy" from "the models are equivalent", and no number
of runs on these four cases will. That ambiguity is the single biggest open question in this handoff,
and it is an ambiguity about coverage, not about discrimination.

### Drafted but not run

Three adversarial cases against the James Hardie Hardie Weather Barrier technical data sheet, with
every oracle string verified as a literal substring of the retained document:

- **Published absence.** The steel-frame Direct Fixed cells contain `-`. The correct answer is that
  no value is published. The tempting wrong answer, `1.77`, sits immediately to the right in the same
  row.
- **Four-coordinate lookup.** One cell satisfies frame type, spacing, R-value, fixing system and
  season. The distractor `2.59` is reachable by *two* different single-coordinate errors.
- **Footnote disclosure.** The table says `1.93`, but note 5 requires subtracting `0.046` for the
  lining named in the question. Answering `1.93` alone answers a different question.

These test precision and honesty rather than source selection, because precision is what the current
checks cannot see. All three share one document, which makes them cheap (~$0.15 per model per case)
and narrows what they prove.

**These oracles were written by the same agent that would be graded against them.** They are verified
against the source document but not against a second reader's judgement. Case 3 in particular asserts
that note 5 scopes to that cell; if that reading is wrong, every model fails it unfairly.

## 5. The decision

Three coherent paths. They are not variations on one plan.

### A. Fix the instrument's coverage, then run a clean Q7 — *recommended*

Four ordered steps. Nothing here is a model-selection decision.

1. **Independent oracle review.** Someone other than the author checks the three drafted adversarial
   cases against the retained source: the table coordinates, the scope of note 5, and whether the
   published-absence reading is correct. Cases that survive are candidates; cases that do not are
   rewritten or dropped.
2. **Build a representative case set.** Not three cases against one document. Coverage is chosen
   against the work the runtime is actually meant to do — multiple documents, multiple markets,
   source selection as well as precision, and at least one case where the correct answer is that the
   question cannot be answered from public sources. The four existing cases are candidates for
   inclusion, not a foundation to extend.
3. **Freeze a fresh manifest revision and the acceptance rules** — the case set, the checks, the
   pass threshold and the human-review sample — *before* anything is run, and record the hash.
4. **Run one newly authorized paid pilot** against that revision, scored as a genuine first attempt,
   with the human entailment review completed as part of it.

**Activation eligibility and model selection stay separate.** Step 4 answers "is this good enough to
put in front of operators". It does not answer "which model", and a result in which several models
pass is a normal outcome, not a finding. Model choice is a later decision, made on cost and on
observed operator behaviour, and it needs its own comparison design if we want one.

- **For:** it is the only path that produces a defensible acceptance result, and it fixes the
  coverage gap rather than adding cases to a set already known to be narrow.
- **Against:** it is the slowest path. Steps 1 and 2 are human work — call it a day of design plus
  the review time — before any money is spent, and no operator sees anything until it finishes.
- **Cost:** the paid run scales with the case set, not with the three drafted cases. Twelve cases
  across one model is roughly $6; the earlier "~$2" figure covered only the three-case probe and
  should not be quoted for this path.

### B. Accept the gate as met and move to operator activation

Complete the human review on session 5 and, if it comes back clean, treat the pilot as passed in
substance if not in letter. This is a deliberate decision to accept a weaker acceptance result, not a
reinterpretation of the evidence. Proceed to the operator-only activation slice the plan describes:
explicit `runtimeId`, no default change, kill switch, small named cohort.

- **For:** real operator tasks will teach more than four synthetic cases ever will, and the plan
  itself says to observe whether operator tasks resemble the pilot.
- **Against:** it requires consciously accepting a debugging result as a first-attempt pass. The gate
  exists precisely to stop unsupported construction claims reaching people, and it has not been
  cleared.

### C. Pivot — the four-case gate is the wrong instrument

Accept that a fixed four-case gate with mandatory human entailment review neither scales nor
discriminates. Replace it with continuous sampling of real operator runs, reviewed in batches, using
the automated checks as a regression net rather than an activation gate.

- **For:** the human review is already the bottleneck at four cases and three models. It will not
  survive twelve. This is the honest read of what seven sessions demonstrated.
- **Against:** it discards a gate deliberately designed to be conservative, and does so *after* it
  failed to produce a clean pass — the worst possible moment to relax a standard.

## 6. Remaining slices

| Slice | State | Blocked on |
| --- | --- | --- |
| Q1-Q6 harness implementation | done | — |
| Q7 — one clean paid pilot | spent | New manifest revision and a fresh first-attempt run |
| Human entailment review, sessions 5-7 | not started | ~30 minutes of owner time per session |
| Adversarial case expansion | drafted, 3 cases, one document | Independent oracle review, then a coverage design that is not built on one document |
| Model selection (Opus / Sonnet / Haiku) | not started | A separate comparison design; not an output of the acceptance gate |
| Operator activation slice | not started | A pilot outcome, under whichever gate survives this decision |
| Subagents, Qwen, RAG | deferred by design | The roadmap defers all three until operator behaviour is observed |

## 7. What is solid regardless of the decision

Across seven live sessions: **zero credential leaks** (every artifact scanned every run), zero
fabricated amounts, zero bound violations, and every provider charge reconciled through the shared
ledger. The confidentiality and spend-control machinery worked from session one and never needed a
fix.

The one human review that has been completed — session 4, sixteen claims across three cases — came
back **16/16 `supports`**. That is genuine evidence of research quality, on a smaller sample than
anyone would like.

## 8. Repository state

Branch `claude/live-model-quality-pilot-ec013d`, PR #112, nine commits, pushed. Deterministic
qualification green: 760 tests passing, typecheck, lint and format clean.

One commit (`60859b8`) is unsigned because 1Password could not be unlocked non-interactively in that
session. It can be re-signed with `git commit --amend -S` if signature continuity matters for the
merge.

Rollback is unchanged and requires no database downgrade; the application default remains `fake`.

## 9. Review response — what changed in revision 2

This document was reviewed before any of its recommendations were acted on. One material objection
was upheld and the document was corrected rather than defended.

**The objection.** Recommendation A previously said that if three adversarial cases failed to
separate the models, "that is itself the answer: the work is easy enough that model choice is a cost
decision, and Haiku ships." Two errors:

1. **A null result from three cases over one shared document proves nothing about equivalence.** It
   is equally consistent with the cases being too narrow to discriminate. Treating it as a positive
   finding inverts the burden of proof.
2. **It conflated acceptance with model selection.** An acceptance test does not need to separate
   models to be useful; it needs to measure the required quality reliably. "Ship Haiku" is not an
   output an acceptance gate can produce.

**What changed.** Section 4 now states explicitly that non-discrimination is not a defect and
separates the two questions. Recommendation A is now a four-step path — independent oracle review,
a representative case set built for coverage rather than extended from the existing four, a frozen
manifest and acceptance rules, then one newly authorized pilot — and states that activation
eligibility and model selection are decided separately. The remaining-slices table gains model
selection as its own slice.

**What was not verified.** The reviewer assessed the document's reasoning, not its receipts: PR
contents, CI results, retained artifacts and spend figures have not been independently checked
against the repository. Three follow-up tasks were proposed and none has been run: audit the evidence
against the plan and receipts; independently review the three adversarial oracles against the source
PDF; and draft the corrected next-pilot brief with its own budget and stop conditions.
