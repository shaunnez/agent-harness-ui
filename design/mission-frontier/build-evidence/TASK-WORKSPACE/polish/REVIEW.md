# Task workspace bounded polish — review receipt

21 September 2026. Implemented after Shaun's explicit continuation from the pre-compaction handoff. This is the follow-up to Slice 4, not a fifth migration slice. Visual sign-off and final stack code review remain pending.

## Changes and boundaries

- The shared command row now places retained-artifact access before the primary action, with the copy taking remaining space. Dev review repair, Test retry and Final review now end at the same right edge. Existing handlers, menus, eligibility explanations, notes and confirmation controls are unchanged.
- Review blockers now live inside the verdict panel instead of a separate red strip. The compact candidate/provenance line retains freshness or audit status. Full gate reason copy remains on the retained-artifact row below the findings; the command retains its actionable cause, and every structured blocking reason remains visible in the verdict panel. Distinct causes are not filtered or inferred equivalent. Metadata and gate-result identity mismatches both remain audit-only.
- Test initially selects the first failed result within the selected attempt. Explicit selections and explicit Back to results are remembered separately for each attempt using existing session-only panel memory. Passing-only and empty attempts keep their list-first state. No effect, persistence change or workflow rule was added.

Workflow dispatch, candidate revisions, retry versus repair, action availability, API contracts and approval publication logic are unchanged. No live records were mutated or task execution started. Slice 4's earlier read-only live inspection remains the live-data evidence; it was not repeated for this local presentation pass.

## Browser comparison

`comparison-{review,test}-{1280x900,1440x1000}.jpg` place frozen study, immutable Slice 4 baseline and current application side by side. All four sheets were visually inspected. Full-resolution application and reference PNGs are included. Both viewport sizes use normal zoom; screenshot dimensions were checked against filenames. The served reference matches the frozen SHA-256 `905e12d79d63cb1f63dd1ba15cff3125b1ab97e3742555c23b9d64450eccf812`.

Dev review now follows the study's verdict → candidate → findings anatomy without the extra blocker strip. Findings begin higher than the Slice 4 baseline. The primary action remains right aligned with artifact access beside it. Test now opens useful failure detail while preserving the execution-failure explanation; the study's code-defect example still correctly differs from the application's stopped-command fixture. No suggested-code fields, test outcomes or action eligibility were invented to imitate the study.

Accepted differences remain: separate stage/task usage, host window controls, historical-view notices, retained attempts and local scrolling. Laptop Test detail extends below the initial viewport; the stage content scrolls while commands remain accessible. This pass does not claim pixel identity or remove the accepted density tradeoff. Intermittent WebGL fallback remains; these captures qualify task overlays, not the 3D renderer.

The study wrapper sometimes scrolls after selection or viewport changes. Captures were reset to scroll origin and inspected again; the retained comparison images use the corrected captures. Slice 4 screenshots were not overwritten.

## Interaction evidence

All actions used explicitly labelled, tab-local fixtures.

| Check | Observed result |
| --- | --- |
| AH-051 initial detail | Failed verification check selected, with npm test, exit 127 and ENOENT retained output. |
| Back and evidence return | Back clears detail. Opening exact diff and returning leaves it cleared. |
| Explicit passing selection | Selecting Preserves labels survives exact-diff inspection and return. |
| Retry/attempt isolation | Sample retry keeps C-AH-051 r1, adds completed attempt 2 (3 passed), and starts unselected. Attempt 1 retains its explicit passing selection. |
| Back across attempts | Clear attempt 1, switch to attempt 2, then back: attempt 1 stays cleared (`test-back-retained-1280x900.png`). |
| Final review alignment | Primary button and command-row right edge both measured 1403px at 1440×1000 (`final-review-command-1440x1000.png`). |
| Approval note and diff | Proceed with reason displays exact r1 identity. Note survives exact-diff return; confirmation remains an explicit control (`approval-note-return-1440x1000.png`). No approval submitted. |
| Candidate refresh | Scheduled sample change advances to r2. Open r1 confirmation stays visible with the changed-candidate warning and disabled confirmation (`approval-stale-disabled-1440x1000.png`). |

Temporary tabs were closed and viewport overrides reset. The clean QA-205 Approval preview remains open on 5293 for Shaun.

## Checks

- **164 Frontier tests passed**, zero failures/cancellations/skips. Added initial failed/passing-only/empty detail coverage and verdict/blocking-reason coverage; extended candidate mismatch coverage. Browser checks cover interactive selection and return behavior beyond static rendering.
- **4 Sites tests passed**; typecheck, lint, changed-file formatting, both builds and diff whitespace checks passed.
- Required Sites packaging outputs remain present. No hosting or deployment occurred.
- Full formatting still fails only in the three unchanged baseline files: `server/research/deepagents/worker.mjs`, `src/research-budget-policy.ts`, `tests/research-deepagents-live.test.mjs`.
- Existing large-chunk warnings remain. `check-results.json` indexes logs; the focused log is the earlier narrow check, while `frontier.log` covers the final source.
- Commits use the previously disclosed per-command signing bypass after the configured 1Password signer failure; global signing settings remain unchanged. Log trailing whitespace is normalized for repository hygiene.
- No remote CI results were reported at stack verification. No live model run, real approval, PR publication by a task, merge or deployment was tested or performed.

Stop for Shaun's visual review. After acceptance, perform final code review of the stack; integration requires separate authorization in #111 → #113 → #114 order.
