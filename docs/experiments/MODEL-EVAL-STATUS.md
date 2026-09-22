# Model policy evaluation — status and the question of method

Written 22 Sep 2026, after six executions of EXP-001 and 39 tasks. This is a
decision document, not a result: it exists to answer whether the programme
should continue in its current shape before more quota is spent.

For the preregistered entries and per-run results see
[EXPERIMENT-REGISTER.md](EXPERIMENT-REGISTER.md). For the original design see
[../model-eval-baseline-proposal.md](../model-eval-baseline-proposal.md).

---

## 1. What we are trying to do

The harness runs ten model roles per task — triage, scouts, grill,
specification, plan, implement, repair, dev-review, test, final-review. Each can
take a different model at a different reasoning level. The question is which of
those assignments actually pay for a better model.

Varying all ten at once cannot attribute a difference to anything, so the design
groups roles into three bundles and varies **one bundle at a time** against a
frozen baseline:

| Bundle | Roles |
|---|---|
| **Understand** | triage, scouts, grill, specification, test |
| **Decide** | plan, dev-review, final-review |
| **Build** | implement, repair |

The primary outcome is **deterministic delivery**: a `full-manifest` verification
run whose `headRevision` equals the final candidate's head, reporting `passed`
with every declared command executed. Gate pass rate is explicitly *not* a
quality metric — three gate stages are themselves model runs, so a laxer reviewer
scores more passes without delivering more.

**Phase 0 (EXP-001)** measures baseline run-to-run variance on identical briefs.
**Phase A (EXP-002)** is 6 cases × 4 arms = 24 tasks, blocked on Phase 0.

Phase 0 exists because Phase A assumes one sample per arm-case resolves a
difference, and that assumption is false if the baseline disagrees with itself.

---

## 2. What we found

### The harness could not produce the measurement

Phase 0 took **six runs and 39 tasks** to produce its first two graded samples on
the hard case. Not one of the first 21 `C4-backend` failures was about model
policy. Each was a defect that hid the next one:

| Defect | Samples lost | Fixed |
|---|---|---|
| Gates defaulted to manual; three repetitions got different grill questions | 6 | policy set to auto-accept |
| Eval worktrees had no dependencies installed | 3 | provisioned; both bases verified green |
| `mergeState` passed the `commit:<sha>` sentinel to `git rev-parse` | 3 | `parseCommitSentinel` |
| 900s then 1800s run ceiling cut mid-work | 6 | raised to 3_600_000 as a runaway guard |
| Worktree root shared with the operator's real tasks; AH-027/028 collided with August directories | 2 | `AGENT_HARNESS_WORKTREE_ROOT` + standing rule 7 |
| Harness inherited `commit.gpgsign`; 1Password failed the commit after the agent finished | 4 | `-c commit.gpgsign=false` on harness git calls |
| Implement prompt forbade running the manifest, which no read-only diagnostic can satisfy for a formatter | 2 | format-gate carve-out |

Two of these were recorded as *model* failures before being diagnosed. Both
claims are withdrawn in the register. The instrument was broken, not the arm.

### What the campaign has actually delivered

39 tasks, **$36.01** of a $60 ceiling (API-rate estimate; nothing billed).

| Case | Tasks | Cost | Delivered |
|---|---|---|---|
| `C1-narrow` (standard, TS) | 15 | $8.12 | 5 — AH-020, 021, 025, 031, 032 |
| `C4-backend` (high-risk, Python+TS) | 18 | $27.89 | 1 — AH-039 |

`C1-narrow` has delivered on **every occasion it reached verification**. It is a
stable case and it does what Phase 0 needs a case to do.

`C4-backend` produced two graded samples, and they **disagree**: AH-039 passed
all seven commands; AH-037 failed at `frontend-build` after two dev-review
rejections, two repairs and a test-gate rejection, then exhausted its three
implement attempts. Same brief hash, same base, same policy matrix. That is the
run-to-run variance Phase 0 exists to measure, and it is the only such evidence
the campaign has produced.

One genuine model failure exists: AH-038 shipped two real mypy errors — a
nullable assigned to a `str`, and an import of a name its module does not
export — caught by a read-only check the prompt permits the agent to run.

### Cost, measurable only since run 6

| | Per delivered sample |
|---|---|
| `C1-narrow` | ~$0.65 |
| `C4-backend` | $7.81 (a *failed* C4 cost $10.50) |

`C4` is roughly **12× the cost per delivered sample**, and failures cost more
than successes because repair cycles are where the spend goes. EXP-002 runs
`C4-backend` four times. At observed rates that is $30–40 for one case, against a
$60 ceiling set before anyone had seen a C4 task finish.

---

## 3. What worked and what did not

**Worked.** Preregistration. Every wrong diagnosis above was caught because the
register forced a written prediction and a decision rule, and because the primary
metric is mechanical — a manifest result at an exact revision, not a model's
opinion. The `unknown` / `failed` distinction did real work: it kept 21
environment failures out of the numerator instead of quietly scoring them as
model defects. Pinning every role held: **zero policy divergences in 39 tasks**.

**Did not work.** The design assumed a working apparatus. There was no
precondition that a frozen base passes its own verification manifest, no check
that the experiment's worktree namespace was its own, and no dry run of one task
end-to-end before committing to a 6-task design. A single smoke test would have
found the first three defects for about $1.

**Actively misleading.** Two instruments silently set the result. The run ceiling
had no recorded derivation, and measured C4 implement runs on one unchanged brief
span 944s to past 1800s — so any limit drawn through that distribution decides the
delivery rate. Commit signing discarded four finished runs. Both are now removed
rather than tuned, because a tuned instrument is worse than an absent one.

---

## 4. Is this the correct way to do this?

Three problems with the design as written. The first two are fixable; the third
is the one that matters.

### 4.1 The baseline was never validated

The reference arm is "the shipped Codex standard matrix", frozen so the
comparison has a stable anchor. Nobody argued it is a *good* matrix. Looking at
it against the model catalogue:

| Model | Tier | $/M in | $/M out |
|---|---|---|---|
| `gpt-5.6-sol` | frontier | 5.00 | 30.00 |
| `gpt-5.6-terra` | balanced | 2.00 | 12.00 |
| `gpt-5.6-luna` | cheap | 0.20 | 1.20 |

The baseline runs the **cheapest tier** on implement, repair, specification,
grill, triage, scouts and test, reserving the frontier model for plan and
dev-review, and `final-review` runs cheap-tier at *medium* reasoning. `terra`,
the middle tier, is never used by any arm. The matrix is cost-shaped: the good
model reviews, the cheap model builds.

That may be right. It has not been tested. The campaign measures deltas from a
reference whose quality is assumed.

### 4.2 Specification can only get cheaper, never better

`specification` sits in the **Understand** bundle, and the only arm touching that
bundle — `A3-understand-cheap` — *lowers* it from xhigh to high on the same cheap
model. No arm anywhere upgrades the spec model. Across all 24 planned tasks,
specification runs cheap-tier in every single one. The same is true of grill.

So the design can answer "can understanding be cheaper?" but **cannot** answer
"does better understanding help?" That is a blind spot, not a finding the data
would ever surface.

The counter-argument is real and should be stated: specification feeds `plan`,
which already runs frontier, so a weak spec has a strong reader downstream —
whereas implement output goes straight to a candidate with no intermediary. That
defends the bundling. It does not test it.

### 4.3 There is no capability escalation anywhere

`standard` and `high-risk` profiles are **byte-for-byte identical** on model and
reasoning across all ten roles. `high-risk` buys more process — more scouts, more
gates, seven verification commands instead of five — on exactly the same models.
Only `fast` differs, and it differs downward.

Automatic repair escalation exists, but the campaign disables it deliberately:
pinning every role sets `rolePolicySources[role] = "task-override"`, which blocks
escalation entirely. Correct for measurement hygiene; it means no task in the
campaign could adapt.

So "this task is harder, use better models" is not a thing the system does. That
is worth fixing regardless of the experiment's outcome.

### 4.4 The method is sound; the sequencing was wrong

One bundle at a time is the right way to buy attribution, and it is not overkill:
24 runs is the *minimum* that attributes anything, because varying ten roles at
once attributes nothing. The problem is not the bundles.

The problem is that attribution is the **second** question. The first is whether
a better matrix delivers this work at all. Spending 24 attributed runs to measure
deltas from an unvalidated cost-shaped baseline optimises a configuration nobody
has shown is near a good one.

---

## 5. Recommendation

**Do not run EXP-002 yet.** Not because an arm lost, and not because the
apparatus is broken — it now works. Because the evidence contradicts the design's
power assumption: `C4-backend`'s split rests on n=2, and the cost per C4 sample
is 12× what the ceiling assumed.

Run one probe first, before any attributed campaign:

> **One `C4-backend` repetition with the entire matrix on the frontier tier.**
> Deliberately *not* attributable. ~$15–20. One question: does a strong matrix
> deliver this case cleanly?

- Delivers cleanly → headroom exists, the baseline is leaving quality on the
  table, and bundle attribution is worth paying for. EXP-002 proceeds, with the
  ceiling revised to observed C4 rates.
- Also fails or splits → the case is variance- or harness-dominated, and a
  24-run attributed campaign would have measured noise at ten times the price.

That is one run to decide whether 24 are worth it, and it tests the assumption
§4.1 leaves untested. It needs its own register entry stating plainly that it
buys a go/no-go signal and not an attributable result.

Two changes worth making regardless of what the probe says:

1. **Add an `A4-understand-strong` arm** that raises the Understand bundle rather
   than lowering it, so specification is testable in both directions.
2. **Make `high-risk` escalate models**, not just process. Choosing it currently
   buys more gates on the same cheap brains.

Both are preregistered-design changes: new register entry, recomputed manifest
SHA-256.
