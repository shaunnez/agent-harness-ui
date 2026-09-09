# Mission Frontier — Goal 1 handoff

First playable: M0–M3 completed on 6 September 2026. Ready for Shaun's game-feel review. Goal 2 has not started.

- Review world: http://127.0.0.1:5199/?mode=fixture#world
- Actual isolated runtime: http://127.0.0.1:5199/?mode=live#world
- Acceptance: M3/acceptance.md
- Visual review: ../design-qa.md and M3/*-comparison.png
- Performance: M3/performance.md
- Actual model evidence: M3/actual-cli-journey.md, actual-runs.json, actual-task-core-final.json

## What is working

The independent React/Pixi frontend provides the game world, stable automatic project bases, adjoining headquarters rooms, separately selectable workers/stations/artifact capsules, camera/minimap controls and semantic DOM overlays. Twenty-five calibrated assets have retained source/provenance/geometry/QA and verified runtime hashes. Worker tool movement is registered to its station; historical or finished runs remain parked.

The task journal, minimal task inspector, package/run drill-down, manual Grill, retained Markdown/raw evidence, create/review/start investigation and specification approval work through one runtime boundary. Task/run state, next actor, reason, candidate staleness and action eligibility retain backend authority. Token/cache counts and identified API-rate estimates are shown without claiming an attributable ChatGPT-plan charge.

One actual ChatGPT-authenticated Codex investigate task, AH-001, completed its real question/answer/specification/approval journey in a disposable repository. It remains completed after reload and API restart. No additional paid tasks, API keys, implementation run, user-runtime change or publication were used for QA.

## Check results

- Frontier boundary tests:22 pass,0 fail/skip.
- Isolated real-API fixture tests:2 pass,0 fail/skip; external provider injected, reported separately from actual CLI evidence.
- Full repository suite with serial file scheduling:484 pass,0 fail/skip.
- Sites worker:4 pass,0 fail/skip.
- TypeScript, Biome lint/format, both production builds and final diff/protected-file checks pass.
- Normal100-task world:119fps median,12.4ms p95 frame interval over73s. World selection p95 7ms. Twenty complete navigation loops retain a stable26-texture cache and2 ticker listeners.
- Stress world:50 projects,1,000 reachable task rows and50 reachable attention items.
- Conservative initial asset plus all non-raster build files:15,665,237 bytes (14.94MiB), below20MiB. Decoded textures after detail:66.13MiB, below192MiB.

The default parallel full suite twice hit one existing short-poll investigation test (483 pass,1 fail). Its unchanged focused file passed10/10; the full serial run passed484/484. This caveat remains in the evidence. No test assertion or warning threshold was relaxed.

The IAB could not report real hidden-page state. Browser motion-off stops the ticker; a dedicated visibility-event test verifies hide/show, reduced/offline state and disposal. Confirm actual OS backgrounding during the later full native-browser qualification.

## Review focus and later scope

Review the world scale, the click-to-enter/watch transitions, and whether blocked/needs-answer work is clear enough. The A1 standard building kit and modular landscape are intentionally less varied than the cinematic concept. Water repetition, the standard roof proportions and exact return-to-row focus remain P3 polish notes. The approximately805kB main JS chunk warning remains visible, with measured budgets passing.

M4–M7 still own complete project administration, per-role model/reasoning overrides, all workflow/candidate/review/test/PR controls, global agent/skill/settings/usage pages, A2 artwork and final release qualification. Placement editing, persistent worker names, upgrades and unlocks remain v2.

## Runtime and resumption

Checkout `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`, branch `codex/mission-frontier-first-playable`, base `e31566a36ed871cdb3743b8aaadaf08e7f19c6fd`. Existing user changes and the design pack remain uncommitted; no stage/commit/push/PR/deployment occurred.

The preview and isolated actual API are left running. Current commands, if those owned services have stopped:

```sh
# Run from this checkout; bundled Node24 is verified.
export PATH=/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
AGENT_HARNESS_API=http://127.0.0.1:4321 npm run dev:frontier
```

```sh
# Separate terminal, same checkout. Reuse only this marked disposable store.
export PATH=/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node scripts/frontier/qa-server.mjs --codex --root /var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-codex-5CMRsL
```

Check listener ownership before starting or stopping a process. API4322 is the separate deterministic fixture host at `/var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-fixture-Aupavg`. User runtime4310 and design gallery5198 were left untouched. Do not rerun AH-001 to recreate evidence.

The original frontend entry/build and protected Sites files remain unchanged, so selecting that entry is the UI rollback. No persistent-store schema migration was introduced. The optional attention projection is additive; old clients ignore it. SQLite task artifacts and the existing legacy import/export behavior remain intact.
