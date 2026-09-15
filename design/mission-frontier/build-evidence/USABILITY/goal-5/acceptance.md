# Goal 5 acceptance — 15 September 2026

Goal 5 U3–U5 and UB1 are functionally qualified for review. Source: `92f69a8b396c473bb2dc2714f1274053f0953a84`, integrating published main `424f8f1a632f32785a1ca0e2394f9d6dd3180499`. Subsequent changes in this checkpoint are documentation and evidence only. The user waived further performance benchmarking and removed extreme-zoom-specific design changes; normal laptop and desktop usability remain required.

## Acceptance mapping

| Requirement | Recorded result |
| --- | --- |
| U3 stable cross-project decision navigation | Previous/Next preserves unsubmitted Grill drafts across projects. Explicit Record answer submits; navigation does not. The answered task remains visible with its next eligible action. |
| Candidate and action authority | Sample repair progressed through Dev Review, Test, Final Review and explicit Proceed with reason to simulated awaiting PR merge. Replacing the candidate while confirmation is open leaves the original revision visible, explains the mismatch and disables Confirm. Shared real action policy is unchanged. |
| Removed or resolved decisions | Fixture external-change cases cover resolved, removed and replaced candidates. A removed selected task now clears cached form/evidence, keeps navigation identity and exposes an unavailable message. Keyboard Next still works. |
| U4 bounded return briefing | Stable captured interval, retained material changes and current decisions. Closing/reopening retains unread state; acknowledgement uses only the loaded captured upper bound. Retention gaps require explicit acknowledgement. Completed-run totals are labelled rather than presented as interval spend. |
| U5 watch pins | Four task/exact-run pins, explicit cap, historical completed-run identity, missing/offline labels, browser reload persistence and reconnect restoration. Single-pin strip stays compact. |
| Source isolation and browser coordination | Source replacement clears old drafts/pins/briefing. Two API-backed tabs propagated pins and preserved them on reload. An older tab's acknowledgement could not rewind a newer checkpoint. Web Locks serialize writes; unsupported browsers fail explicitly. No simultaneous-click browser race proof is claimed. |
| UB1 SQLite/API boundary | Transactional typed read projection, schema 3, 5,000-observation cap, source identity, stable bounded cursor pages/captured upper boundary, explicit coverage baseline and legacy unavailability. Contract tests cover migration/export, pruning, source replacement and invalid inputs. |
| Laptop reading space | At 1280 × 720, maximised Task stage content measured 456.71 px; normal Watch activity measured 245.53 px. Local scrollbars and desktop overlays remain usable. Temporary viewport override reset before handoff. |

## Final checks

All checks below ran after integrating `424f8f1`, against the source named above.

- [307 focused tests passed, zero failed/skipped](final-contract-tests.txt): Frontier and Frontier API, SQLite/store, orchestration, API characterization, task projections, candidate/gate policies, runtime settings/command dispatch, effective model policy and orchestration policy.
- [Typecheck, lint and formatting passed](final-checks.txt).
- [Frontier build, root build and four Sites packaging tests passed](final-builds.txt). Existing bundle-size warnings remain.
- Protected Sites packaging files have no diff from the integration base. No full repository-wide suite or remote CI result is implied by these local checks.
- Production/test changes were reviewed for scope. Historical raw check outputs retain their original content, including four trailing-whitespace lines in main-baseline-test.txt and main-sync-tests.txt; new changes pass diff whitespace checking.

## Browser evidence

Captures in `resume/` are 15 September sample/in-memory or disposable deterministic API evidence. They are not real user task deliveries. Most detailed flow captures preceded the final model-policy-only main merge; the final world was checked again after that merge. The code test batch above is from the final integrated source.

- [Draft retained](resume/decision-draft-1280.png), [stale candidate confirmation](resume/candidate-stale-1280.png), [removed task without stale form](resume/decision-removed-1280.png).
- [Return briefing](resume/briefing-api-1280.png), [retention gap](resume/retention-gap-1280.png), [desktop briefing](resume/briefing-desktop.png).
- [Four API pins](resume/four-pins-api-1280.png), [offline pins](resume/four-pins-offline-1280.png), [historical run and cap](resume/pin-cap-historical-agent-1280.png), [cross-tab observation notes](resume/cross-tab-observations.txt).
- [Laptop Task](resume/task-max-1280.png), [laptop Watch](resume/watch-normal-1280.png), [sample approval](resume/approval-review-1280.png), [desktop world](resume/world-1488.png).

## Limits and separate follow-up

No paid model workflow, real candidate approval, PR merge or game publication was performed. Native screen-reader/OS lifecycle testing and simultaneous multi-process browser stress were not performed. Browsers without Web Locks cannot save shared pins/checkpoints. Legacy JSON history is unavailable explicitly. Incremental live activity belongs to Goal 6. The original-design fidelity pass with Astra asset support is next, separately from this command workflow; building placement, upgrades and unlocks remain v2.
