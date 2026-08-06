# P2-11 — per-gate auto-approve: design proposal

Not implemented. The spec flags this as a trust-model change rather than a settings
toggle, and it is. This is the proposal the operator decides on.

## What the gates are today

Every human gate is a task status the orchestrator parks on, plus an explicit approve
call that unparks it. They are not uniform, and that matters for which of them can
safely auto-approve.

| Gate | Status | Approve entry point | What the human is actually deciding |
|---|---|---|---|
| Grill | `awaiting-grill` | grill session close (`orchestrator.mjs:393`) | Whether the agent's understanding of the request is right, *before* any work |
| Specification | `awaiting-spec-approval` | `approveSpecification` (`orchestrator.mjs:484`) | Whether the written spec is the thing they wanted built |
| Plan | `awaiting-plan-approval` | `approvePlan` (`orchestrator.mjs:507`) | Whether the approach is acceptable |
| Candidate | `awaiting-human-approval` | reached at `orchestrator.mjs:1328` | Whether the finished diff is good, with every evidence gate green |
| Merge | (merge approval, `orchestrator.mjs:557`) | `approveMerge` (`orchestrator.mjs:519`) | Whether to write to the target branch |

The evidence gates — dev-review, test, final-review — are already automatic. They are
agent verdicts parsed into structured evidence, and nothing here proposes changing
them. This proposal is only about the five human gates above.

## The thing to be careful about

The product's claim is that a human saw the work. Auto-approving a gate does not just
save a click; it changes what an approval record *means*. Today an approval in
`task.approvals` is evidence a person looked. If some approvals are automatic and the
retained record cannot tell them apart, every historical approval becomes ambiguous —
including the ones a person really did make. That is the part that is hard to undo.

Two gates are also qualitatively different from the other three:

- **Merge** is the only gate that writes outside the worktree. Everything before it is
  reversible by discarding a candidate.
- **Grill** is the only gate whose input is a conversation rather than a verdict. There
  is no "approve" to automate — auto-advancing it means skipping it, which is a
  different feature and should be named differently.

## Proposal

**Per-gate setting, three values, defaulting to manual.**

Add to runtime settings (`defaultRuntimeSettings`, so existing stores migrate by the
`state.settings[key] === undefined` backfill already in `store.mjs:207`):

```
gatePolicy: {
  grill:         "manual",
  specification: "manual",
  plan:          "manual",
  candidate:     "manual",
  merge:         "manual",
}
```

Values:

- `manual` — today's behaviour. The task parks and waits.
- `auto` — the orchestrator records the approval itself and advances immediately.
- `auto-on-clean` — advances only if nothing is flagged: no failing evidence gate, no
  stale gate freshness, no blocking findings, no repair lineage on the stage. Anything
  else falls back to `manual` and parks as usual. This is the value most likely to be
  what an operator actually wants, and it is the one that keeps the gate meaningful.

**Merge is not offered `auto`.** Only `manual` or `auto-on-clean`. A gate that writes to
the target branch with no condition attached is not a setting anyone should be one
click away from, and refusing to offer it costs nothing — `auto-on-clean` covers the
real want ("don't make me click through green runs").

**The approval record must carry its provenance.** Every entry in `task.approvals`
gains an `actor` field: `"human"` or `"policy"`, plus which policy value produced it.
Backfill absent values as `"human"`, which is what they were. Without this, the whole
feature is untrustworthy in retrospect, and with it, an audit can still answer "did a
person see this?" for every task ever run.

**The UI states it, per task, where the gate would have been.** A gate that
auto-approved renders as an approval with a visible "approved by policy" treatment, not
as a silent skip. The operator should be able to see, on the task, that nobody looked.

**Grill is excluded from this setting entirely.** Automating it means not holding the
conversation at all. If that is wanted, it belongs in the workflow definition as a
workflow without a grill stage, not as an approval policy.

## Scope if accepted

1. `gatePolicy` in settings + migration backfill.
2. `actor` on approval records + backfill.
3. Orchestrator: at each of the four park points, consult the policy; for
   `auto-on-clean`, reuse the existing `candidateGateFailure` / `refreshGateFreshness`
   checks rather than writing a second notion of "clean".
4. Settings UI: four rows, `manual` default, merge missing the `auto` option.
5. Task UI: policy-approved approvals visually distinct from human ones.
6. Tests: each policy value at each gate; `auto-on-clean` parks on a dirty gate; a
   pre-existing approval with no `actor` reads as `human`.

## Recommendation

Ship `manual` and `auto-on-clean` only. Drop the unconditional `auto` from the first
version. It is the value that carries all the risk and almost none of the benefit — an
operator who wants fewer clicks wants fewer clicks *on green runs*, and if they later
genuinely want unconditional advance, adding a third value to a working setting is
cheap. Removing it after tasks have been approved under it is not.
