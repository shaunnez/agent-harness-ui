# AH-005 browser verification handoff

Status: **repair in progress; not READY**. This handoff is bound to the known
input candidate below. The Repair agent did not run browser QA, commit, approve,
merge, push, or contact an external service. The harness must create a new
candidate revision for the uncommitted repair before any downstream gate can be
fresh.

## Candidate and repair identity

| Field | Value |
| --- | --- |
| Task | `AH-005` |
| Exact task base | `1591dca9869f50e9fbad20253f8100348463f9eb` |
| Reviewed input candidate | `C1` revision `2` |
| Reviewed input candidate SHA | `b13fe891c388a2b20beaa7cccddb83c93e5f5b09` |
| Current repair SHA | Pending harness integration; this agent was prohibited from committing |
| Fresh Dev Review / Test / Final Review run IDs | None for the uncommitted repair |
| Approval state | Blocked; stop before Human Approval |

The input candidate was clean at `b13fe891c388a2b20beaa7cccddb83c93e5f5b09`
before this repair. The current worktree intentionally differs from that SHA, so
neither the input SHA nor its prior evidence may be presented as fresh for the
eventual repaired candidate.

## Package record

The dependency order remains `S1 → S2 + S3 → S4`. The newest Dev Review
explicitly amends S2 ownership to include the two mounted consumers that were
missing from the approved slice.

| Package | Owned paths | Dependencies and interface | Exact local commit record | Verification command | Qualification |
| --- | --- | --- | --- | --- | --- |
| S1 | `server/**`, `src/domain/runtime.ts`, `src/runtime-activity.ts` | Foundation; exports persisted `RuntimeGateFreshness`, exact stale reason, and candidate-filtered Test evidence | `59ebe0baa913a4127a0efe8cccf8fd17dcf37739`, repaired in `b13fe891c388a2b20beaa7cccddb83c93e5f5b09`; current timeout amendment pending harness commit | `node --test tests/orchestrator.test.mjs` | Focused resolver coverage passes; ready for integration only |
| S2 | `src/components/runtime/**`, `src/components/RunActivity.tsx`, `src/components/RuntimeTaskWorkspace.tsx` | Depends on S1; all mounted surfaces consume persisted freshness and exact reason copy | `ea67d529742541ac606593d0866a50d35b036edf`; mounted-consumer amendment pending harness commit | `npm run lint`, `npm run typecheck`, `node --test tests/runtime.test.mjs` | Focused UI coverage passes; ready for integration only |
| S3 | `tests/**` | Depends on fixed S1 contract and mounted S2 consumers | `f735bfb3d5c0cc5622f0dcd27f349324acd56f38`, repaired in `b13fe891c388a2b20beaa7cccddb83c93e5f5b09`; current regressions pending harness commit | `node --test tests/orchestrator.test.mjs tests/runtime.test.mjs` | 51/51 focused tests pass; ready for integration only |
| S4 | `docs/dogfood/AH-005-browser-verification.md` | Depends on the exact integrated S1–S3 revision and operator browser evidence | `bb99f710a2c48ffebecb18a9b3b387948d42f509`; this correction pending harness commit | Required full gate matrix below | Blocked pending integration and operator verification |

Package-level token and elapsed-time figures were not present in the retained
package records. They remain **unavailable** rather than being inferred from
stage-wide model usage. The prior locally green packages and this focused repair
are ready for integration only; they are not a whole-task pass.

## Repair verification

Commands were run in the repair worktree based on input candidate
`b13fe891c388a2b20beaa7cccddb83c93e5f5b09`.

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| `npm run lint` | PASS | Biome checked 65 source files; no fixes applied |
| `npm run typecheck` | PASS | `tsc --noEmit` exited 0 |
| `node --test tests/orchestrator.test.mjs tests/runtime.test.mjs` | PASS | 51/51 focused tests passed; Vite logged sandbox `EPERM` WebSocket-listener warnings without failing the tests |
| `git diff --check` | PASS | No whitespace errors in the final repair diff |
| `npm test` | NOT RUN by Repair agent | Prior API runs could not bind loopback sockets in this sandbox; timeout is not a pass |
| `npm run build`, `npm run test:sites`, required Sites artifacts | NOT RUN by Repair agent | Harness-owned whole-candidate qualification; no generated build state may be retained here |
| Exported patch `git apply --check` against exact base | NOT YET VERIFIED | Must use the exact harness-integrated repair revision |
| Exact candidate cleanliness | NOT YET VERIFIED | Current repair is intentionally uncommitted |
| Fresh candidate-bound Dev Review, Test, and Final Review | NOT AVAILABLE | Repair invalidates the prior candidate-bound evidence |

## Browser matrix

Browser and end-to-end QA are operator-owned for this repair stage and were not
run. No screenshot or browser state was created or retained. Every required row
therefore remains blocked, not passed.

| State | Route / viewport | Required binding | Result | Screenshot |
| --- | --- | --- | --- | --- |
| Fresh Dev Review, Test, Final Review | Approval; 1440px, 1024px, 768px | Exact future repaired candidate and terminal run IDs | NOT RUN | None retained |
| Missing binding / stale evidence | Dev Review; 1440px, 1024px, 768px | Exact persisted stale reason code and copy | NOT RUN | None retained |
| Mixed-candidate evidence | Test; 1440px, 1024px, 768px | Exact persisted `mixed_evidence` result | NOT RUN | None retained |
| Repaired candidate invalidation | Dev Review, Test, Final Review, Approval; all viewports | New candidate revision with prior evidence retained | NOT RUN | None retained |
| Human Approval | Approval; 1440px, 1024px, 768px | Exact revision, branch, merge method, and three fresh gates | BLOCKED | None retained |

## Required operator completion

After the harness integrates this repair into a new exact candidate revision:

1. Reject any integrated file outside the amended S1–S4 owned paths.
2. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
   `npm run test:sites`, `git diff --check`, and the required Sites artifact
   checks.
3. Export that exact candidate patch and run `git apply --check` against
   `1591dca9869f50e9fbad20253f8100348463f9eb`.
4. Verify exact candidate cleanliness.
5. Retain and inspect screenshots at 1440px, 1024px, and 768px.
6. Produce fresh candidate-bound Dev Review, Test, and Final Review summaries.

Do not call the candidate READY until every item passes. Preserve the input
candidate, stale evidence, exact reason code/copy, and repair lineage. Stop at
Human Approval; do not approve or merge.
