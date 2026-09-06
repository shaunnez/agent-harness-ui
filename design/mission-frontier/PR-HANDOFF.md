# Mission Frontier — PR handoff

The Mission Frontier v1 implementation and cinematic island are packaged for review in `codex/mission-frontier-v1`, based on current `main` at `91f6d3a8464842846153f0d621b5ba2360ccabd0`. Publication is being finalized; the PR URL and implementation commit will be recorded here after creation. No merge or game deployment is part of this handoff.

## Scope

The independent React/Pixi workspace provides World → Project headquarters → Watch an agent, task creation/listing, stage/package/artifact drill-down, project management, agent and skill model/reasoning policies, recorded usage and settings. The existing backend remains authoritative for execution, attention, candidate identity and approvals.

Included backend changes are canonical task attention, transactional project rename/archive/restore admission, validated per-role policy snapshots and candidate-bound repair/retry checks. The game uses 35 retained runtime asset entries plus 21 cinematic entries. The cinematic presentation is opt-in and currently features one island; other islands and interiors deliberately retain earlier art.

See [source package boundaries](SOURCE-PACKAGE.md) for the included runtime assets, design study, scripts and provenance. Large Blender/source archives and raw runtime evidence remain in the original workspace. The independent journal repository is excluded from this public PR.

## Validation of the PR checkout

- A fresh lockfile installation completed.
- **1,041 distinct tests passed; zero failed, cancelled or skipped.** The focused 78-test run is a subset and is not added to that total.
- Typecheck, lint, formatting, original frontend build and Frontier build passed under Node 24.19.0.
- The original build produced all three protected Sites outputs before the combined suite exercised the worker tests.
- The cinematic manifest matches the previously qualified hash: `f517b44b9726712d60e115b782ee46a5277eaab303867d96c3c0d32855d626ca`.

[Exact commands, counts, log hashes and environment](build-evidence/PR/verification.json). Existing Vite large-chunk warnings remain. The fresh installation used the host Node 26.4.0/npm; tests and build commands used the bundled Node 24.19.0 runtime. No dependency version changed during PR preparation.

The retained browser qualification measured 119.05 median FPS normally, 113.64 under the representative stress fixture, and 15.4 ms selection p95. Those are Goal 3 observations on Shaun's Mac; they were not remeasured during packaging. [Performance details and caveats](build-evidence/VISUAL-FIDELITY/performance.md).

## Review and open issues

- [World capture](build-evidence/VISUAL-FIDELITY/after/world-1568.png): inspect the new island, observatory and bridges.
- [Headquarters capture](build-evidence/VISUAL-FIDELITY/after/hq-1567.png): compare running work, human input, repair and package dependencies.
- [Agent capture](build-evidence/VISUAL-FIDELITY/after/agent-1568.png): review the articulated worker, activity, policy and usage.

The cleaner new worker/architecture and sparse terrain still differ from the retained weathered interiors and richer design study. Review those materials before producing more islands. The initial transfer measurement is 18.60 MiB against a 20 MiB gate, so art expansion requires fresh loading measurements.

Native background-tab suspension, OS reduced-motion preference switching and OS receipt of the JSON export remain unverified. A real Codex investigation exists, but a representative real implementation → repair → approval → PR journey remains the main functional follow-up. Deterministic workflow coverage must not be presented as that real delivery proof. Building placement, persistent worker names, upgrades and unlocks remain v2.

## Workspaces and running preview

- PR checkout: `/Users/shaun/.codex/worktrees/7237/mission-frontier-pr`.
- Original source/design workspace: `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`; its existing dirty files and the two pre-existing local commits were preserved. Those unrelated commits are excluded from the PR.
- [Existing qualified preview](http://127.0.0.1:5200/?mode=fixture&art=cinematic#world) still runs from the original workspace. The retained development preview and isolated APIs remain untouched. Recheck listener ownership before any restart.
- [Published journal](https://mission-frontier-journal.shaunnesbittuk.chatgpt.site/notes/one-island-with-depth/) remains a separate Site with unchanged selected-audience access.

The original workspace is deliberately not made clean by this publication. Resume review/fixes on the PR checkout and synchronize any desired preview changes deliberately; do not broadly stage or reset the original workspace.

## Next

Review the PR and the three visual scales, address concrete findings, then qualify one bounded real implementation workflow using the existing explicit decision/approval gates. Do not merge or publish the game merely because automated checks pass. The earlier [project handoff](HANDOFF.md) retains the full Goals 1–3 history and local evidence map.
