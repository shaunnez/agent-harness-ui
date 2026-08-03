# AH-005 browser verification handoff

Status: **repair in progress; not READY**. This handoff records authoritative
operator evidence for the exact reviewed input candidate and the scope of the
current uncommitted repair. The harness must assemble the repair as a new
candidate revision before Dev Review, Test, Final Review, or Human Approval can
be fresh again.

## Candidate and repair identity

| Field | Value |
| --- | --- |
| Task | `AH-005` |
| Exact task base | `1591dca9869f50e9fbad20253f8100348463f9eb` |
| Reviewed input candidate | `C1` revision `3` |
| Reviewed input candidate SHA | `24ae21061c96fc1b8a236cd6564aaf3f301d51be` |
| Prior candidate SHA | `b13fe891c388a2b20beaa7cccddb83c93e5f5b09` |
| Current repair SHA | Pending harness integration; the Repair agent is prohibited from committing |
| Fresh Dev Review / Test / Final Review for the repair | None; all input-candidate evidence becomes historical when the repair is assembled |
| Approval state | Blocked; stop before Human Approval |

The worktree was clean at exact input SHA
`24ae21061c96fc1b8a236cd6564aaf3f301d51be` before this repair. Preserve the
three-revision lineage and every prior artifact for audit. Do not present the
input candidate's evidence as fresh for the future repaired candidate.

## Package record

Dependency order: `S1 → S2 + S3 → S4`. Each original package commit is recorded
below. The current repair touches only S1, S3, and S4 owned paths; its exact
commit remains unavailable until harness integration. Package-specific token
and elapsed-time values were not present in the retained package payloads, so
they are explicitly recorded as unavailable rather than inferred from
stage-wide usage.

| Package | Owned paths | Dependencies and interfaces | Verification commands | Exact local commit | Qualification | Tokens / elapsed |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | `server/**`, `src/domain/runtime.ts`, `src/runtime-activity.ts` | Foundation; persists `RuntimeGateFreshness`, exact stale reason code/copy, and exact-candidate focused Test evidence | `node --test tests/orchestrator.test.mjs`; `npm run lint`; `npm run typecheck` | `59ebe0baa913a4127a0efe8cccf8fd17dcf37739`; repairs integrated through input SHA `24ae21061c96fc1b8a236cd6564aaf3f301d51be`; current repair commit pending | Focused qualification required after repair; ready for integration only when green | Not recorded in retained package payload / not recorded |
| S2 | `src/components/runtime/**` | Depends on S1; navigation, gate summaries, candidate details, Human Approval, and scoped Run Activity consume persisted freshness | `node --test tests/runtime.test.mjs`; `npm run lint`; `npm run typecheck` | `ea67d529742541ac606593d0866a50d35b036edf`; no current repair change | Input package qualified; ready for integration only | Not recorded in retained package payload / not recorded |
| S3 | `tests/**` | Depends on S1 contract and S2 presentation; proves exact binding, fail-closed precedence, filtering, and stale presentation | `node --test tests/orchestrator.test.mjs tests/runtime.test.mjs`; `npm run lint`; `npm run typecheck` | `f735bfb3d5c0cc5622f0dcd27f349324acd56f38`; repairs integrated through input SHA `24ae21061c96fc1b8a236cd6564aaf3f301d51be`; current repair commit pending | Focused qualification required after repair; ready for integration only when green | Not recorded in retained package payload / not recorded |
| S4 | `docs/dogfood/AH-005-browser-verification.md` | Depends on the exact assembled S1-S3 revision and retained operator evidence | Full candidate gate matrix below | `bb99f710a2c48ffebecb18a9b3b387948d42f509`; current handoff correction pending | Blocked until harness integration and fresh downstream gates | Not recorded in retained package payload / not recorded |

The retained Repair artifact reports stage-wide usage of 1,516,470 tokens for
the prior repair run, but that value is not allocated among S1-S4 and therefore
is not substituted for missing package usage. A locally green package is ready
for integration only, never proof that the whole task passed.

## Current repair verification

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| `npm run lint` | PASS | Biome checked 65 source files; no fixes applied |
| `npm run typecheck` | PASS | `tsc --noEmit` exited 0 |
| `node --test tests/orchestrator.test.mjs tests/runtime.test.mjs` | PASS | Focused contract and scoped UI coverage passed; Vite emitted non-failing sandbox `EPERM` WebSocket warnings |
| `npm test` | NOT PASSED IN REPAIR SANDBOX | Non-API suites ran, but API tests could not bind loopback `127.0.0.1` and failed with `listen EPERM`; timeout or infrastructure failure is not a pass |
| `git diff --check` | PASS | No whitespace errors |
| Approved ownership against exact base | PASS | Assembled diff contains only S1-S4 owned paths; the two top-level r3 component changes are removed |
| Build, Sites checks, repaired patch apply, exact cleanliness, browser QA, fresh downstream gates | NOT RUN | Harness/operator-owned after exact repair integration; no generated state retained |

## Authoritative input-candidate qualification

The operator recorded the following whole-candidate evidence for exact `C1` r3
at `24ae21061c96fc1b8a236cd6564aaf3f301d51be` before this repair:

| Check | Exact r3 result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS, 90/90 |
| `npm run build` | PASS |
| `npm run test:sites` | PASS, 4/4 |
| `git diff --check` | PASS |
| Required Sites artifacts | PASS: `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` present |
| Exact worktree cleanliness | PASS |
| Base ancestry | PASS; `1591dca9869f50e9fbad20253f8100348463f9eb` is an ancestor |
| Exported patch | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/AH-005-C1-r3.patch`, 125,620 bytes |
| Patch apply against clean exact base | PASS |

These are authoritative historical facts for r3. They do not qualify the
current repair or its future candidate revision.

## Retained r3 browser evidence

The loopback-only r3 UI was inspected in the in-app browser before the fresh
gates. Dev Review showed `C1` r3, `0/3 gates fresh`, three-revision lineage, and
prior completed reviews as **Rerun required** with the exact reason **Candidate
evidence belongs to a previous candidate revision.** Responsive navigation,
candidate facts, gate count, stale reason, and repair lineage remained legible
at every required viewport.

| Viewport | Retained screenshot | SHA-256 | Inspected result |
| --- | --- | --- | --- |
| 1440x900 | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/browser-evidence/AH-005-C1-r3-stale-dev-review-1440.png` | `8f25a85a2f0e5cf9550a12c0e87631d5a5ff3be56276ea7eee18a6e1e4e08963` | PASS for exact r3 stale-state inspection |
| 1024x900 | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/browser-evidence/AH-005-C1-r3-stale-dev-review-1024.png` | `1c926a59306e6330e0d3eaf18695b61b86c273303360338fc80a1775dcbabfd5` | PASS for exact r3 stale-state inspection |
| 768x900 | `/private/tmp/agent-harness-authoritative-freshness-2026-08-04/browser-evidence/AH-005-C1-r3-stale-dev-review-768.png` | `63020cdea897581d52d6000a484c474ec147c2af923f717f755ca416a64cb129` | PASS for exact r3 stale-state inspection |

No browser or end-to-end QA was run by the Repair agent, and no browser state,
test report, cache, or generated artifact was created in the candidate.

## Required repaired-candidate completion

After the harness integrates this repair as a new exact candidate revision:

1. Reject any committed file outside the approved S1-S4 owned paths.
2. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
   `npm run test:sites`, `git diff --check`, and required Sites artifact checks.
3. Export the exact repaired candidate patch and run `git apply --check`
   against `1591dca9869f50e9fbad20253f8100348463f9eb`.
4. Verify exact candidate cleanliness and base ancestry.
5. Retain and inspect repaired-candidate screenshots at 1440px, 1024px, and
   768px.
6. Produce fresh candidate-bound Dev Review, Test, and Final Review summaries
   for that exact candidate ID, revision, and SHA.

Do not call the repaired candidate READY until every item passes. Preserve all
stale evidence, exact reason code/copy, and repair lineage. Stop at Human
Approval; do not approve, merge, close, or delete anything.
