# Mission Frontier — complete v1 handoff

Goal 3 visual qualification has passed; see [VISUAL-FIDELITY/progress.md](VISUAL-FIDELITY/progress.md). This document retains the completed v1 qualification record.

Goal 2 (M4–M7) completed on 6 September 2026 following Shaun's acceptance of M0–M3. The 25 destinations, supported task workflows, model/effort controls, project management, usage views and A2 artwork are implemented in the independent React/Pixi entry.

- Open sample world: http://127.0.0.1:5199/?mode=fixture#world
- Isolated live runtime: http://127.0.0.1:5199/?mode=live#world
- Rich sample workflow states: http://127.0.0.1:5199/?mode=fixture&qa=1&scenario=workflow#world
- [Complete acceptance](M7/acceptance.md), [25-screen coverage](M7/coverage.md), [performance](M7/performance.md), [visual review](../design-qa.md), [asset provenance](M7/assets.md)
- Original Goal 1 handoff retained in [M3/goal1-handoff.md](M3/goal1-handoff.md).

## Delivery and evidence

The game remains the primary workspace. Projects become bases; individual tasks and workers retain their own attention signals. Task journals, project administration, full task creation and role policies, agent/run history, skills, execution settings, world controls, usage and connection are semantic React overlays. The existing backend remains authoritative for state, evidence, actions, candidate identity, gates, usage and delivery.

The bounded backend changes add canonical attention, transactional project rename/archive/restore, validated per-role creation overrides across profile snapshots, and legacy-compatible candidate scope checks for repair/retry. History is retained, current actions are reviewed and revalidated, and preview controls cannot dispatch to a live store. No new persistence architecture or game economy was introduced.

The GPT-6 Astra asset agent completed the A2 kit; 35 runtime asset entries and exported motion parts have verified hashes/dimensions and retained source/geometry/QA. Every station composition has been inspected in the actual renderer.

- **1,040 tests passed; 0 failed/skipped.** TypeScript, Biome lint/format and diff checks pass.
- Both frontend builds and all four Sites worker tests pass. A separate lockfile installation also builds the final source successfully.
- Normal 100-task world: 120.48 fps median / 10.10 ms p95 frame interval. Twenty navigation trips retain 36 textures and 2 ticker listeners. Selection p95 is 9.1 ms.
- Stress 50-project/1,000-task world: all task records remain reachable; 93.46 fps median / 15.10 ms p95 frame interval in the measured session.
- Conservative payload bound is about 18.31 MiB; resident texture estimate is 83.88 MiB. These are file/dimension measurements, not driver memory claims.

The existing real ChatGPT-authenticated Codex investigation AH-001 remains complete, with three runs, its approved specification/context and unchanged recorded usage. AH-002 is a closed zero-run management/attachment QA task. No additional paid model execution or real implementation/PR publication was used for Goal 2; those workflow paths were qualified with deterministic provider/GitHub boundaries. The actual runtime was backed up and restarted safely with no active work.

## Remaining polish and verification limits

The reusable architecture and landscape remain less cinematic than the original study. Water repetition, roof/worker proportions, settings density, compact-stage icon spacing and exact return-to-row focus are P3 polish. The accepted first-playable shell is retained; this is not a pixel-identical reproduction of every generated study. Vite's main-chunk size warning remains visible with measured budgets passing.

The IAB does not report native hidden-tab state or confirm OS receipt of the JSON export download. These two native browser integrations remain **unverified**, not passed. Visibility lifecycle tests and the user-facing motion-off control pass; export scope/completeness is explicit. Phone composition is a usable task/overlay fallback, not a new mobile game design.

Placement editing, persistent names, upgrades, unlocks and economy remain v2. No further design approval was assumed beyond Shaun's acceptance and instruction to continue.

## Local operation and rollback

Checkout: `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`; branch: `codex/mission-frontier-first-playable`; base HEAD: `e31566a36ed871cdb3743b8aaadaf08e7f19c6fd`; remote: `https://github.com/shaunnez/agent-harness-ui.git`.

All work remains local and uncommitted. Nothing was staged, pushed, published or deployed. Existing dirty work and the user's runtime4310/design5198 remain intact. The original frontend entry, Vite configuration and protected Sites files match HEAD; selecting the existing frontend is the immediate UI rollback. No database schema migration is required. Keep the additive server support when using Frontier management actions; reverting it removes those new capabilities without rewriting historical records.

The local preview5199 and isolated actual API4321 are left running. Reuse this marked disposable root if either owned service stops; inspect listener ownership before starting/stopping processes. These commands are for handoff/resumption, not an instruction for Shaun to start a server now:

```sh
export PATH=/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
AGENT_HARNESS_API=http://127.0.0.1:4321 npm run dev:frontier
```

```sh
export PATH=/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
node scripts/frontier/qa-server.mjs --codex --root /var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-codex-5CMRsL
```

API4322 is the separate deterministic fixture host at `/var/folders/nr/bpphtrj50gz4_rjqtsdm36_00000gp/T/mission-frontier-fixture-Aupavg`. Its external provider is injected; do not describe it as an actual model run. The M7 pre-refresh SQLite backup is alongside the disposable actual database at `data/m7-before-refresh.sqlite3`. Do not rerun AH-001 to regenerate evidence.

To connect Frontier to a different existing local runtime later, point `AGENT_HARNESS_API` at that loopback service and open `mode=live`; no existing user's service is changed automatically. Verify the target runtime includes the bounded B0–B3 support before using the new management controls. The hosted Sites build is a UI artifact; local repository access and execution require the Node companion.
