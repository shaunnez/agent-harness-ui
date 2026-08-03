# AH-005 browser verification handoff

Status: **blocked; not READY**. This is the S4 qualification handoff. The
assembled source candidate has not passed the required whole-candidate gates,
and no approval, merge, push, or external-service action was performed.

## Candidate and package identity

The exact task base and dependency closure verified in this slice are:

| Field | Value |
| --- | --- |
| Task | `AH-005` |
| Slice base SHA | `1591dca9869f50e9fbad20253f8100348463f9eb` |
| S1 commit | `014e0f956f731b1254404481f768bbf43b01ec3b` |
| S2 commit | `328a87182a5a4db15e2a3a90c33c9f4dde8269d1` |
| S3 commit / pre-S4 assembled SHA | `0c3c7a9d320b4af73e92581c1b0424c754fe9abf` |
| Candidate ID / revision | Not persisted in this isolated slice; do not infer from the branch name |
| Fresh Dev Review run ID | None available |
| Fresh Test run ID | None available |
| Fresh Final Review run ID | None available |
| Final S4 candidate SHA | Harness-owned commit not yet available |

The base-to-pre-S4 diff contains only the declared S1, S2, and S3 paths. The
only S4 path added by this package is this document. Dependency token usage,
elapsed time, and package qualification records were not supplied in the
isolated slice metadata, so they are recorded as unavailable rather than
invented.

| Package | Owned paths | Exact commit | Qualification result | Token / elapsed |
| --- | --- | --- | --- | --- |
| S1 | `server/**`, `src/domain/runtime.ts`, `src/runtime-activity.ts` | `014e0f956f731b1254404481f768bbf43b01ec3b` | Supplied dependency; integration exposed two resolver failures | Unavailable |
| S2 | `src/components/runtime/**` | `328a87182a5a4db15e2a3a90c33c9f4dde8269d1` | Supplied dependency; integration exposed two runtime-render failures | Unavailable |
| S3 | `tests/**` | `0c3c7a9d320b4af73e92581c1b0424c754fe9abf` | Supplied dependency; full candidate test gate failed | Unavailable |
| S4 | `docs/dogfood/AH-005-browser-verification.md` | Harness-owned commit pending | Handoff recorded; candidate blocked | Unavailable |

## Verification commands and results

Commands were run from the S4 slice at the pre-S4 assembled SHA above.

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| `npm run lint` | PASS | Biome checked 65 source files; no fixes applied |
| `npm run typecheck` | PASS | `tsc --noEmit` exited 0 |
| `npm test` | FAIL | 88 tests: 54 passed, 34 failed. The API failures could not bind loopback sockets (`EPERM`); two resolver assertions and two runtime-render assertions also failed. |
| `npm run build` | BLOCKED | Vite attempted to write the shared parent `node_modules/.vite-temp` and received `EPERM`. No dependency was installed or changed. |
| Equivalent Vite build using `--configLoader runner` plus `scripts/prepare-sites-build.mjs` | PASS | Built the client and prepared the Sites server bundle |
| `npm run test:sites` after the equivalent build | PASS | 4 of 4 Sites tests passed |
| Required Sites artifacts | PASS | `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` existed during the check; disposable `dist/` output was removed afterward |
| `git diff --check 1591dca9869f50e9fbad20253f8100348463f9eb..0c3c7a9d320b4af73e92581c1b0424c754fe9abf` | PASS | No whitespace errors |
| Exported patch `git apply --check` against the exact task-base worktree | PASS | The binary patch from the exact base applied cleanly in check mode |
| Pre-S4 assembled candidate cleanliness | PASS | The worktree was clean before adding this owned handoff document |
| Final exact-candidate cleanliness | NOT VERIFIED | The harness owns the S4 commit; this agent did not commit |

The focused failure details that prevent a READY claim are:

- mixed-candidate evidence resolved as `missing_binding` instead of the
  expected `mixed_evidence` reason;
- latest-terminal exact-candidate precedence returned `RUN-C2` instead of
  `RUN-EXACT`;
- retained focused-Test evidence did not render the expected
  `Candidate-bound structured evidence` text in the runtime render test;
- the missing/mismatched binding render test observed `0 of 3` fresh gates while
  expecting `1 of 3`.

These are dependency/integration findings. S4 did not modify their owned paths.

## Browser matrix

No browser row is a pass. The local runtime could not be launched: both the
companion and Vite were rejected by the environment with `EPERM` when opening
loopback listeners. The existing `localhost:5173` preview could not be claimed
after browser permission was denied, and the current candidate's static
`file://` artifact was also refused by browser URL policy. No screenshot or
browser state was created or retained.

The following records the required states without fabricating observations:

| State | Route / viewport | Candidate tuple and run IDs | Result | Screenshot |
| --- | --- | --- | --- | --- |
| Fresh candidate-bound Dev Review, Test, Final Review | Approval route; 1440px, 1024px, 768px | Unavailable; no persisted AH-005 task | BLOCKED: no exact runtime candidate or fresh run summaries available | None retained |
| Missing binding / stale evidence | Dev Review route; 1440px, 1024px, 768px | Unavailable | BLOCKED: browser could not reach the API-backed fixture | None retained |
| Mixed-candidate evidence | Test route; 1440px, 1024px, 768px | Unavailable | BLOCKED in browser; resolver test failed the expected reason-code assertion | None retained |
| Repaired candidate and downstream invalidation | Dev Review, Test, Final Review, Approval routes; 1440px, 1024px, 768px | Unavailable | BLOCKED: no disposable persisted candidate store could be served | None retained |
| Human Approval | Approval route; 1440px, 1024px, 768px | Unavailable | BLOCKED: no candidate-bound gate freshness could be verified in-browser | None retained |

The test suite did retain evidence that the repaired-candidate resolver path
invalidates downstream gates and that stale Run Activity keeps terminal status
separate from freshness, but those are automated checks, not browser
observations or screenshots.

## Handoff rules

- Do not call this candidate READY. The required `npm test`, literal
  `npm run build`, exact candidate cleanliness after the harness commit, and
  browser matrix are not all green.
- Do not infer the candidate ID, revision, head, or run IDs from this branch or
  from test fixtures. The harness must populate those from the persisted task
  record before any future browser attempt.
- Preserve the S1/S2/S3 commits and their failed evidence. Repairing the
  authoritative resolver or UI contract creates a new candidate revision and
  invalidates downstream gate evidence again.
- Stop at Human Approval. Do not approve, merge, close, deploy, push, or delete
  any candidate or retained evidence.
