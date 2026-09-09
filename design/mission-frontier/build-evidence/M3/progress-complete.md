# Goal 1 — first playable

**M0–M3 complete; ready for Shaun's game-feel review.** Final checkpoint: 6 September 2026. The requested GPT-6 Astra asset agent completed the A0/A1 kit. Goal 2 has not started. No publication.

## Authority and ownership

- Repository `https://github.com/shaunnez/agent-harness-ui.git`, checkout `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`.
- Base `e31566a36ed871cdb3743b8aaadaf08e7f19c6fd`; branch `codex/mission-frontier-first-playable`.
- Pre-existing AGENTS.md changes and the design pack preserved. No staging, commit, push, PR or deployment.
- Coordinator owns code, integration and browser. One Astra agent produced serial, disjoint asset assignments. All 25 A0/A1 IDs integrated and audited; no A2 production.
- Bundled Node 24.19.0 is the verified test/API runtime. Default Node 26 was unsuitable at baseline.

## Milestones

| Milestone | State | Evidence |
| --- | --- | --- |
| M0 | Passed | Repository identity, independent frontend/build, isolated APIs, additive projections and protected-file checks |
| M1 | Passed | Compatible overview/HQ/detail and worker motion; M1/fidelity-gate.md |
| M2 | Passed | World/HQ/detail, all 25 assets, exact task/run/artifact selection, attention and interaction QA |
| M3 | Passed | Actual CLI journey, automated gates, measured performance, final visual comparisons and handoff |

Complete gate coverage is in `M3/acceptance.md`; entry points and limitations are in `HANDOFF.md`.

## Verified results

- One actual CLI investigate-only AH-001 completed a real Grill question, custom answer, retained specification and explicit approval. Draft survived actual API disconnect/reconnect; final task survived reload/restart with no active runs. Historical worker parked. See `M3/actual-cli-journey.md` and retained task/run JSON. Do not rerun the paid smoke task.
- Frontier pure tests: 22 passed, 0 failed/skipped. Includes attention parity, historical/terminal state, refresh races, fixture isolation, stable placement, transition replay, camera bounds and visibility lifecycle.
- Isolated deterministic API tests: 2 passed, 0 failed/skipped. Covers allowed origin/CSRF, persisted answer and denied stale action. Provider fixtures remain separate from actual model execution evidence.
- Full repository baseline and serial final suite: 484 passed, 0 failed/skipped. The default parallel final suite hit one existing short-poll investigation timeout under load (483 passed, 1 failed). Its unchanged focused file passed 10/10. No assertion was changed; see the three retained logs in M3.
- Sites tests: 4 passed, 0 failed/skipped. Type, lint and format checks passed. Both builds passed and their outputs coexist. Final compact CSS change passed Biome check and a fresh Frontier build. Protected files match HEAD; final `git diff --check` passed.
- Browser QA covered all 12 task identities, search/history/needs-you, canvas worker/capsule picking, Markdown/raw evidence, camera/minimap, world/HQ/agent navigation, exact failed-package worker and return to active worker, keyboard and mobile overlay fallback.
- Matched desktop reference comparisons cover world, HQ and needs-answer/repair agent views. Final 849×779 check keeps selected-task actions, all camera controls and all three bases visible (`M2/world-849.jpg`). Full visual review: `../design-qa.md`.
- Normal load of 10 projects/100 tasks: 72.78 seconds measured, 119.05 fps median, 12.4 ms p95 frame interval. Forty world selections: 7 ms p95 acknowledgement. Initial textures: 25, using 66,977,792 decoded bytes and 13,585,480 compressed bytes.
- All 20 world/HQ/agent/world navigation loops completed. World entities remained 12, textures 26, decoded bytes 69,337,088, ticker listeners 2. No handoff replay.
- Stress check: 50 projects, 1,000 reachable task rows, 50 reachable attention items. Last task and last attention item opened with the correct identity.
- Browser motion-off stops the ticker with zero sampled frames and usable controls. The IAB could not expose actual hidden-page state; the focused visibility lifecycle test covers hide/show, offline/reduced-motion and disposal. Real OS backgrounding remains a documented M7 verification limitation.

## Next action

Shaun reviews world scale/readability, game feel, attention clarity and the transition from world into work. Do not start M4–M7 without the requested first-playable review. Richer project administration, per-role model/reasoning editing, full workflow/delivery controls, secondary pages and A2 art remain Goal 2 scope. Placement, persistent worker names, upgrades and unlocks remain v2.

## Owned services left running

- Frontier web 5199, session 61276, proxies isolated actual API 4321. Review URL: `http://127.0.0.1:5199/?mode=fixture#world`; actual retained journey: `http://127.0.0.1:5199/?mode=live#world`.
- Actual CLI API 4321, session 52449, uses `/var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-codex-5CMRsL` with ownership marker, disposable repository and store. It was restarted with the final read projections; AH-001 remains completed and no run is active.
- Deterministic API 4322, session 67576, uses `/var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-fixture-Aupavg`.
- Preview remains open in the IAB, native viewport restored. Check listener ownership before any restart. User runtime 4310, design gallery 5198 and unrelated repositories remain untouched.
