# AH-005 browser verification handoff

Status: **repair in progress; not READY**. This handoff is bound to the exact
reviewed input candidate `C1` revision `5`. The current Repair agent may not
commit or run browser QA, so the harness must assemble a new candidate revision
and rerun every candidate-bound gate before Human Approval.

## Candidate and repair identity

| Field | Value |
| --- | --- |
| Task | `AH-005` |
| Exact task base | `1591dca9869f50e9fbad20253f8100348463f9eb` |
| Reviewed input candidate | `C1` revision `5` |
| Reviewed input candidate SHA | `06329a0d8158ba6cbf70fbb8b912331acf440ee1` |
| Prior candidate SHA | `994213d79565740ece853a67d4eb7b0798213440` (`C1` revision `4`) |
| Current repair SHA | Pending harness integration; this Repair agent is prohibited from committing |
| Fresh Dev Review / Test / Final Review for the repair | None; revision 5 evidence becomes historical when the repair is assembled |
| Approval state | Blocked; stop before Human Approval |

Preserve the five-revision lineage and all prior run summaries, artifacts, and
stale-reason code/copy for audit. Do not present revision 5 evidence as fresh
for the future repaired candidate.

## Package record

Dependency order: `S1 → S2 + S3 → S4`.

| Package | Explicit owned paths | Dependencies and interfaces | Verification commands | Exact local commit | Qualification | Tokens / elapsed |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | `server/**`, `src/domain/runtime.ts`, `src/runtime-activity.ts` | Foundation; persists `RuntimeGateFreshness`, exact stale reason code/copy, exact-candidate Test evidence, and run-derived artifact freshness | `node --test tests/orchestrator.test.mjs`; `npm run lint`; `npm run typecheck` | Original package `59ebe0baa913a4127a0efe8cccf8fd17dcf37739`; reviewed input assembled at `06329a0d8158ba6cbf70fbb8b912331acf440ee1`; current repair commit pending | Focused checks pass; ready for integration only | No package usage fields persisted / unavailable |
| S2 | `src/components/runtime/**` | Depends on S1; the owned `isArtifactFresh` helper consumes persisted artifact freshness for unchanged workspace callers | `node --test tests/runtime.test.mjs`; `npm run lint`; `npm run typecheck` | Original package `ea67d529742541ac606593d0866a50d35b036edf`; reviewed input assembled at `06329a0d8158ba6cbf70fbb8b912331acf440ee1`; current repair commit pending | Focused checks pass; ready for integration only | No package usage fields persisted / unavailable |
| S3 | `tests/**` | Depends on S1 and S2; covers complete Dev/Final summaries and unchanged-caller artifact agreement | `node --test tests/orchestrator.test.mjs tests/runtime.test.mjs`; `npm run lint`; `npm run typecheck` | Original package `f735bfb3d5c0cc5622f0dcd27f349324acd56f38`; reviewed input assembled at `06329a0d8158ba6cbf70fbb8b912331acf440ee1`; current repair commit pending | Focused tests pass, 56/56; ready for integration only | No package usage fields persisted / unavailable |
| S4 | `docs/dogfood/AH-005-browser-verification.md` | Depends on the exact assembled S1-S3 revision and retained operator evidence | Full candidate matrix below | Original package `bb99f710a2c48ffebecb18a9b3b387948d42f509`; reviewed input assembled at `06329a0d8158ba6cbf70fbb8b912331acf440ee1`; current repair commit pending | Strict ownership and revision-5 handoff corrected; ready for integration only | No package usage fields persisted / unavailable |

Package-specific token and elapsed-time fields are absent from the retained
package records and the accessible persisted task store contains no AH-005 task.
Stage-wide usage is not redistributed among packages. A locally green
package is ready for integration only, never a whole-task pass.

## Current repair verification

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| `node --test tests/orchestrator.test.mjs tests/runtime.test.mjs` | PASS, 56/56 | Covers malformed summaries and persisted artifact freshness without an out-of-scope workspace edit; Vite emitted non-failing sandbox `listen EPERM` WebSocket warnings |
| `npm run lint` | PASS | Biome checked 65 source files; no fixes applied |
| `npm run typecheck` | PASS | `tsc --noEmit` exited 0 |
| `git diff --check` | PASS | Exact base-to-worktree diff has no whitespace errors; strict ownership review excludes `src/components/RuntimeTaskWorkspace.tsx` |
| Full suite, build, Sites checks, repaired patch apply, exact cleanliness, browser QA, fresh downstream gates | NOT RUN | Harness/operator-owned after exact repair integration; no generated state retained |

## Authoritative prior revision 4 qualification

The operator recorded the following whole-candidate evidence for exact `C1`
revision `4` at `994213d79565740ece853a67d4eb7b0798213440` before this repair:

| Check | Exact revision 4 result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS, 93/93 |
| `npm run build` | PASS |
| `npm run test:sites` | PASS, 4/4 |
| `git diff --check` | PASS |
| Required Sites artifacts | PASS: `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` present |
| Exact worktree cleanliness | PASS |
| Base ancestry | PASS; `1591dca9869f50e9fbad20253f8100348463f9eb` is an ancestor |
| Exported patch | `AH-005-C1-r4.patch`; SHA-256 `15169912977a8e492cf19d33a6764ce6968aeb998942f177e7278a7e6fc058a0` |
| Patch apply against clean exact base | PASS |

These facts qualify revision 4 only. They do not qualify the current repair or
the future candidate revision assembled from it.

## Retained revision 4 browser evidence

The operator inspected the loopback-only revision 4 Dev Review stale state at
all required widths. Every view showed `C1` revision `4` / `994213d7`, the
four-revision lineage, `0 of 3 gates fresh`, Dev Review as **Rerun required**
with the exact revision-change reason, and Test and Final Review as **Rerun
required**.

| Viewport | Retained screenshot | Inspected result |
| --- | --- | --- |
| 1440x1200 | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/browser-evidence/AH-005-C1-r4-stale-gates-1440.png` | PASS for exact revision 4 stale-state inspection |
| 1024x1200 | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/browser-evidence/AH-005-C1-r4-stale-gates-1024.png` | PASS for exact revision 4 stale-state inspection |
| 768x1200 | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/browser-evidence/AH-005-C1-r4-stale-gates-768.png` | PASS for exact revision 4 stale-state inspection |

No browser or end-to-end QA was run by this Repair agent.

## Required repaired-candidate completion

After the harness integrates this repair as a new exact candidate revision:

1. Reject any committed file outside the package ownership above. In particular,
   `src/components/RuntimeTaskWorkspace.tsx` must match the exact task base.
2. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
   `npm run test:sites`, `git diff --check`, and required Sites artifact checks.
3. Export the exact repaired candidate patch and run `git apply --check`
   against `1591dca9869f50e9fbad20253f8100348463f9eb`.
4. Verify exact candidate cleanliness and base ancestry.
5. Retain and inspect repaired-candidate screenshots at 1440px, 1024px, and
   768px.
6. Produce fresh candidate-bound Dev Review, Test, and Final Review summaries
   for the exact repaired candidate ID, revision, and SHA.

Do not call the repaired candidate READY until every item passes. Preserve all
stale evidence, exact reason code/copy, and repair lineage. Stop at Human
Approval; do not approve, merge, close, or delete anything.
