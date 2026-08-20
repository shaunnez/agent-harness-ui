# Phase 6 runbook — verify the cognitive layer on real work

Everything in Phases 1-5 is unit- and integration-tested. **No live model has yet produced a
synthesis, a failure diagnosis, or a plan critique.** This runbook is the part that needs a human,
because it spends real credits and the high-risk task stops at approval gates.

Frozen base for all three runs: `b9726b0e5fc4506c4132203d31f137e9d0681b0d`

## Before you start

```bash
npm run dev
```

The store migrates on startup (`SqliteTaskStore.init` → `recoverInterrupted`). Verified against a
copy of the live 37MB database during Phase 6: all 29 existing tasks stayed readable and both new
policy ids were backfilled across all three profiles. Nothing to do by hand.

## The three tasks

Create each from the UI against this repository, at the frozen base above. Set the experiment
group to `harness-v2-phase-6` and give each its own variant and topology id.

| | Small | Medium | Large |
|---|---|---|---|
| Profile | `fast` | `standard` | `high-risk` |
| Variant id | `small-fast` | `medium-standard` | `large-high-risk` |
| Topology id | `topology-fast-bounded-v1` | `topology-cognitive-v1` | `topology-cognitive-v1` |
| Expect synthesis | skipped | executed | executed |
| Expect plan critic | skipped | executed | executed |
| Expect diagnosis | skipped if it fails | executed if it fails | executed if it fails |

Suggested briefs, chosen because each exercises a different depth without inventing work:

- **Small** — "The `biome.json` lint config does not cover the `docs/` directory. Add it and fix
  any findings." One package, no schema, no cross-module reasoning. Should cost few calls.
- **Medium** — "`server/failure-routing.mjs` has no route for a diagnosis that arrives with a
  confidence below 0.3. Decide whether low-confidence diagnoses should be admitted at all, and
  implement the decision." Genuinely needs a hypothesis and a plan; touches a module with tests.
- **Large** — "Split the safety envelope from the execution topology in
  `server/workflow-profiles.mjs`, so a profile chooses safeguards and a separate topology id
  chooses the graph." This is deferred item 2 from the main plan. Cross-module, changes a contract
  several modules read, and genuinely deserves architecture review.

## What to check afterwards

```bash
curl -s localhost:3000/api/evaluations/summary | python3 -m json.tool
```

Adjust the port if `scripts/dev.mjs` uses another. Then confirm, per the plan's Phase 6 acceptance:

1. Three distinct rows under `experiments.variants`, one per topology id and variant.
2. Non-empty `nodesExecuted` and `nodesSkipped` on each.
3. `nodeSkipCounts.synthesis` and `nodeSkipCounts["plan-review"]` are 1 on the fast row and
   absent on the other two.
4. `invalidTopologyTraces` is 0 everywhere. **Anything above 0 means a writer is broken** —
   reporting is fail-soft by design, so this counter is the only signal.
5. At least one `failureClassification` other than `IMPLEMENTATION_DEFECT` somewhere.

## The honest caveats

- **This is not a comparison.** F1 established that no historical task carries experiment
  metadata, so there is nothing to replay against. These three runs are first baselines. The
  claim they support is "topology X executed and was measured", never "topology X beat Y".
  Real comparison needs ~20+ paired runs that do not exist yet.
- **Do not manufacture a failure to exercise the backjump.** If none of the three runs fails
  naturally, acceptance criterion 5 goes unmet and the honest report is that the routing table is
  unit-tested but not yet observed. Write that down rather than forcing it.
- **The standard-profile diagnosis path has never run.** A probe in Phase 4 confirmed the two
  existing repair tests reach `_diagnoseFailure` but both are fast-profile early returns. If the
  medium or large task hits a gate failure, that is the first real exercise of it — worth watching
  closely.
- **Watch the cost of synthesis and the critic.** Synthesis runs at the planning tier and the
  critic runs cross-model. Both are new per-run costs on standard and high-risk. Compare
  `credits` and `outputTokens` on the medium row against a fast row to see what the cognitive
  layer actually costs.
