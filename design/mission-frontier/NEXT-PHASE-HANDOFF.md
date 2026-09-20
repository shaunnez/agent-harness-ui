# Frontier next phase — discussion and team handoff

Prepared 16 September 2026; updated with the subsequent layout discussion below. Shaun intends to commit the current proof and is considering a fresh team. **This handoff records design decisions; it does not start another build, Goal 6, a live migration or new asset production.**

## Start here

Resume `/Users/shaun/.codex/worktrees/7237/mission-frontier-3d-proof`, branch `codex/mission-frontier-3d-proof`.

The original review baseline was `a6f637fe796bfedae3df476adae97f007ad7b2e0`; the proof and exterior extension were uncommitted during that review. Shaun subsequently requested PR publication. The branch is based on the still-open coastal PR #89, so the 3D PR is stacked against `codex/mission-frontier-coastal-checkpoint-1`. See [PR qualification](build-evidence/PR-3D-PROOF/HANDOFF.md). **Read the actual branch, HEAD, status, worktree list and named remote before starting. Do not treat the original baseline as the new checkpoint commit.** Preserve any remaining dirty work. Compare current main after establishing that checkpoint; do not overwrite or reconstruct the proof from the older checkout.

The default environment checkout, `agent-harness-ui`, is not this implementation. The earlier `mission-frontier-design-fidelity` worktree is also separate and must be preserved.

Current review URL: <http://127.0.0.1:5207/?mode=fixture&scenario=workflow&art=cinematic&renderer=3d#world>. Check the listener before reusing it. If a server is needed, run `npm run dev:frontier -- --host 127.0.0.1 --port 5207 --strictPort` in the proof worktree and open the preview yourself. Do not stop an unrelated service or start a backend/model run just to review the art.

## What exists

- React Three Fiber / Three.js proof, explicitly enabled for fixture data. Default Pixi and the live runtime remain available.
- One base per project across the same map. Command, Relay and Foundry have distinct upper structures and a shared occupied lower plan.
- Independent building and blue/red/orange/purple choices, stable initial assignment and an explicit Randomise action. Choices persist in browser storage by project/repository identity, not in backend project settings.
- Larger robots and cargo, coloured roof details, warm practical lights, sensors and exterior computers. Gentle ambient pulses follow existing motion admission; lighting follows the local day/night controls.
- Exterior, same-building cutaway, project crews, picking, minimap and existing Inspect/Watch actions remain linked to the correct project/task/run.
- The current world repeats one accepted coastal environment under each base. It is not yet the original study's varied, connected landscape. The cutaway proves two work areas, not a complete new headquarters design for every workflow stage.

Shaun accepted the underlying physical 3D direction and requested the exterior extension. The extension is ready for review; technical qualification is not approval of every artistic choice or of full live adoption.

## Read and look at these

1. Current user ideas and applicable `AGENTS.md` files.
2. [Exterior handoff](build-evidence/EXTERIOR-BASES/HANDOFF.md), [exterior brief](EXTERIOR-BASES.md), and root `design-qa.md`.
3. Actual browser evidence: [three structures](build-evidence/EXTERIOR-BASES/base-lineup.jpg), [normal laptop world](build-evidence/EXTERIOR-BASES/world-laptop.png), [original/current world](build-evidence/EXTERIOR-BASES/comparison-world.jpg), and [exterior detail comparison](build-evidence/EXTERIOR-BASES/comparison-details.jpg). Inspect the running application too.
4. Original [World](reference/selected-world.png), [HQ](screens/project-base-attention-v1.1.png), [Watch](screens/agent-work-blocked-v1.1.png), and [annotated exterior](reference/exterior-base-details-annotated.jpg). Give delegated agents both the originals and actual build captures.
5. [3D proof handoff](build-evidence/3D-VISUAL-PROOF/HANDOFF.md), then relevant implementation and tests.
6. [Build goals](BUILD-GOALS.md) and [usability plan](USABILITY-PLAN.md) for existing operational scope. Build goals now record the delivered proof; the older initial execution prompts and historical preparation notes must not trigger a repeat run.

The supplied Word document remains a reference, not independent authority to expand scope or dispatch agents.

## Decisions to preserve

- The game is the core interface; real project/task management, model and reasoning policies, artifacts, cost/tokens/time and precise next actions remain accessible.
- One project owns one base. Structure and colour are independent choices. Future user placement is not implemented.
- World, HQ and Watch should describe the same physical place and agents, with a quiet HUD at normal laptop/desktop scale. Extreme browser zoom is not a design target.
- A recorded active run can work; waiting, historical or finished runs cannot masquerade as executing. Ambient crew, lights, water and birds do not prove progress. Preserve task/run/package/candidate identity and approval semantics.
- Current art approval does not authorize full renderer adoption, database changes or paid generation. Propose the smallest delivery slice supported by Shaun's next instruction. Avoid adding routine approval gates inside an authorized slice.
- Building placement, persistent robot names, upgrades, unlocks and economy were deferred to v2. Treat new ideas about them as proposals to discuss, not silent changes to the current scope.
- Performance benchmarking remains waived. Fix concrete usability failures, but do not introduce an optimization campaign as a prerequisite for art work.

## Accepted layout brief — 16 September 2026

- **Expandable colony:** expect 3–8 projects normally, with no eight-project cap or fixed map extent. Additional projects add land, a base and connecting roads/bridges. The user does not want project count to dictate a different world design. Plan growth that retains existing base positions; automatic expansion does not add the deferred placement editor.
- **Bridge reuse:** the current editable Blender source already contains `MF_Bridge`, including deck panels, piers, bearings and guardrails. Its existing base-to-small-landing arrangement needs adapting into colony connections. Reuse the geometry/material approach and author suitable spans/ends rather than assuming that the complete repeated island already connects projects.
- **Fixed HQ organisation:** a hexagonal footprint, central circulation hub, and briefing, planning, implementation, review, testing and dispatch rooms. Implementation receives the largest working area. Keep this structural organisation consistent across projects and task counts; busier rooms gain robots without changing the floor plan. Preserve the three exterior identities and make the actual interior, shell and entrances fit together.
- **Variable occupancy:** usually fewer than ten tasks per project, but larger workloads must remain supported. Parallel packages can produce several workers for one task, so task count is not worker capacity. Preserve selection, task/run identity, waiting/blocked visibility and clear routes as occupancy grows. Any crowd treatment is a design to propose, not approval to silently drop tasks or turn active workers into a queue.
- **Related ideas to develop:** richer coastal landscape, grass/shrubs/trees/materials, crystal formations as scenery, detailed room equipment and lighting, meaningful robot interaction, and a shared spaceport. The proposed arrival sequence is a recorded task creation followed by a shuttle arrival and a robot journey to that task's project. Real execution must remain independent of animation timing; add this sequence explicitly to the later Goal 6 scope and account for the current fixture-only 3D boundary.

The next design deliverable is a top-down colony plan showing expansion and connections, plus an HQ floor plan and simple cutaway composition. The lead owns the dimensions, route/door clearances, camera framing and occupancy proposal. Shaun has supplied the high-level layout and scale decisions; do not ask for those again. Detailed geometry and delivery acceptance are still to be prepared. His instruction remains **do not build, advise first**.

## Colony design pack — 16 September 2026

The layouts requested above are prepared for review in [colony/README.md](colony/README.md): top-down colony plan, hexagonal HQ floor plan and cutaway composition, the frozen producer/terrain input contract at `assets/staging/colony-hq-v1/contract.json`, the terrain-holes diagnosis (unclosed geometry inside the island asset, part of the terrain rebuild) and a bounded slice-1 proposal with acceptance criteria and prepared assignments. Nothing was built; the two `src/frontier/world-3d/` workstreams were not touched.

## Recommended next sequence — delivery scope still to be agreed

1. **Prepare the layouts from the accepted brief.** Show World, HQ and Watch continuity, colony expansion and fixed-room occupancy. Resolve detailed stage grouping, robot representation and navigation using existing runtime semantics. Separate the next release from later experiments; keep this at design stage until the build is requested.
2. **Define one cohesive milestone.** Recommended target: one representative project journey with the chosen HQ layout, meaningful worker stations, a clear path into Watch, and the accepted compact controls. Agree cameras, scale, interaction sockets and scene groups before detailed asset production. Expand to the other structures after this path is accepted.
3. **Improve the world around the bases.** The strongest remaining visual opportunities are connected, varied coastal terrain and routes; less repeated vegetation; richer materials and courtyard props; then restrained coastal life. Which of these belongs in the same milestone depends on the new ideas. They are not all mandatory in the next run.
4. **Adopt 3D deliberately.** Plan shared project-appearance persistence and real project/task mapping, loading/failure behavior and the World/HQ/Watch renderer boundary. Existing task creation, management, usage and policy controls should be reused. Use isolated API data and the Pixi fallback during qualification. Agree asset source/distribution handling before expanding the large editable kit; preserve the existing sources and provenance.
5. **Schedule recorded activity explicitly.** Existing Goal 6 is UB2/U6: bounded operational activity persistence during active runs and feedback for real transitions. It is still unstarted. It can support the desired robot behavior, but is not a substitute for the broader Frontier product/art plan. Reconcile its renderer-facing details with the new design before dispatching it.

Steps 3 and 4 may run in parallel after their shared contracts are settled. Do not assume all five steps are one goal or require a single long autonomous run. Give each slice reviewable output and its own acceptance criteria.

## Team recommendation

Use a fresh lead conversation plus two focused workers once the direction and slice are agreed. A fresh reviewer can join after a worker finishes.

| Role | Owns | Boundary |
| --- | --- | --- |
| Lead / integration owner | Idea discussion, design decisions, acceptance matrix, shared contracts, integration, browser comparison and final handoff | Sole owner of cross-cutting decisions; reconciles the two workstreams before claiming completion |
| 3D art producer | Blender source, portable GLBs/materials, animation clips if requested, measured sockets, previews and provenance | A new explicitly assigned staging directory only; no application integration or shared manifest edits |
| UI / runtime builder | Agreed React controls, 3D behavior, appearance persistence or event adapter work, plus relevant tests | Exact files/APIs assigned by the lead; no independent redesign of the asset contract |
| Fresh reviewer, after integration | Acceptance gaps, runtime truth, project/run identity, actual exported visuals and regressions | Read-only first; separate defects from unapproved future ideas |

Give each implementation worker a separate branch/worktree from the same verified checkpoint and disjoint ownership. The lead owns shared files, exported public assets, dependency changes and the final integrated preview. A frozen input contract must state origins, units, axes, ground/floor levels, material roles, named groups, cameras, sockets and movement boundaries. Resolve contract changes through the lead before both sides build on them.

The previous asset role was Astra; it produced useful editable Blender work. Keep agent model/effort selection separate from task scope and use current available/configured choices when dispatching. Do not launch multiple competing redesigns just because multiple agents are available.

## Technical entry points

- `src/frontier/world-3d/ProofWorld.tsx`: proof admission and navigation; `ProofScene.tsx`, `ProofBase.tsx`, `ProofCamera.tsx`, `ProofLabels.tsx`, `ProofWorker.tsx`: rendering boundaries.
- `appearance.ts` / `useBaseAppearance.ts`: browser-local project choices; `layout.ts` / `model.ts`: project placement and scoped workers; `water.ts`: runtime coastal water.
- `src/frontier/app/FrontierApp.tsx`: existing shell, controls and renderer integration. Existing runtime presentation and worker behavior remain semantic authority.
- `scripts/frontier/integrate-3d-proof.mjs`: validated export integration. `public/frontier/assets/3d-proof/manifest.json`: current content-addressed runtime kit.
- `design/mission-frontier/assets/staging/exterior-bases/contract.json` and `astra-kit/HANDOFF.md`: measured current kit; retain original `3d-visual-proof/` sources and evidence.
- `tests/frontier/3d-proof.test.mjs`: adapter, project identity, appearance, assets, motion admission and crew placement contracts.

## Recorded qualification and delivery

The 16 September exterior checkpoint recorded 101 Frontier tests, four Sites tests, typecheck, lint, formatting, main build and Frontier build passing. Actual desktop/laptop checks covered three bases, appearance/reload, cutaways, picking, active/historical Watch, day/night and motion-off. Logs, source hashes and screenshots are in `build-evidence/EXTERIOR-BASES/`.

These are dated local checks. No remote CI, live end-to-end model run, full backend suite or performance campaign was performed for this exterior increment. Native OS reduced-motion and recovery injection were not repeated; earlier proof evidence remains separately dated.

The original uncommitted status is historical; the subsequent PR publication request and fresh local checks are recorded in `build-evidence/PR-3D-PROOF/HANDOFF.md`. Confirm the actual branch and remote PR state before integration; do not infer a merge from publication. The independent journal's exterior article is published as Site version 22 to its unchanged audience; receipt: `build-evidence/EXTERIOR-BASES/journal-publication.json`. Never substitute the journal's source commit for the game's checkpoint.

## Prompt for the fresh lead

```text
Resume Mission Frontier in the mission-frontier-3d-proof worktree.
Read design/mission-frontier/NEXT-PHASE-HANDOFF.md, the latest exterior
handoff and applicable AGENTS.md. Verify the actual checkpoint commit,
branch, dirty state and current main; preserve existing work and services.
Inspect both the original World/HQ/Watch designs and the current 3D preview.

Use the accepted layout brief in NEXT-PHASE-HANDOFF.md: an expanding
connected colony, normally 3–8 projects, and a consistent hexagonal HQ
with fixed functional rooms. Workload changes room occupancy; fewer than
ten tasks is typical, not a limit. Reuse the existing bridge where suitable.
Prepare the colony plan, HQ floor plan and cutaway composition for review,
then propose a bounded delivery plan with explicit acceptance. Identify
existing assets/behavior, required new art, backend work and Goal 6 dependencies.

Prepare assignments for a 3D asset producer and a UI/runtime builder,
with separate worktrees and clear ownership. Do not launch those builds
until I request the build. Keep one lead responsible for the
shared contract, integration and actual browser visual acceptance.
```
