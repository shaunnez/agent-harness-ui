# Harness V2 — handoff

**State:** Phases 0–6 of `docs/harness-v2-cognitive-layer-plan.md` are complete. 13 commits on
`claude/agentic-sdlc-orchestration-3c10ae`, head `afcca4c`, working tree clean, no servers running.

**All four gates pass:** `npm run lint` (231 files) · `npm run format:check` · `npm run typecheck` ·
`npm test` (498 tests, was 429 at baseline).

Read `docs/harness-v2/progress.md` for the full record. This file is the short version.

---

## What was built

A cognitive layer above the existing execution machinery. **Nothing in the candidate, worktree,
gate, repair-authority or PR-authority architecture was changed.**

| Phase | What it added | Key files |
|---|---|---|
| 1 | Topology is an experimental variable | `server/evaluation.mjs` |
| 2 | Three typed cross-stage contracts + renderers | `server/structured-output.mjs`, `server/contract-rendering.mjs` |
| 3 | `synthesis` stage — facts become a ranked belief | `server/orchestrator-investigation.mjs`, `server/topology-trace.mjs` |
| 4 | Failure diagnosis + deterministic backjump routing | `server/orchestrator-failure-diagnosis.mjs`, `server/failure-routing.mjs` |
| 5 | `plan-review` stage — cross-model plan critic | `server/orchestrator-specification-planning.mjs` |
| 6 | Two live runs; telemetry verified through persistence | `tests/topology-telemetry-persistence.test.mjs` |

Two constraints are enforced by **shape, not prompt wording**: a hypothesis must cite evidence, and
a blocking plan critique must cite evidence *and* name one of ten closed dimensions — so an
aesthetic objection can only ever land as advisory.

## Proven live

Two runs against this repo, recorded in the live store as **AH-030** and **AH-031**.

- The full path executes: `triage → scouts → synthesis → grill → specification → plan → plan-review`.
- **Synthesis found a real defect in a human-written brief.** On AH-030 it returned 0.84 confidence
  that the requested change was insufficient — `npm run lint` hardcodes its path arguments, so
  editing `biome.json` alone would have looked done and not been. Grill turned exactly that into
  the one question worth asking a human.
- The plan critic returned substantive PASSes, with in-dimension advisory notes, not rubber stamps.
- The change AH-031 produced is landed and verified: `npm run lint` now covers `vite.config.mjs`.
- Cost of the layer on a small task, measured: ~117k input tokens (63k cached), 10k output,
  0.22 credits, ~$0.37 to plan approval. Four distinct models in one task.

## The one thing blocking further dogfooding

**Q5 — a dependent slice is rejected as drifted from its own predecessor.** Not fixed, deliberately:
it is inside candidate/worktree lineage, and the check exists to stop evidence being attributed to
the wrong commit.

```
S2: The candidate worktree is at ec3d624 but the candidate records 5cd3583;
    verification evidence would describe a different commit.
```

`ec3d624` is S1's own commit. Reproducible across two fresh slice worktrees. Consequence: **any plan
with a dependent second package cannot pass implementation.** Single-package plans are fine.

Start here if you want the harness to work on itself for anything non-trivial.

## Open decisions (details in progress.md)

1. **Q5** above — the highest-value fix remaining.
2. **Q1** — `synthesis` and `plan-review` are deliberately not rooms on the Atlas floor plan: no free
   slot in the top row, and `final-review` is already named "Synthesis Room". Say the word to reflow.
3. **Q2** — the plan revise loop is operator-triggered, not automatic. Full automation means minting
   a run reservation mid-flight. Recommendation: measure first; if critics rarely REVISE it buys
   nothing.

## What is measured, and what is not

The eval lab now records topology (`topologyId`, `nodesExecuted`, `nodesSkipped`, `edgesTaken`,
`routingDecisions`, `backjumpCount`, `challengeCount`, `failureClassifications`) and it survives
persistence on both stores.

**But there is no comparison yet, and nothing here supports one.** Before this work, all 29
historical tasks had `experiment: null` and `evaluation: null` — the lab had never processed a real
run, so there is nothing to replay against. AH-030 and AH-031 are first baselines. Real comparison
needs roughly twenty paired runs that do not exist. Accumulating them is the long pole, and it was
the long pole before any of this started.

Also unmeasured: whether models over-reach for upstream classifications when
`IMPLEMENTATION_DEFECT` is the honest answer, and whether ten critique dimensions are the right ten.

## The lesson worth carrying forward

**Bugs in Phases 1–5 found by running the system: five.** Provider mis-anchoring, a hardcoded stage
denominator, a bare dash in the stage rail, an incomplete topology trace, and two unformatted files.

**Found by adding tests afterwards: zero.**

The sharpest one: my unit test asserted "the critic's model differs from the planner's". It *passed*,
and the behaviour was still wrong — a Claude planner was getting an OpenAI critic, different by
accident across vendors rather than opposition by design. A true assertion sitting on top of wrong
behaviour. Boot the thing and read the screen.

## Resuming

Nothing is in session state. To continue:

```bash
git log --oneline -14
```

Then read `docs/harness-v2/progress.md` — findings F1–F13, open questions Q1–Q5. The `/loop` prompt
in the session history still works; it reads the ledger first, so it picks up wherever the ledger
says it is.
