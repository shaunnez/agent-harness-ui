# The four open PRs: merge all, in this order

Checked 22 September 2026. All four are keepers. Two of them touch files the
consolidation plan edits, which is what fixes the order.

| PR | what | size | state | verdict |
|---|---|---:|---|---|
| **#115** | The live-model pilot handoff doc, revision 2 after Astra's review | +265, 1 file | mergeable | **Merge first.** One markdown file, no conflict, no code |
| **#101** | Model policy measured by deterministic delivery instead of gate passes | +3179, 25 files | mergeable | **Merge second.** Touches `src/domain/runtime.ts`, which Phase 3 also edits |
| **#112** | The live-model pilot implementation, Q1–Q6 | +4544, 19 files | **conflicting** | **Merge third.** The only conflict is `package.json` |
| **#116** | This pack: direction, clustering, the top 30, the review feed, the plan | +44860, 72 files | mergeable | **Merge last.** Docs and JSON only, no source |

## Why each one

### #115 — merge. It is the record of a decision.

The handoff doc Astra reviewed, with the revision-2 corrections that separated
acceptance from model selection. #116 supersedes its *recommendations* but does not
contain the file, and `10-RESEARCH-PRODUCT-DIRECTION.md` explicitly names what it
supersedes. Merging both leaves a coherent trail: 09 states the position, 10 replaces
it and says so. Dropping #115 leaves 10 referring to something that was never committed.

### #101 — merge. It fixes a real measurement bug and Phase 2 needs its discipline.

Independent of research: it is about SDLC model policy. The bug it fixes is worth
knowing about anyway — the scorecard reported gate pass rate as a quality signal, but
three gate stages are themselves model runs, so **a laxer reviewer policy scored more
passes.** The column rewarded exactly the failure an eval exists to catch.

Two things in it land directly on our Phase 2:

- **"Deterministic delivery, not gate passes."** Phase 2 compares four roles against one
  agent. If we score that on anything a model decides, we reproduce this bug in the
  research runtime.
- **`mixed-identity` labelling.** A variant pooling more than one brief, base, policy
  matrix or acceptance definition gets labelled rather than silently averaged. That is
  the same failure as averaging a scope disagreement into a price, which
  `15-REPEATABILITY.md` warns about.

`scripts/record-evaluation.mjs` can record the Phase 2 comparison.

**Order matters here.** #101 edits `src/domain/runtime.ts`, and Phase 3 adds
`kind: "delivery" | "research"` to `RuntimeProject` in the same file. Merge #101 first
and Phase 3 writes onto settled ground.

### #112 — merge, resolving one conflict. It holds guardrails the plan wants.

The conflict is `package.json` alone — a scripts-section collision. Everything else
applies cleanly.

Three files in it are things `21-CONSOLIDATION-PLAN.md` explicitly keeps and folds into
the new runtime:

- `scripts/research-model-pilot/secret-scan.mjs`
- `scripts/research-model-pilot/session-ledger.mjs`
- `scripts/research-model-pilot/preflight.mjs`

Plus `server/research/research-web-tools.mjs` gains a parent-side unique capture
ceiling, which is a keeper independent of anything LangGraph.

It also carries 46 deterministic checks covering oracle containment, ledger sharing,
capture ceilings, wrong-page evidence, invented prices and the rule that a missing human
review can never produce a pass. Those tests are the most valuable thing in the PR and
they are currently unmerged.

**Yes, we merge two files we plan to delete.** #112 edits
`server/research/deepagents/model-config.mjs` and `worker.mjs`, and Phase 4 removes both.
That is fine — merge then delete is ordinary, and the alternative is cherry-picking
three files and losing the tests and the history of how the 7 live sessions actually ran.

### #116 — merge last.

Docs and JSON, no source code. Nothing to conflict with.

One thing to decide: it puts `18a-review-feed.json` at 880 KB into the repository. It is
there because the review web page needs it, but if the feed is going to be regenerated
per run it belongs in the store or as an artifact, not in git. Merge it now as the
record of what was produced, and do not let the pattern continue past the prototype.

## Impact on the plan

| | |
|---|---|
| **Phase 0** (fake fails loudly) | Unaffected. Start now, independent of all four |
| **Phase 1** (port the CLI runtime) | Wants #112 merged first, so the pilot guardrails are on main to fold in |
| **Phase 2** (measure roles) | Wants #101 merged first, for the delivery-not-gate-passes discipline and `record-evaluation.mjs` |
| **Phase 3** (wire into the product) | Wants #101 merged first to avoid a `src/domain/runtime.ts` conflict |
| **Phase 4** (remove legacy) | Grows slightly: also removes `deepagents/` edits that arrive via #112 |

Nothing in the four changes the plan's shape or its estimate. They change its
prerequisites: **merge all four before Phase 1, and #101 before #112 or #116.**

## Order

```
#115  ->  #101  ->  #112 (resolve package.json)  ->  #116
```

Nothing needs dropping. Nothing blocks Phase 0.
