# Overnight release-candidate report — 2026-08-04

> **Triage note (2026-08-05, #26):** The "Audit disposition" table below was
> independently re-verified against current code (not merely trusted) — confirmed
> accurate, with one refinement: P2-9's documented bug is fixed; a narrower theoretical
> residual remains (see `docs/code-quality-audit-2026-08-03.md`'s note). AH-003's two P1
> Dev Review blockers are that same P2-9 finding, not a separate live defect. All branches
> named here (`codex/overnight-*`, `agent-harness/ah-003-c1`/`ah-004-c1`) are stale — their
> content landed on `main` via direct commits despite PRs #18-#20 being closed unmerged
> (push access was identity-scoped, see #25) — safe to delete. Historical record.

## Executive conclusion

**Safe to review: partially.** The runtime-hardening and approved-backlog layers are clean, independently green, and have apply-checkable exported patches. The simple dogfood candidate reached Human Approval with fresh candidate-bound gates. The multi-package dogfood candidate did not reach Human Approval and exhausted its three Dev Review attempts with two remaining P1 findings.

**Safe to merge: no.** The multi-package proof is incomplete, browser evidence for that candidate remains pending, and GitHub publication is blocked because the active `gh` identity (`shaunnesbitteversor`) receives HTTP 403 from `shaunnez/agent-harness-ui`. No branch was pushed and no draft PR was opened. Nothing was approved or merged.

## Immutable branch stack

| Layer | Branch | Local head | Base | Dependency | Publication |
| --- | --- | --- | --- | --- | --- |
| Baseline | `origin/codex/overnight-integration` | `fdefaaac5223b8694ecc207e7a4a924c36e0cc78` | remote integration branch | none | unchanged |
| Runtime hardening | `codex/overnight-runtime-hardening-2026-08-04` | `d4dc1e9d946adb9988f5d497b046e821d8007f3b` | `origin/codex/overnight-integration` | baseline | local only; push rejected 403 |
| Approved backlog | `codex/overnight-approved-backlog-2026-08-04` | `23191d8486626fd95c2da627f8ea13c4fe2d82de` | runtime hardening | hardening | local only; push rejected 403 |
| Dogfood evidence | `codex/overnight-dogfood-evidence-2026-08-04` | report commit on top of `23191d8486626fd95c2da627f8ea13c4fe2d82de` | approved backlog | backlog | local only; push rejected 403 |
| Simple candidate | `agent-harness/ah-004-c1` | `3de0dc34606e8332fb8c51f0e530f15997f87ed0` | dogfood evidence at `23191d8486626fd95c2da627f8ea13c4fe2d82de` | simple dogfood | Human Approval; push/PR blocked 403 |
| Multi candidate | `agent-harness/ah-003-c1` | `b82186ed1bd9cca434183db3b6840065d05a8aac` | prior dogfood evidence at `8f90273784dc7fc0157eda868d97b1a0b2ba019b` | multi dogfood | stopped at Dev Review; not publishable as READY |

The candidate worktrees and every candidate revision remain retained. No branch, worktree, task, artifact, or revision was deleted.

## Baseline verification

Detached worktree: `/Users/shaun/projects/.worktrees/agent-harness-ui-overnight-baseline` at `fdefaaac5223b8694ecc207e7a4a924c36e0cc78`.

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | FAIL: 5 of 67 tests; three `/var` versus `/private/var` realpath mismatches, one Git worktree realpath mismatch, one Windows path-normalization failure |
| `npm run build` | PASS |
| `npm run test:sites` | PASS, 4 of 4 |
| `git diff --check` | PASS |
| Required Sites files | PASS: `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json` |
| Worktree cleanliness | PASS |

The verification worktree was not modified.

## Runtime-hardening result

Implemented on `codex/overnight-runtime-hardening-2026-08-04`:

- strict structured Dev Review and Final Review evidence, including contradictory-output rejection and exact candidate binding;
- process-tree cancellation and timeout escalation, already-aborted handling, and non-overlapping retry reservation;
- normalized work-package ownership with committed-file enforcement;
- Test cleanup, candidate restoration, and exact-revision cleanliness checks;
- exact candidate filtering and authoritative navigation/display freshness for the implemented gate contract;
- request identity protection for rapid task and candidate-diff navigation;
- exact supplied-character accounting for the original context-manifest defect set;
- truthful model provenance;
- consistent Host, Origin, missing-Origin, content-type, and CSRF policy;
- apply-checkable campaign export with append-only correction evidence;
- Test-only Codex sandbox network capability so repository loopback HTTP tests can run while candidate filesystem isolation remains enforced.

Final local gates: lint PASS, typecheck PASS, tests PASS (77 of 77), build PASS, Sites PASS (4 of 4), diff check PASS, required Sites files present, clean worktree. The exported hardening patch passed `git apply --check` against `fdefaaac5223b8694ecc207e7a4a924c36e0cc78`.

## Approved-backlog result

Implemented on `codex/overnight-approved-backlog-2026-08-04`:

- an explicit empty triage dispatch now selects zero scouts and persists selected, skipped, and rationale;
- a zero-question Grill auto-advances truthfully into specification;
- Create Task uses a compact accessible policy summary with expandable detail;
- the footer remains reachable at 1440, 1024, and 768 pixels;
- regression coverage was added for zero scouts and zero-question Grill.

Final local gates before the evidence commit: lint PASS, typecheck PASS, tests PASS (79 of 79), build PASS, Sites PASS (4 of 4), diff check PASS, required Sites files present. The exported backlog patch passed `git apply --check` against the runtime-hardening head.

Browser QA retained outside the repository:

- `/Users/shaun/.codex/visualizations/2026/08/03/019fc72f-98ca-7193-9205-447c4df2af38/approved-backlog-create-task-1440x900.jpg`
- `/Users/shaun/.codex/visualizations/2026/08/03/019fc72f-98ca-7193-9205-447c4df2af38/approved-backlog-create-task-1024x768.jpg`
- `/Users/shaun/.codex/visualizations/2026/08/03/019fc72f-98ca-7193-9205-447c4df2af38/approved-backlog-create-task-768x768.jpg`

All three viewports had no horizontal overflow; the footer and Start task action were visible and hit-testable. The 1024-pixel policy details expanded accessibly. The 768-pixel controlled-experiment layout was corrected and re-inspected.

## Audit disposition

| Original audit item | Disposition | Evidence / remaining boundary |
| --- | --- | --- |
| P1-1 local mutation boundary | Fixed | shared HTTP boundary tests cover hostile Host, hostile Origin, missing Origin, content type, and CSRF |
| P1-2 wrong-branch approval | Fixed in inherited integration contract and reverified | merge checks exact target ref and candidate revision |
| P1-3 split merge/persistence transaction | Fixed in inherited integration contract and reverified | merge-intent reconciliation tests pass |
| P1-4 transition races | Fixed in inherited integration contract and reverified | atomic transition and concurrent reservation tests pass |
| P1-5 invalid/mismatched gate evidence | Fixed for structured gate parsing | P0/P1 blocks PASS; malformed, mixed, stale, and contradictory evidence fails closed |
| P1-6 inherited secrets | Fixed | minimal Codex environment test passes; no API key path introduced |
| P2-1 stale async frontend response | Fixed | late A-to-B task and candidate-diff responses are rejected |
| P2-2 cancellation finishes too early | Fixed | whole process tree terminates before reservation settles |
| P2-3 advisory package ownership | Fixed | overlap normalization and committed-file enforcement cover single and parallel packages |
| P2-4 Test dirt strands retry | Fixed | cleanup and exact candidate recovery run after every Test outcome |
| P2-5 context manifests overstate supplied text | Partial | hardening fixed original truncation/accounting cases; AH-004 supplies a fuller reviewed candidate but remains outside the stack pending publication |
| P2-6 fallback models appear discovered | Fixed | discovered, configured, bundled fallback, and unsupported provenance are distinct |
| P2-7 persistence migration boundary | Partial | runtime schema is versioned; a complete deterministic persisted-state migration program remains separate |
| P2-8 prose-derived metrics/gates | Fixed for Dev/Final gates | structured candidate-bound gate evidence is authoritative |
| P2-9 optimistic missing binding | Still open beyond the current stack contract | AH-003 found generic `id`/`revisionNumber` evidence and missing Dev/Final run-summary paths that can still project fresh in its proposed expanded projector |
| P3-1 obsolete prototype surface | Deferred | not required for the bounded release repair |
| P3-2 oversized modules/contracts | Partial | cohesive contracts/components were extracted; broader modularization remains separate |
| P3-3 missing risky coverage | Partial | substantial runtime, process, HTTP, ownership, cleanup, and browser-width coverage added; multi-package browser proof did not complete |
| P3-4 runtime/default/document drift | Partial | model policies and provenance are aligned; remaining legacy/runtime cleanup is separate |

## Dogfood task A — successful simple run

Task `AH-004`, “Dogfood A final — exact context manifests”.

- terminal state: **Human Approval**; stopped without approving or merging;
- one package: `S1`, owned `server/prompts.mjs`, `server/scouts.mjs`, and `tests/runtime.test.mjs`;
- candidate lineage: C1/r1 `ae03698902c32ae4a3a1c08bee89792cd59e96b3` → repair C1/r2 `3de0dc34606e8332fb8c51f0e530f15997f87ed0`;
- repair reason: the first Test retained a failed exploratory command despite 58 passing focused checks; the repair added the legitimate Dev Review P2 boundary regressions rather than bypassing the failure;
- exact C1/r2 gates: Dev Review PASS, Test PASS, Final Review PASS; all have candidate ID `C1`, revision `2`, and no blocking reasons;
- independent C1/r2 verification: lint PASS, typecheck PASS, tests PASS (82 of 82), build PASS, Sites PASS (4 of 4), diff check PASS, required Sites files present, clean exact revision;
- exported patch: `/tmp/AH-004-C1-r2.diff`; `git apply --check` PASS against `23191d8486626fd95c2da627f8ea13c4fe2d82de`;
- elapsed: 1,262,127 ms (about 21m 02s);
- usage: 5,752,346 input, 5,207,552 cached input, 65,421 output, 5,817,767 total; cache rate 90.53%; API-rate estimate $3.599847; attributable ChatGPT-plan charge unavailable.

The exact candidate branch is retained locally. Push and draft-PR creation were attempted only within granted authority but are blocked by repository permission.

## Earlier simple calibration lineages

- `AH-001`: stopped at ready-for-Test after exposing contradictory persisted review blockers. C1/r1 `bd3e1fb0d1b2a12e0acd6ae35678a08fcb78a68d`; 7,902,316 tokens; 93.71% cache rate; 1,085,106 ms; API-rate estimate $2.499397.
- `AH-002`: stopped failed after Test correctly failed closed under the original sandbox and the repair made no code change. C1/r1 `b61149eeb9289598516a260fba8a37208950dd1a`; 4,307,097 tokens; 90.08% cache rate; 1,162,103 ms; API-rate estimate $2.188413.

Both lineages remain retained and inspectable; neither is represented as the successful task A proof.

## Dogfood task B — stopped multi-package run

Task `AH-003`, “Dogfood B — authoritative candidate freshness”.

Required dependency graph was produced and executed:

`S1 → S2 + S3 in parallel → S4`

| Package | Ownership | Local package revision | Outcome |
| --- | --- | --- | --- |
| S1 foundation | `server`, `src/domain/runtime.ts`, `src/runtime-activity.ts` | `2b7565590d4e871b292a2b4901c057450fe162a1` | integrated; package artifact disclosed API sandbox limitations |
| S2 UI | `src/components/runtime` | `df51143392e0b82a43a69299d8fbcbe0a0e944cc` | ran in parallel with S3 and integrated |
| S3 tests | `tests` | `be5f92ed2bf17aa1adcdd2726b4c61ceeff883bc` | ran in parallel with S2 and integrated |
| S4 handoff | `docs/dogfood/AH-003-browser-verification.md` | `b2b15dcc39ea280bd68e7a3027a92dd73779165c` | integrated; initial hard-coded pre-assembly SHA was repaired |

Candidate lineage:

- C1/r1 `e96b9c6b925600bdae2a76ba843daedaaf4da2e0` — Dev Review REPAIR;
- C1/r2 `795bc66503100601df6a8007d9ea9f34290e042c` — Dev Review REPAIR;
- C1/r3 `b82186ed1bd9cca434183db3b6840065d05a8aac` — full independent local gates green (90 of 90 tests), exported patch apply-check PASS, but Dev Review REPAIR.

Terminal state: **repair required at Dev Review** after all three allowed Dev Review attempts. The final exact C1/r3 review retained two P1 blockers:

1. generic `id` and `revisionNumber` fields can be accepted as explicit evidence bindings;
2. Dev Review and Final Review can project fresh without authoritative persisted run summaries.

It also retained two P2 presentation findings for stale run activity and loss of exact stale reasons. No Test or Final Review ran for C1/r3; the task did not reach Human Approval. No fourth review, repair, approval, merge, push, or PR was attempted.

Metrics: 34,206,178 input, 32,411,904 cached input, 234,155 output, 34,440,333 total; cache rate 94.75%; elapsed 3,426,988 ms (about 57m 07s); API-rate estimate $22.048588; attributable ChatGPT-plan charge unavailable.

## Publication and recommended review order

GitHub publication is blocked before any draft PR can exist:

`remote: Permission to shaunnez/agent-harness-ui.git denied to shaunnesbitteversor.`

When an authorized GitHub identity is available, the bounded review order is:

1. runtime hardening → base `codex/overnight-integration`;
2. approved backlog → base runtime-hardening branch;
3. dogfood evidence → base approved-backlog branch;
4. simple exact candidate `agent-harness/ah-004-c1` → base dogfood-evidence branch.

Do not publish AH-003 as READY and do not open a final PR to `main`. Resolve its remaining P1 findings in a new authorized campaign/task, rerun the full multi-package proof and browser matrix, and only then reconsider the final integration PR.

## Safety confirmation

- Nothing was approved or merged.
- `main` and `codex/overnight-integration` were not modified or force-pushed.
- No API key was requested, read, stored, or passed.
- Companion servers remained bound to loopback.
- Dedicated task data was used at `/tmp/agent-harness-dogfood-2026-08-04/tasks.json`.
- All retained candidates, stale gates, repairs, tasks, branches, worktrees, and campaign artifacts remain available.

