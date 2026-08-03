# AH-005 browser verification handoff

Status: **repair in progress; not READY**. This handoff records the exact
reviewed input `C1` revision `6` at
`37f5ad3e71375dbbae95fbcffa4b189679754af8`. The current Repair agent may not
commit or run browser QA. The harness must assemble this repair as a new
candidate revision, persist that exact identity in task state, and rerun every
candidate-bound gate before Human Approval. This document does not predict or
invent the future assembled candidate SHA.

## Candidate and repair identity

| Field | Value |
| --- | --- |
| Task | `AH-005` |
| Exact task base | `1591dca9869f50e9fbad20253f8100348463f9eb` |
| Reviewed input | `C1` revision `6` |
| Reviewed input SHA | `37f5ad3e71375dbbae95fbcffa4b189679754af8` |
| Current repair identity | Assigned only after harness assembly; persisted task state is authoritative |
| Fresh Dev Review / Test / Final Review for the assembled repair | None yet; revision 6 evidence becomes retained historical evidence |
| Approval state | Blocked; stop before Human Approval |

Preserve all six input revisions, run summaries, artifacts, repair lineage, and
exact stale-reason code/copy for audit. Do not present revision 6 evidence as
fresh for the newly assembled repair candidate.

## Package record

Dependency order: `S1 → S2 + S3 → S4`. Each locally qualified package was
ready for integration only; none was a whole-task pass.

| Package | Explicit owned paths | Dependencies and interfaces | Verification commands | Exact local commit | Qualification | Actual persisted usage |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | `server/**`, `src/domain/runtime.ts`, `src/runtime-activity.ts` | Foundation; persisted `RuntimeGateFreshness`, stale-reason code/copy, exact-candidate Test evidence, and run-derived artifact freshness | `node --test tests/orchestrator.test.mjs`; `npm run lint`; `npm run typecheck` | `10d2385222d49e6ccddd0b7bc60840da3c50503d` | Qualified by the harness and integrated into revision 6; ready for integration only | 9,748,203 tokens / 801,395ms |
| S2 | `src/components/runtime/**` | Depends on S1; consumes the persisted projection across gate UI surfaces | `node --test tests/runtime.test.mjs`; `npm run lint`; `npm run typecheck` | `5e942cb30c2477bdb75679ced16422cc97b65e3b` | Qualified by the harness and integrated into revision 6; ready for integration only | 5,615,363 tokens / 899,751ms |
| S3 | `tests/**` | Depends on S1 and S2; focused contract and cross-surface coverage | `node --test tests/orchestrator.test.mjs tests/runtime.test.mjs`; `npm run lint`; `npm run typecheck` | `6a4b939c29343a1c624d6e5da8787a2dde1c5aa5` | Qualified by the harness and integrated into revision 6; ready for integration only | 6,029,724 tokens / 853,230ms |
| S4 | `docs/dogfood/AH-005-browser-verification.md` | Depends on the exact assembled S1-S3 revision and retained operator evidence | Candidate-wide matrix and three-width inspection below | `ff6879fabf08f33e1c2a6f56a13f8ab575deb463` | Qualified handoff input integrated into revision 6; this repair remains pending harness assembly | 3,568,303 tokens / 319,466ms |

The immutable package commits and persisted usage above are package records;
they are not the SHA or qualification result of the current uncommitted repair.

## Authoritative revision 6 qualification

The operator recorded the following whole-candidate evidence for exact `C1`
revision `6` at `37f5ad3e71375dbbae95fbcffa4b189679754af8`:

| Check | Exact revision 6 result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS, 95/95 |
| `npm run build` | PASS |
| `npm run test:sites` | PASS, 4/4 |
| `git diff --check` | PASS |
| Required Sites artifacts | PASS: `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` present |
| Exact owned-path check | PASS |
| Exact worktree cleanliness | PASS |
| Base ancestry | PASS; the exact task base is an ancestor |
| Exported patch | `AH-005-C1-r6.patch`; SHA-256 `0c5f5262b98c6d6af48f406eed13a027f935fedc6b1f4cf7b65982a896a6a09b` |
| Patch apply against clean exact base | PASS |

These facts qualify revision 6 only. They do not qualify the current repair or
the future candidate revision assembled from it.

## Retained revision 6 browser evidence

The operator inspected the loopback-only revision 6 stale Dev Review state at
all required widths. Each view showed `C1` revision `6` / `37f5ad3e`, the
six-revision lineage, `0 of 3 gates fresh`, Dev Review as **Rerun required**
with the exact revision-change reason, and Test and Final Review as **Rerun
required**.

| Viewport | Retained screenshot | SHA-256 | Inspected result |
| --- | --- | --- | --- |
| 1440x1200 | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/browser-evidence/AH-005-C1-r6-stale-gates-1440.png` | `6561e1c99f30dd1a9a329783325906143c4ad26d87daf36f84e952caeddcbe0a` | PASS for exact revision 6 stale-state inspection |
| 1024x1200 | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/browser-evidence/AH-005-C1-r6-stale-gates-1024.png` | `f536a94fa15bb1b92206d5c1a0cb5b851c3b83a73ab0f9c281023db2b981a69a` | PASS for exact revision 6 stale-state inspection |
| 768x1200 | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/browser-evidence/AH-005-C1-r6-stale-gates-768.png` | `661de818d0bfee0512550b3bcbe871b5b7060e0ff4ce2b85e36464603ea5659c` | PASS for exact revision 6 stale-state inspection |

No browser or end-to-end QA was run by this Repair agent.

## Current repair verification

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| `node --test tests/orchestrator.test.mjs tests/runtime.test.mjs` | PASS, 56/56 | Includes latest-malformed-attempt precedence and parent/child mixed-evidence regressions; Vite emitted non-failing sandbox `listen EPERM` WebSocket warnings |
| `npm run lint` | PASS | Biome checked 65 source files; no fixes applied |
| `npm run typecheck` | PASS | `tsc --noEmit` exited 0 |
| `git diff --check` and owned-path review | PASS | Current repair changes only S1 `server/run-activity.mjs`, S3 `tests/orchestrator.test.mjs`, and this S4 handoff |
| Full suite, build, Sites checks, repaired patch apply, exact cleanliness, browser QA, fresh downstream gates | NOT RUN | Harness/operator-owned after exact repair assembly; no generated state retained |

## Required repaired-candidate completion

After the harness integrates this repair and persists its new exact candidate
identity:

1. Reject every committed file outside S1-S4 ownership.
2. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
   `npm run test:sites`, `git diff --check`, and required Sites artifact checks.
3. Export the exact repaired candidate patch and run `git apply --check`
   against `1591dca9869f50e9fbad20253f8100348463f9eb`.
4. Verify exact candidate cleanliness and base ancestry.
5. Retain and inspect repaired-candidate screenshots at 1440px, 1024px, and
   768px.
6. Produce fresh candidate-bound Dev Review, Test, and Final Review summaries
   for the exact persisted candidate ID, revision, and SHA.

Do not call the repaired candidate READY until every item passes. Preserve all
stale evidence, exact reason code/copy, and repair lineage. Stop at Human
Approval; do not approve, merge, close, or delete anything.
