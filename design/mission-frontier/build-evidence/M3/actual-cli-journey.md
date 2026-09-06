# Actual Codex CLI journey — passed

6 September 2026; tested through CUA in-app browser at1568×1003. This record covers actual backend integration. Final visual and milestone acceptance are separately recorded in design-qa.md and acceptance.md.

- API4321, new isolated SQLite store and disposable Git repository at `/var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-codex-5CMRsL`.
- Authentication: existing ChatGPT-authenticated Codex CLI. No API key. No deterministic provider was used in this host.
- Created exactly one investigate-only task, AH-001, through New task → Review → Create. Verified queued task with no run. Explicitly clicked Start investigation.
- Inherited and recorded policies: Luna XHigh for triage, Grill and specification. Three actual completed run records appear in `actual-runs.json`; scouts retained an artifact without inventing a separate paid run.
- The actual model asked one material Q1 about label equality. The agent view displayed Needs your answer with stage, exact question, next actor and recorded time; the completed53s Grill run was parked.
- Typed: “Trim surrounding whitespace and ignore letter case. Preserve internal whitespace and original labels for display.” Opened the decision artifact and returned; draft survived.
- Stopped only the owned idle API4321 process, leaving the pending question intact. The same draft remained visible and submission disabled. Resumed the same marked store; reconnect restored submission and preserved the draft. The final fixture/browser rerun also verified the explicit offline banner inside overlays.
- Submitted Q1 through the real API; observed operator-answer provenance and retained text. Clicked Create specification; the real CLI produced task-specification.md.
- Opened and read the retained specification. It matches the chosen policy and keeps internal whitespace significant. Explicitly approved it in the disposable task. No implementation or publication followed.
- Persisted final status: completed, currentStage specification, completedStages triage/scouts/grill/specification, no active runs and no error. Reloaded the deep agent URL; the prior Grill run remained historical and completed task attention was shown.
- Recorded usage:144,296 input,94,208 cached input,4,662 output,148,958 total tokens. API-rate estimate is recorded as$0.017496, rate version2026-08-02; this is not an attributable ChatGPT-plan charge.
- Original disposable repository remains clean at1c1b2f4e9b51; no user repository/runtime/task was used.

Runs: triage7b296efb-809c-41eb-be34-6c60749644b4 (51.946s), Grill5a3b45c5-956b-43bd-a6d3-071ae6c29530 (53.046s), specification2c252279-1c6d-4a04-9d47-c467f3d05178 (23.464s).

Separate deterministic real-API suite: `api-fixtures.log` records2passing tests covering CSRF/origin, creation/start/Grill/specification/approval and stale answer rejection. Those tests inject the external provider boundary and do not constitute actual model evidence.

Final recheck: the owned idle API4321 was restarted on the same marked store to load final attention projections. Browser reload and actual-task-core-final.json still show AH-001 completed, no active runs, no error, exact recorded usage and retained specification. The final specification worker displays its real23s runtime and$0.0032 API-rate estimate, rather than rounding a sub-cent estimate to zero. No additional model task was created.
