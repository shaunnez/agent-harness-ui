# Model evaluation: baseline proposal and runbook

Date: 19 September 2026
Status: gap-closing engineering done and verified; campaign manifests prepared; **no model
runs executed, no defaults changed, no budget spent**. §7 lists what remains before the
first run.

Companion to `docs/model-policy-evaluation-plan.md` (P1–P5 programme). That document
sets the direction. This one records what is actually built today, which of its
assumptions have since changed, and a concrete first campaign that fits the
evidence the harness can currently produce.

---

## 1. What exists today (verified, 19 Sep 2026)

### Recording

`POST /api/tasks` accepts an optional `experiment` object:

```json
{
  "groupId": "harness-v2-phase-6",
  "variantId": "dependent-slices",
  "frozenBaseSha": "<40-hex>",
  "acceptanceCriteria": ["..."],
  "verificationCommands": ["npm test"]
}
```

On creation (`server/task-creation-routes.mjs:69`) the server:

- requires a full 40–64 hex SHA and resolves it with `git rev-parse --verify`;
- **requires the repository's HEAD to equal that SHA** — otherwise the create fails;
- hashes the brief (`hashTaskBrief`: title, description, workflow, priority, attachment
  content hashes) into `taskBriefHash`;
- snapshots the *selected* stage-policy matrix into `experiment.policyMatrix`;
- captures repository authority with `frozenRevision` set, so candidate worktrees
  branch from the frozen base rather than moving HEAD.

### Reporting

`GET /api/evaluations/summary` → `buildEvaluationSummary` (`server/evaluation.mjs`)
returns two independent reports:

| Report | Grouping | Notes |
| --- | --- | --- |
| `observations` | `role \| model \| reasoning` over every historical artifact | Confounded by task, context and policy. Useful only for usage/cache/cost shape. |
| `experiments` | `groupId \| variantId` over tasks carrying `experiment` | Frozen-identity comparison surface. |

Per controlled variant it computes: sample count, brief-hash set, policy matrices,
acceptance/verification definition sets, gate attempts, first-pass and eventual gate
success, repair count, retry count, wall time (total and mean), per-role durations,
input/cached/output tokens, cache rate, credits, API estimate, context characters and
estimated context tokens, mean human score, mean blind score.

### Scoring

`POST /api/tasks/:id/evaluation` → `normalizeEvaluationInput`. Accepts `score` (integer
1–5), `outcome` (`accepted` / `rejected` / `mixed`), `notes`, `evaluator`, `kind`
(`human` | `blind`), `rubric` (named 1–5 scores), `suiteId`, `caseId`.

### Policy fidelity (P1) — landed

`server/effective-policy.mjs` (`EFFECTIVE_POLICY_VERSION = 1`, commit `ea05775`)
is the single resolver. It rejects missing policies, enforces `providerConstraint`,
records `source`, `selectedModel/Reasoning`, `model/reasoning` and `escalationReason`,
and `effectivePolicyFromReservation` refuses a reservation that predates the contract.
The repair role now uses its own policy; escalation fires only when the role is
**unpinned** and a verified P0/P1 or architectural-risk candidate defect exists.

This closes the largest contamination risk named in the earlier plan. Verify it again
before launch, but do not plan around the old broken resolver.

### Current data

84 tasks in `.data/tasks.sqlite3`:

| Repository | Tasks |
| --- | --- |
| `agent-harness-ui` | 34 (+6 in a worktree path) |
| `eversor-mystrataassist` | 27 |
| `eversor-plancheck` | 17 |

Six carry an `experiment` record, all `groupId: harness-v2-phase-6`, all on
`agent-harness-ui`: `small-fast` (AH-030), `small-standard` (AH-031),
`dependent-packages` (AH-032), `dependent-slices` (AH-033/034/035).

**Zero tasks have any `evaluation` record.** There is no quality label in the system.

---

## 2. Gaps that must be closed before the numbers mean anything

Ranked by how badly they distort a result, not by effort.

### G1 — Model gate pass rate is not a quality metric when the reviewer is the variable

`firstPassGateSuccessRate` and `eventualGateSuccessRate` are computed from the
`dev-review`, `test` and `final-review` **gate verdicts**, and three of those stages are
themselves model-run. A weaker or laxer reviewer model produces *more* PASSes. Ranking
policies on gate pass rate therefore rewards exactly the wrong thing.

Fix: make the primary outcome the **deterministic verification result** — every command
declared in the repository's `.agent-harness/verification.json` passing on the final exact
candidate revision. That signal is provider-independent. Model gate verdicts become a
*separate* measure of reviewer strictness, scored against seeded defects (§5.3).

### G2 — Incomparable samples are pooled silently

`controlledSummary` groups on `groupId|variantId` and reports `taskBriefHashes` as a set,
but computes pooled rates regardless of how many distinct hashes or bases are inside.
The existing `dependent-slices` variant is the live example: three samples, three brief
hashes, two different base SHAs (`af6c6562` ×2, `cccb16fe` ×1). The UI honestly prints
"3 brief hashes" and then shows one pooled 3/3.

Fix: flag or segregate any variant with more than one brief hash or more than one base
SHA. A pooled rate over mixed identity should not render as a result.

### G3 — No per-case pairing

Grouping is `groupId|variantId` only; `caseId` lives on `evaluation`, not `experiment`.
Paired per-case comparison — the only comparison with enough power at these sample
sizes — cannot be computed from the summary.

Fix (no schema change needed): use a compound `variantId` of `<caseId>__<armId>`, so each
variantId holds exactly one brief hash and one base, and pairing is a string split. Adopt
this as the naming contract. The existing six records used `variantId` as the *case*,
with no arm, which is why they cannot be compared to anything.

### G4 — The experiment record snapshots selected policy, not effective policy

`experiment.policyMatrix` is the selected matrix. Repair escalation and any resolver
decision live on the workflow reservation's `effectivePolicy`, not in the experiment
record, so an escalated repair can change an arm without the scorecard showing it.

Fix, cheapest version: **pin every role in every arm.** Setting a per-role policy at task
creation makes `rolePolicySources[role] = "task-override"`, and `isPinnedSource` then
blocks repair escalation entirely. Do this for all arms; then also surface
`escalationReason` in the summary as a contamination check.

### G5 — Scoring is API-only

The old `dev:web` UI posts `score`, `outcome`, `notes` only (`src/App.tsx:1033`).
`kind: "blind"`, `rubric`, `suiteId` and `caseId` have no UI anywhere. `dev:frontier` has
no evaluation or experiment surface at all — no experiment creation, no scorecard.

Fix: a small `scripts/record-evaluation.mjs`. Do not build UI for this campaign.

### G6 — Cross-provider cost is not comparable

Codex runs record `credits`; Claude runs record `—` for credits and only an API estimate.
Any Claude-vs-Codex cost claim must report tokens plus the API estimate, and state the
subscription caveat explicitly. Do not convert between them.

### G7 — Frozen base forces serialised creation windows

Because create-time requires `HEAD == frozenBaseSha`, every arm for a given case must be
created while that repository sits at that SHA. On the two eversor repositories, which
move, this means a short creation window per case, then the runs proceed from worktrees.
Plan the campaign as *per-case creation windows*, not one big batch.

---

## 3. What to vary — and what not to

There are 10 model-owned roles (`triage`, `scouts`, `grill`, `specification`, `plan`,
`implement`, `repair`, `dev-review`, `test`, `final-review`), 2 providers, ~9 selectable
models and up to 5 effort levels. The full grid is not a campaign, it is a hobby.

Current shipped Codex standard baseline (`server/policy-defaults.mjs`):
Luna XHigh for triage/scouts/grill/specification/implement/repair/test, Sol High for
plan and dev-review, Luna Medium for final-review.

Group the roles into three bundles that map to distinct capabilities, and vary **one
bundle at a time** against the frozen baseline:

| Bundle | Roles |
| --- | --- |
| **Understand** | triage, scouts, grill, specification, test |
| **Decide** | plan, dev-review, final-review |
| **Build** | implement, repair |

Varying all ten together — as the earlier plan's Astra matrix does — produces a result
that cannot attribute the change to any role. One bundle at a time is what buys
attribution, at the same total run count.

---

## 4. Proposed campaign

### Phase 0 — Baseline variance (do this first, always)

**2 cases × baseline arm × 3 repetitions = 6 runs.**

Purpose: measure run-to-run spread of the baseline on an identical brief and base. Until
that number exists, no arm difference can be called a difference. This is the cheapest
and most load-bearing spend in the whole programme, and it is the step normally skipped.

Output: for each case, the spread in deterministic-verification outcome, repair count,
retry count and wall time across three identical runs. If the baseline is bimodal on an
identical brief, Phase A needs more repetitions or narrower cases — better to learn that
for 6 runs than for 24.

### Phase A — One bundle at a time

**6 cases × 4 arms × 1 repetition = 24 runs.**

| Arm | Change from baseline | Question |
| --- | --- | --- |
| `B0` | none (shipped Codex standard, all roles pinned) | reference |
| `A1-build` | Build bundle → `claude-sonnet-5` xhigh | does a different provider write better code here |
| `A2-decide` | Decide bundle → `claude-opus-5` xhigh | does a stronger planner/reviewer reduce rework |
| `A3-understand-cheap` | Understand bundle → Luna **high** (down from xhigh) | can the cheap majority of stages be cheaper for free |

`A3` is deliberately a *down*-spec arm. Seven of ten roles currently run XHigh; if High is
indistinguishable, that is the largest available saving in the system and it costs 6 runs
to find out.

### Case suite

Use **replays of already-completed real tasks**, not synthetic cases. You have 84 finished
tasks with real briefs, real bases and, crucially, a known delivered implementation to
anchor the rubric against. A replay has ground truth; an invented case does not.

| # | Repository | Shape |
| --- | --- | --- |
| 1 | `agent-harness-ui` | narrow single-module change |
| 2 | `agent-harness-ui` | cross-module refactor with dependent slices |
| 3 | `agent-harness-ui` | frontend behaviour change |
| 4 | `eversor-plancheck` | backend logic, python + ts gates |
| 5 | `eversor-plancheck` | data-integrity or access-control concern |
| 6 | `eversor-mystrataassist` | feature touching the Playwright e2e suite |

Selection rules: the base SHA must still exist; the brief must be self-contained (no
"as we discussed"); the verification manifest must have covered the change; and the known
outcome must be recorded, including whether it needed manual repair. Freeze the six
chosen task IDs and base SHAs in the register before any run.

Both eversor repositories have rich verification manifests (13 and 7 commands), which is
what makes G1's fix possible there. `agent-harness-ui` has 5.

### Total: 30 runs

Not a statistically certain result. A first signal with known variance, per-case pairing,
attribution to one role bundle, and a provider-independent primary outcome — which is
strictly more than the current zero.

---

## 5. Measurement

### 5.1 Primary

**Deterministic delivery:** every command in the repository's verification manifest passes
on the final exact candidate revision, with fresh evidence. Binary, per run, per case.

### 5.2 Secondary

First-pass delivery (no repair, no retry, no operator correction); repair count; retry
count; wall time with execution and wait separated where recorded; input / cached / output
tokens; credits (Codex) and API estimate, reported separately per G6; operator
intervention count and correction minutes, recorded by hand in the register.

Report **matched per-case paired differences**, with exact sample counts. Also report each
arm's total resource use divided by its accepted deliveries, which is where expensive
rework shows up and pooled averages hide it.

### 5.3 Reviewer quality — a separate, smaller suite

Because §G1 makes gate verdicts untrustworthy as an outcome, measure reviewers directly:
a frozen set of candidates with **seeded material defects** plus **clean controls**, run
through the Decide bundle only. Score detection rate and false-alarm rate. A reviewer that
simply reports fewer findings must not score well. Freeze the set and its run budget
before execution.

### 5.4 Human scoring

1–5 rubric via `POST /api/tasks/:id/evaluation` with `rubric`, `suiteId`, `caseId` and
`kind`. Score `blind` where the arm can be hidden from the scorer — with 4 arms on the same
brief this is feasible: score the diffs without the arm label, then join.

### 5.5 Decision rule — write it down before launch

Record, before the first run: the acceptable resource ceiling, and what improvement in
deterministic delivery, first-pass rate or operator minutes would justify each arm. Also
record what would **refute** each arm. Thresholds chosen after seeing results are not
thresholds.

`eversor-plancheck/EXPERIMENT-REGISTER.md` already enforces exactly this discipline —
preregistration, frozen result hash, spend, and "what would refute it" stated up front.
Reuse that format for this campaign rather than inventing another.

---

## 6. Engineering work — done

All five gap-closing items are implemented. Verification run for this change is in §8.

| # | Work | Gap | Where |
| --- | --- | --- | --- |
| 1 | Deterministic-verification outcome as an experiment metric on the exact final candidate revision | G1 | `server/evaluation.mjs` (`finalCandidateVerification`) |
| 2 | Variants with more than one brief hash, base SHA, policy matrix or acceptance definition are labelled `mixed-identity` with named reasons instead of pooled into a rate | G2 | `server/evaluation.mjs` (`comparabilityOf`) |
| 3 | Runs whose effective policy diverged from the selected one are reported per variant and count as a confound | G4 | `server/evaluation.mjs` (`policyDivergences`) |
| 4 | `scripts/experiment-run.mjs` — validate-first, manifest-driven batch creator | G7, throughput | `scripts/experiment-run.mjs` |
| 5 | `scripts/record-evaluation.mjs` — post rubric, blind, suite and case scores | G5 | `scripts/record-evaluation.mjs` |

Reporting changes, in `server/evaluation.mjs`:

- `deterministicOutcomes` — `{passed, failed, incomplete, unknown}` per variant. `incomplete`
  means the manifest stopped before every declared command ran; `unknown` means no
  admissible evidence exists. Neither is a pass and neither is evidence of a defect, so
  `unknown` stays out of the rate's denominator rather than counting as a failure.
- `deterministicDeliveryRate` and `deterministicEvidenceSamples` — the primary outcome and
  its coverage. Only a `full-manifest` execution whose `headRevision` equals the final
  candidate's head is admissible: a focused run says nothing about the commands it never
  selected, and a manifest run against a superseded revision is not evidence for the
  delivered candidate.
- `comparability` — `{status, reasons, …counts}`. `frozenBaseShas` now reports every pooled
  base, where the previous shape kept only the first one encountered.
- `policyDivergences` — `{taskId, role, selected, effective, reason}` per divergent run.

Scorecard changes, in `src/components/EvaluationScorecard.tsx`: a `Delivered` column
carrying the deterministic outcome, `Gates first pass` explicitly labelled as reviewer
strictness rather than delivery, a mixed-identity badge on the variant, and the confound
reasons listed in the evidence drawer. The eventual gate rate moved into that drawer.

The new fields are typed optional and read through defaults. The summary is fetched from a
separately started harness process that can predate the bundle, and reading a field an
older server does not send crashed the whole settings screen — that was observed against a
live older `dev:api` during this change, not hypothesised.

### Run against real data

Against a read-only snapshot of the 84-task store, the four existing `harness-v2-phase-6`
variants now report:

| Variant | Before | Now |
| --- | --- | --- |
| `dependent-packages` | 3/3 (100%) first pass | comparable · deterministic 1 passed |
| `dependent-slices` | 3/3 (100%) first pass | **mixed-identity**, 5 named reasons · deterministic 1 passed, 2 unmeasured |
| `small-fast` | No gates | comparable · no admissible evidence (rate unknown, not 0%) |
| `small-standard` | No gates | comparable · no admissible evidence |

`dependent-slices` is the case §G2 predicted: three briefs, two bases, two policy matrices
and two acceptance definitions pooled behind one pooled 100%.

## 7. Prepared campaign manifests

Two manifests are committed, generated from the completed real tasks named in §4:

- `docs/experiments/model-baseline-2026-09-phase0.json` — 2 cases × baseline × 3 reps = **6 runs**.
- `docs/experiments/model-baseline-2026-09.json` — 6 cases × 4 arms × 1 rep = **24 runs**.

Both pin all ten roles in every arm, fix `workflowProfile` per case (never `auto`, never
`fast`), name `variantId` as `<case>__<arm>`, and write the baseline matrix out explicitly
so the reference arm is a frozen record rather than whatever the defaults are on the day.

| Case | Source task | Repository | Base | Profile | Shape |
| --- | --- | --- | --- | --- | --- |
| `C1-narrow` | AH-082 | `agent-harness-ui` | `f18c5673` | standard | narrow single-surface UI behaviour |
| `C2-feature` | AH-069 | `agent-harness-ui` | `06d5ed0b` | standard | additive feature across two surfaces |
| `C3-flow` | AH-068 | `agent-harness-ui` | `04d05e59` | standard | interaction redesign with a small state machine |
| `C4-backend` | AH-058 | `eversor-plancheck` | `21b63f5c` | high-risk | consequential backend aggregation |
| `C5-schema` | AH-060 | `eversor-plancheck` | `21b63f5c` | high-risk | migration plus read model plus UI |
| `C6-ambiguous` | AH-070 | `eversor-mystrataassist` | `3b402267` | standard | vague bug report — ambiguity under test |

Every one of these twelve base commits was verified to still exist in its repository.

Rejected candidates and why: AH-043 (2,144-character brief, would dominate the budget),
AH-059 (a data and judgement task expected to produce little or no code, and it needs a
live Postgres container), AH-050 (references an external dev URL, so it is not reproducible
from the repository alone).

### Running it

The script is validate-first. Nothing is created without `--commit`, and the dry run
checks every repository, base commit, arm reference and model eligibility first.

```bash
node scripts/experiment-run.mjs --manifest docs/experiments/model-baseline-2026-09-phase0.json
```

Creation requires the repository's HEAD to equal the case's frozen base, so each case has
its own creation window. The dry run prints the exact `git -C … checkout` for any
repository that is not there. Per case:

```bash
git -C /Users/shaun/projects/agent-harness-ui checkout f18c567374e9ec42f2e4d4ac2598948ec0698100
node scripts/experiment-run.mjs --manifest docs/experiments/model-baseline-2026-09.json --case C1-narrow --commit
```

Arm order rotates by case index, so no arm is consistently created first and inherits the
same position in provider load and prompt-cache order on every case.

Scoring, once a run has a candidate to judge:

```bash
node scripts/record-evaluation.mjs --task AH-090 --score 4 --outcome accepted --kind blind --case C1-narrow --suite model-baseline-2026-09 --rubric correctness=4,scope=5,readability=3
```

### Still to do before the first run

1. Register the campaign in `eversor-plancheck/EXPERIMENT-REGISTER.md` format:
   preregistered prediction, decision rule, refutation criteria and spend ceiling, all
   written down before any run. Thresholds chosen after seeing results are not thresholds.
2. Record the resource ceiling and the improvement in deterministic delivery, first-pass
   rate or operator minutes that would justify each arm.
3. Run Phase 0 and read the variance. If the baseline is bimodal on an identical brief,
   Phase A needs more repetitions or narrower cases — learning that costs 6 runs here
   instead of 24 there.

Still deliberately out of scope: any Frontier evaluation UI, a blind-scoring UI, an Astra
arm, the reviewer seeded-defect suite at scale, automatic routing, and any change to a
shipped default.

## 8. Verification

Run for this change, all passing:

```sh
node --test tests/evaluation.test.mjs   # 11 tests, 8 of them new
npm test                                # 590 tests
npm run test:frontier                   # 122 tests
npm run test:frontier-api               # 18 tests
npm run typecheck
npm run lint
```

`npm run format:check` reports four pre-existing failures in files this change does not
touch (`server/research/deepagents/worker.mjs`, `src/frontier/world-3d/ProofCamera.tsx`,
`src/research-budget-policy.ts`, `tests/research-deepagents-live.test.mjs`). Every file
this change touches is formatted.

The scorecard was checked in a browser against a live older `dev:api`, which is how the
missing-field crash was found and fixed. The server-side summary was checked against a
read-only snapshot of the real 84-task store, not only fixtures — that run is in §6.

Not run: `npm run build` and `npm run test:sites`, which this change does not affect.
