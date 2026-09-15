# Mission Frontier — shared local runtime

Connected on 7 September 2026. Mission Frontier and the original Harness interface now use the same companion and the existing canonical database.

## Open the workspace

- [Mission Frontier, live](http://127.0.0.1:5199/?mode=live&art=cinematic#world)
- [Original Harness interface](http://127.0.0.1:4173/)
- [Sample cinematic world](http://127.0.0.1:5199/?mode=fixture&art=cinematic#world), explicitly separate from live work

Both live interfaces proxy to `http://127.0.0.1:4310`. The original temporary Codex test API on 4321 was stopped after the connection was verified. Its saved investigation remains retained.

## Ownership and source

- Runtime code: `/Users/shaun/.codex/worktrees/7237/mission-frontier-live`, branch `codex/mission-frontier-live`, initial integration `46562c5`, now running recovery fix `c6f43e5442fc2680073ac5f9b275998571a003c4`.
- Canonical database: `/Users/shaun/projects/agent-harness-ui/.data/tasks.sqlite3`.
- Suggested task repository: `/Users/shaun/projects/agent-harness-ui`.
- The source checkout, original dirty design workspace, and PR checkout were preserved. PR #73 remains open and unmerged. The recovery fix and its qualification were pushed at `02f6380dc48df63ab22614063eae904cc599aad9`; the game was not deployed.

The integration combines the local Harness revision `e31566a` with Frontier PR head `dec1226` in a separate checkout. This preserves the existing local design-generation changes while adding Frontier's origin, project-management, role-policy and attention support. The companion runs from this stable checkout while implementation agents work in their separate candidate worktrees.

Task repository authority remains independent of the companion's code checkout. Existing Harness tasks target their recorded upstream branch. Frontier itself is not yet on remote `main`; work intended to change the new game must deliberately target a revision containing it or follow PR integration. Do not silently rebind an approved task to another branch.

## Backup and qualification

The verified pre-connection backup is in:

`/Users/shaun/projects/agent-harness-ui/.data/backups/mission-frontier-live-20260906T225226Z/`

`before-connect.sqlite3` passed SQLite integrity checking; SHA-256 `19a6dfe99c35916251c01f12ccbe592924e0d0572d10edcf058808729c2c710d`. It contains 50 tasks, 639 artifacts, 17,731 events and 700 runs, with no active run. The stale lock was preserved only after its recorded process was confirmed absent.

Before touching the real store, the existing and integrated store implementations each opened a separate copy. Their complete task records and saved settings matched. JSON exports were retained. The live database still matched the backup immediately before startup.

- Initial connection: 85 focused checks and 1,046 tests passed; the focused checks are a subset.
- Current recovery fix: 28 focused checks and 1,052 full-suite tests passed, with zero failures, cancellations or skips. The focused checks are a subset.
- The separate public PR checkout passed 1,047 tests plus typing, lint, formatting and both builds. It excludes the user-owned local design-generation changes preserved in this runtime.
- Typecheck, lint, formatting, and both builds passed. Existing large-chunk warnings remain.
- Direct API, original-UI proxy and Frontier proxy matched on summaries, poll state, projects, settings and representative task cores. Only the per-request `actionEligibility.generatedAt` timestamp was excluded from comparison.
- Both interfaces return all 50 task records. Two project entries are available: the registered MyStrataAssist project and the suggested Harness repository.
- Both local execution providers reported available and authenticated when checked. This is a dated runtime observation, not a permanent availability guarantee.

Detailed private evidence is retained under `.data/live-connection/` in the integration checkout. Raw task exports and runtime records are not part of the public PR or journal.

## Why the existing tasks stopped

| Task | Recorded condition | Recovery boundary |
| --- | --- | --- |
| AH-049 | Implementation stopped on an old checkout-revision mismatch; its approved plan targets `401bf490` while upstream is now `91f6d3a8` | Revalidate the retained plan against the current target before implementation |
| AH-043 | Same recorded implementation mismatch and stale plan | Same bounded revalidation path; no run started during connection |
| AH-048 | A successful plan is awaiting approval; eight prior planning attempts are retained | Review the plan, with repository freshness checked before approval; do not blindly grant another planning attempt |
| AH-050 | A successful MyStrataAssist plan is awaiting approval | Review in its own repository scope; no execution was started |
| AH-041 | Design generation was interrupted when the old companion stopped | Retained failure, requiring an explicit retry or task decision |
| AH-042 | Claude Design returned no required published URL; a Codex design variant is retained | Inspect the retained design and failed-provider result before any retry |

The old implementation-resume fix is already in the integrated runtime. On an isolated copy, restarting AH-049 and AH-043 correctly detected the now-stale plan before making a model call, creating an implementation worktree or consuming another implementation attempt.

## First recovery case

AH-049 was selected as the bounded first recovery. Its restart and freshness preflight ran through the live API. The preflight retained the old plan and exposed `stale-plan` without spending an implementation attempt. Plan revalidation then started once, using the task's saved Claude Opus 5 / XHigh policy, against upstream `91f6d3a8`.

Planning run `3adfec14-05d1-4756-bbca-945634c93208` completed successfully at `2026-09-06T23:11:56.841Z`, after 144.236 seconds. It recorded 54,450 tokens and $0.4782175 as an API-equivalent estimate, not an attributable billed charge. The replacement plan artifact is `19c57d56-2835-4e8c-a41e-f9f0ae337724`.

The live Harness recorded plan approval at `2026-09-06T23:15:29.710Z`; this agent did not submit that approval. Implementation subsequently started, with S1 and S2 running in parallel. S3 depends on S2, followed by S4. No task publication approval was submitted by this agent. The later, explicitly disclosed AH-048 review restoration is recorded below.

All four packages are now integrated into **C1 r1 `5fc79d353c9247eff0490f2d94236de1bcefdf80`**, ready for Dev Review. Package commits are S1 `7bdc5a94636b2d07cb3a50cf93df0b1481c40746`, S2 `f83958906641499b33a9034bc2b2d2cd809bfaf1`, S3 `82154a74b61cd342c0519f01b2b5bdbdb766b5dd`, and S4 `052ae31de62d99f163d622ac313ac7e552f49c4e`.

S4 exposed a second failure: its approved plan prose mentioned a stylesheet that the structured file-ownership manifest did not permit. Two package attempts hit the ownership guard. Existing retained-worktree continuation admitted only interruptions/timeouts, leaving this otherwise recoverable work stuck. The narrow runtime fix also admits this exact ownership failure. It retains the same worktree and attempt, completed dependencies, repository authority, and final ownership validation. It does not permit arbitrary failures or authorize extra files.

The corrected continuation ran once on S4-A2. The agent restored the unowned stylesheet; its final commit contains only the two approved workspace/inspector files and the new inspector test. All four new test files were then run explicitly against the exact assembled candidate: **17 tests passed, zero failed/cancelled/skipped**, including imported support tests. The log includes Vite WebSocket port 24678 collision warnings; the tests passed, but this is not a clean browser-console or end-to-end UI qualification. Full candidate review, Test, Final Review and approval remain normal workflow gates.

## Restart incident and other real work

The recovery-fix restart interrupted AH-048's active Dev Review. This was this agent's mistake: `/api/tasks?view=poll` returns only IDs and poll versions, so missing run fields were wrongly interpreted as idle. This was disclosed immediately. Its exact candidate C1 r1 `ed36b8eec81e0612392de401ca71c8a6bcff2c28` and prior evidence remained intact. This agent restored Dev Review once against that same candidate; it passed. The operator subsequently progressed Test, and the latest checkpoint is **ready for Final Review**. Future restart checks must use full task summaries/cores, including `activeRunKind` and `activeRunIds`, and must not infer idle from missing fields.

A second verified SQLite backup precedes that restart: `.data/backups/ownership-recovery-20260906T235434Z/before-runtime-fix.sqlite3`, SHA-256 `160da4c1297dcec0baa38cbf214845fd89fc5f9798a60b2741d33386aa96817b`. It is a valid integrity-checked snapshot, not an idle checkpoint.

AH-043 was advanced independently through the Harness. Its S4 initially failed two timing-sensitive tests and S5 exceeded a 900-second provider timeout. Both failed S4 tests passed unchanged when reproduced alone on retained commit `f1cc56863eab3a3bc9e3afcf67a5d7e5787e990e`; that isolated result did not qualify the complete package. At the final checkpoint the operator's recovery has S1–S5 ready for integration and **S6 running**. No AH-043 retry or stage approval was submitted by this agent. Keep its retained work and let the current run finish; do not start another recovery loop.

## Remaining follow-ups

- The default `npm test` command names files explicitly. AH-049 adds four test files without changing that list, so its automatic 481-test package checks omitted them. The explicit 17-test candidate check closes this case's omission; automatic test discovery and appropriate scheduling remain separate runtime work.
- `server/orchestrator-repair-execution.mjs` collects command activity in `runtimeEvents` and persists it through `_finishAgentRun` only after the provider finishes or fails. A run can remain visibly quiet while files change. Incremental, bounded event persistence with cancellation and concurrent-package coverage is the next observability fix.
- Plan prose and structured ownership need a consistency check. The ownership guard correctly rejected the extra stylesheet; recovery is now possible without weakening it.
- The initial task table above is historical. AH-048/049 and AH-043 have progressed as recorded here. Other tasks remain operator-owned; no bulk restart, archive, closure, or approval was submitted.

## Resumption and rollback

Inspect listener and lock ownership before restarting anything. Run one companion for this database. Use Node 24.19.0 from the bundled runtime for the qualified setup.

From the integration checkout, the companion was started with:

```sh
AGENT_HARNESS_DATA=/Users/shaun/projects/agent-harness-ui/.data/tasks.json \
AGENT_HARNESS_DATABASE=/Users/shaun/projects/agent-harness-ui/.data/tasks.sqlite3 \
AGENT_HARNESS_REPOSITORY=/Users/shaun/projects/agent-harness-ui \
AGENT_HARNESS_PORT=4310 node server/index.mjs
```

The frontends were started separately with `AGENT_HARNESS_API=http://127.0.0.1:4310`, using `npm run dev:frontier` and `npm run dev:web -- --host 127.0.0.1 --port 4173 --strictPort`. Starting another combined `npm run dev` would attempt a second companion; reuse the existing API instead.

The original interface is the immediate UI fallback and uses the same current data. A backend rollback is a separate controlled stop/start, after active work finishes. Preserve the current database and evidence; never overwrite it with the pre-connection snapshot as an automatic rollback.
