# M7 — complete v1 qualification

Completed on 6 September 2026 within the accepted first-playable direction. [Coverage](coverage.md) maps all 25 destinations and required states to actual browser and automated evidence. [Performance](performance.md) and [assets](assets.md) record the measured game/asset gates.

## Executed checks

- Full repository and Frontier suites: **1,040 passed, 0 failed, 0 skipped** with serial file scheduling; `full-tests.log`. This includes store/SQLite parity, authority and race protection, API contracts, exact candidate/gate/PR binding, design retries, default/history immutability, state projections, coordinator paging, visibility, usage and fixture isolation.
- Final focused Frontier/API/companion suite: **72 passed, 0 failed, 0 skipped**; `frontier-final-tests.log`. The full run includes these tests after the final logic fixes.
- TypeScript, Biome lint and format checks passed; `typecheck.log`, `repository-lint.log`, `repository-format.log`. The final responsive change is CSS only and was formatted and visually rechecked.
- Both application builds and the four Sites worker tests passed. `clean-install.log` proves the lockfile-only install; `clean-final-build.log`/`.json` prove the final source rebuild in that independently installed checkout with the same lockfile.
- Seven protected entry/packaging files match HEAD byte for byte (`protected-files.json`). `git diff --check` passed. No staging, commit, push, PR or deployment was performed.
- All 35 runtime asset entries and exported motion parts have verified hashes and dimensions. Twenty repeated navigation trips kept stable cache/entity/listener counts; the 1,000-task stress case remained reachable and responsive.
- Actual browser checks include 1568×1003, 1488×1058, 1280×720 and a 390×844 overlay fallback. The compact desktop inspector no longer consumes half of the stage workspace; the mobile settings footer no longer overlaps content. Twenty-four keyboard steps remained in the modal; nested Escape and draft restoration were exercised.
- The isolated actual API was safely restarted only after checking zero active runs and taking a consistent SQLite backup. AH-001 remains completed with three runs and the same recorded usage; AH-002 remains closed with zero runs. `live-tasks-after-restart.json` records the intentional projection correction from zero to unavailable cost/credits on the zero-run task.

## Explicit limits and P3 follow-up

No unresolved P0/P1/P2 application defect was observed in the qualified paths. The IAB does not expose native background visibility or confirm OS receipt of the JSON download; those two native integrations are **not verified**, and remain a manual check in a normal browser. Lifecycle logic and local motion-off behavior are tested separately.

The modular world is less cinematic and more repetitive than the generated study; water repetition, roof/worker proportions, tighter settings density, small compact-stage icon spacing and exact return-to-row focus remain P3 polish. The common task shell is retained from the accepted first playable, rather than pretending each generated study was reproduced pixel for pixel. The main-bundle size warning remains visible; measured payload/texture/frame budgets pass without raising warning thresholds.

Real investigation evidence is retained from M3. Implementation, repair and GitHub delivery were qualified with deterministic provider/GitHub boundaries; this milestone did not perform a new paid implementation or publish a real PR. The normal user's runtime is untouched. See [handoff](../HANDOFF.md) for operating and rollback boundaries.
