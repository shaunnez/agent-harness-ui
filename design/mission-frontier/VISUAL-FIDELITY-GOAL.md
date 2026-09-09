# Goal 3 — Mission Frontier cinematic visual fidelity

Prepared 6 September 2026. **Launched explicitly by Shaun on 6 September 2026.** Current checkpoint: [build-evidence/VISUAL-FIDELITY/progress.md](build-evidence/VISUAL-FIDELITY/progress.md).

## Runnable instruction

When Shaun asks to run Goal 3, create a goal with this objective and execute the brief below:

> Deliver one production-quality Mission Frontier island, using the approved Quaternius assets and Blender, integrated into the existing World, Project headquarters and Watch an agent views. Preserve v1 functionality, qualify visual fidelity and interaction in the actual application, meet the measured performance gates, and update the project journal with verified results. Leave a working local preview and a complete handoff ready for Shaun's review.

Check the existing goal first. Resume an active Goal 3 rather than creating a duplicate. If a different goal is unfinished, reconcile its actual status before proceeding. Do not set a token budget unless Shaun specifies one. “Overnight” means work autonomously through the defined outcome; it is not a deadline, a guarantee of completion by morning, or an instruction to keep running after completion. No build heartbeat or external infinite loop is needed.

This is a local run: the Mac, app, workspace and network must remain available. For overnight execution, enable **Prevent sleep while running** in the app's settings, as described in the [official long-running work guidance](https://learn.chatgpt.com/docs/long-running-work). Preparing or launching this goal does not itself change that setting.

## 1. Starting state and authority

The working copy at preparation time is `/Users/shaun/.codex/worktrees/7237/agent-harness-ui`, branch `codex/mission-frontier-first-playable`, remote `https://github.com/shaunnez/agent-harness-ui.git`. Verify these and the actual dirty state before editing. Much of Goals 1 and 2 is uncommitted, including assets and backend work; preserve it. Do not clean, stash, reset, broadly stage or overwrite it.

Read these sources before production:

- Root `AGENTS.md`, `IMPLEMENTATION-PLAN.md`, `DESIGN-SPEC.md`, `ATTENTION-CONTRACT.md` and `BACKEND-COVERAGE.md` in this design pack.
- `screen-catalog.json`, `assets/contract.json`, `assets/runtime-asset-manifest.json` and `ASSET-PRODUCTION.md`.
- `build-evidence/HANDOFF.md`, `build-evidence/progress.md`, `build-evidence/M7/acceptance.md`, `performance.md` and `assets.md` in M7.
- The actual renderer, asset loaders, camera, layout, state projections and relevant tests under `src/frontier/` and `tests/frontier/`.

Open and inspect the actual reference images, not just their filenames: `reference/selected-world.png`, `screens/project-base-attention-v1.1.png`, `screens/agent-work.png`, `screens/agent-work-blocked-v1.1.png` and `screens/agent-work-needs-input-v1.1.png`. Compare them with a fresh capture of the running app and the latest M7 captures. Use the Product Design context workflow if the source or intended composition remains unclear.

Goals 1 and 2 completed the independent React/Pixi frontend, 25 destinations, supported workflows and 35 runtime asset entries. Goal 3 improves the visual presentation; it does not reopen M0–M7 implementation or replace their historical evidence. M7's 1,040 passing tests and performance numbers are a dated baseline, not proof about new code. Native hidden-tab state and OS download receipt were unverified in that environment; do not silently mark them passed.

Inspect listeners, process working directories and store ownership before reusing or starting services. The historical setup used game preview 5199, isolated actual API 4321, deterministic API 4322, design study 5198 and a separate user runtime on 4310. These are hints, not current authority. Never terminate an unrelated process or bind a fixture server to a real store. Inspect `scripts/frontier/qa-server.mjs` and `isolated-api.mjs` before running them.

The game uses `npm run dev:frontier`, with `AGENT_HARNESS_API` pointing to the verified isolated API. Fixture review normally opens `http://127.0.0.1:5199/?mode=fixture#world`; workflow samples use `?mode=fixture&qa=1&scenario=workflow#world`. Recheck the available routes. Do not start the root default runtime blindly. Leave the actual CLI investigation evidence intact; no additional paid model workflow is required for this art pass.

## 2. Approved art direction and scope

Produce one excellent, reusable island composition containing an irregular coastline, visible cliffs and shore, a bridge with convincing ground connections, vegetation, a distinctive headquarters and one coherent worker design. Show it at world scale, in the headquarters cutaway and at agent detail scale in the real application. Integrate enough task sites to demonstrate Running, Needs your answer and Repair required together. Also qualify dependency waiting, completed and disconnected states.

Use the selected Mission Frontier study as the identity: ceramic-white architecture, dark slate structure, blue water, purple vegetation and warm daylight. Improve massing, materials, depth, contact shadows, silhouette, scale and credible motion. Stock meshes are ingredients; customize their composition and materials to fit the existing world. Avoid a generic asset-pack scene or a new visual theme.

The priority order is:

1. **Landscape and depth:** varied island outline, believable cliff/shore transitions, overlapping vegetation and continuous physical routes. Remove conspicuous water repetition and seams without hiding task sites.
2. **Architecture and lighting:** a recognisable HQ, compatible exterior/interior, coherent scale, a consistent upper-left sun and grounded contact shadows. Preserve useful contrast at normal play zoom.
3. **Workers and activity:** friendly, legible proportions, articulated working motion and stable contact with tools/floor. Avoid rigid sliding, whole-body bouncing or decorative motion that suggests a stopped agent is working.
4. **Camera and atmosphere:** restrained water, vegetation and machinery ambience; clear selection, depth ordering and transitions. Keep text, decisions and task status readable. Depth of field, bloom or fog must not obscure operational content.

Keep React and PixiJS with the fixed orthographic/isometric camera. Blender is the production tool for geometry, materials, rigging and rendered layers/frames. Retain independent selectable objects and semantic overlays. Do not flatten the complete scene and place invisible hotspots over it. A full real-time 3D engine change, freely rotating camera, placement editor, persistent worker names, upgrades, unlocks and economy are outside this goal.

Complete this island and the compatible reusable parts needed for its three views before expanding production. Remaining projects/stations may retain accepted v1 art for this review; identify that boundary clearly. Do not spend the run replacing every asset or redesigning all 25 destinations. Keep the new island available through a stable review route or a clearly labelled visual preview preference that does not change persisted task state.

## 3. Asset acquisition and Blender production

Approved candidates, verified on their publisher pages when this brief was prepared:

| Pack | Intended use | Approved acquisition |
| --- | --- | --- |
| [Quaternius Modular Sci-Fi MegaKit](https://quaternius.itch.io/modular-sci-fi-megakit) | Modular architecture, structural details, props and bridge components where suitable | Free Standard download or appropriate already-owned files |
| [Quaternius Stylized Nature MegaKit](https://quaternius.itch.io/stylized-nature-megakit) | Trees, plants and rocks adapted to the Mission Frontier palette | Free Standard download or appropriate already-owned files |

The publisher lists both as CC0 and supplies standard 3D exchange formats. Inspect existing local assets first. Recheck the actual download and licence when acquiring files; record the source URL, download date, archive hash, licence evidence and the meshes used. Do not buy Pro/Source editions, donate, use paid credits or accept a paid checkout without separate authorization. Use an ordinary free download if offered. If a required asset is inaccessible, retain the evidence and continue independent work; use a scoped custom Blender substitute only when it meets the same visual requirement, and disclose the substitution.

Blender was available at `/Applications/Blender.app/Contents/MacOS/Blender` when this direction was discussed. Verify the installed version and executable. CLI/Python scripting is a valid production path; do not assume a Blender connector exists. Import suitable glTF/FBX/OBJ models and retain editable `.blend` sources. A paid “Source” edition is not a prerequisite.

Create reproducible import, material, camera, lighting and export scripts under `scripts/frontier/blender/`. Keep source archives, `.blend` files, renders and metadata in a dedicated `design/mission-frontier/assets/staging/cinematic-v1/` tree. Record tool versions, seeds where relevant, render settings and exact rebuild commands. Keep source archives and `.blend` files out of browser payloads.

Calibrate one building, one plant and one worker in the application before committing to final renders. Match the existing measured 2:1 isometric projection, 2× raster density, logical scale and anchors from `assets/contract.json`. Treat that contract as measured starting data; document and version any justified revision, then qualify every affected view. Do not compensate for incompatible cameras with unrelated per-object visual guesses.

Export compatible floor/back/front/roof layers with common origins and measured footprints. Keep movable workers, their shadows, task occupancy, semantic lights and labels independent. Use straight RGBA with no matte fringe; validate transparent edges over the actual ground and water. Preserve foreground occlusion without hiding the selected worker or its action. Reuse current non-rotated atlas packing and registration where practical; atlas maximum is 2048×2048 with 4px extrusion unless measurement justifies an explicit change.

For the worker, create or adapt an editable articulated model/rig matching the selected reference. Export a quiet idle pose/loop and a convincing work loop; add locomotion only where a real transition needs it. Inspect frame alignment, feet, contact shadows and tool reach at world/HQ/detail scale. A stopped worker retains selection and attention indicators but performs no work animation. Environmental ambience must remain distinguishable from actual agent execution.

Integrate qualified exports through versioned runtime asset entries. Preserve the accepted assets and a documented way to select the prior presentation. Avoid eagerly loading both full art sets: demand-load detail/alternate art so the payload and memory gates still hold. No unexplained provenance, missing source files or orphaned runtime assets.

## 4. Astra assignment and ownership

Use the already-authorized one GPT-6 Astra asset subagent for concrete Blender asset work alongside useful main-builder work. Reuse the existing asset agent if available; otherwise create one bounded subagent with the requested Astra model. Do not create a new user-owned Codex task. Do not fan out into an unbounded team.

The first assignment is a **calibration kit**, not the entire environment: one HQ module, one vegetation cluster and one articulated worker sample, sharing camera, light, scale and palette. Give the agent the inspected references, current contract, exact asset IDs, intended display sizes and a dedicated subdirectory inside `assets/staging/cinematic-v1/astra/`. It owns only that staging directory and its assigned Blender source/export scripts. Avoid concurrent writers to the same `.blend` or script.

The main builder owns application code, dependencies, live processes, browser use, runtime manifests, performance, visual acceptance and journal publishing. The asset agent supplies editable source, exports, contact sheets, geometry/anchor metadata, provenance, exact commands and known defects. Review its sample in the actual app before assigning the next bounded asset. Stop obsolete renders when a calibration change invalidates them; do not pay the rendering cost of an unqualified full kit.

The new workflow uses Blender and the approved meshes. Do not blindly replay the historical A0–A2 ImageGen prompts. If a new raster concept or edit becomes necessary, use the applicable ImageGen workflow and stay within the accepted direction.

## 5. Execution checkpoints

Create `build-evidence/VISUAL-FIDELITY/progress.md` when the goal actually starts. Append a pointer in the existing progress/handoff documents without rewriting completed Goal 2 history. Record completed work, the next concrete step, actual process ownership, long-running render IDs, files changed, asset revisions, evidence paths, checks and unresolved findings. Update at each meaningful checkpoint and before compaction or a long render. Do not rely on conversation memory for resumption.

| Checkpoint | Required result before moving on |
| --- | --- |
| V0 — baseline | Verified repo/runtime ownership, inspected references/current app, asset inventory/licences, matched before captures and a short visual gap list |
| V1 — calibration | Editable Blender sample and measured exports integrated at all three scales; compatible light, camera, proportions, alpha, layering and picking |
| V2 — island | Coast, bridge, vegetation, HQ/cutaway, worker and three task states integrated; world → HQ → agent → action/return remains usable |
| V3 — refinement | Matched reference/baseline/current comparisons, concrete visual findings corrected, credible animation and readable busy state |
| V4 — qualification | Interaction, regression and performance evidence, reproducible assets, rollback notes, journal update and final review handoff |

Spend the early part of the run proving integration. Do not defer the first browser inspection until a long batch render finishes. For each material visual issue, make a targeted correction and compare again. If two targeted attempts fail for the same underlying reason, diagnose the projection/material/rig/composition problem and change that approach instead of repeating blind renders or lowering the acceptance standard.

Continue routine implementation and fixes autonomously. Ask only for required missing access, a material unresolved tradeoff or an expansion beyond this scope. Preserve useful progress when one branch is blocked. Follow the actual goal tool's completion/blocking rules; never mark the goal complete because it is late, the token budget is low or rendering consumed the available time.

## 6. Functional and visual acceptance

Use computer use on the actual local application. Record the URL, viewport, fixture scenario, asset revision and camera state for each comparison. Save original-reference / M7-baseline / new-build comparisons with consistent crops; do not imply different states or zoom levels are a matched comparison.

- Review World and Agent at the reference 1568×1003 viewport, HQ at 1567×1004, then 1488×1058 and 1280×720. Keep the existing 390×844 task/overlay fallback usable. Desktop game fidelity is the priority.
- Exercise canvas picking, pan/zoom, minimap, project entry, worker selection, foreground occlusion, watch-agent detail, next eligible action and return/focus restoration. Use the actual controls; DOM-only checks do not qualify canvas interaction.
- Verify Running, Needs your answer and Repair required together at HQ, and individually in Watch an agent. Show affected task/stage, persisted reason, next actor and eligible action. Dependency waits, approval waits, completed runs and disconnected last-known state must retain their distinct meanings. No ambient animation, decorative counter or elapsed time may invent execution or progress.
- Preserve all existing management, task list/create, stage/package/agent drill-down, artifacts/diffs, cost/tokens/time, model/reasoning policies, skills, settings and approval controls. Keep supported actions reachable from the game and utility overlays. Preserve backend eligibility, candidate identity, repair lineage and explicit confirmation semantics.
- Check text contrast, selection/status distinctions beyond colour, clear silhouettes, labels at normal zoom, keyboard paths and reduced motion. Layered art must not cover the command bar or turn a task into an inaccessible decoration. State labels remain normal readable UI, never baked into artwork.
- Capture a short animation sample if the available tools support it; otherwise use an ordered frame strip plus a recorded browser observation. A still screenshot cannot substantiate animation quality. Do not call a beauty render or a successful build an in-app visual pass.

The island should show clear improvement over the baseline in terrain depth/variation, architecture/material coherence, worker proportions/contact and three-scale consistency, while retaining operational clarity. Record what improved and what still differs from the design study. No unresolved P0/P1/P2 issue may remain in the delivered scope. Report minor P3 notes and retained v1 art explicitly. Completion means ready for Shaun's review, not that Shaun has accepted the new art.

## 7. Performance and regression gates

Measure after integration on the same machine/browser configuration where practical. Identify browser, viewport and device pixel ratio; separate cold load, warm rendering and camera work. Reuse the existing fixtures and instrumentation where valid. Do not invent performance from nominal frame rate or hide a failed gate by reducing the recorded workload.

| Gate | Required evidence |
| --- | --- |
| Normal workload | 10 projects, 100 tasks, up to 30 visible workers; warm up, then measure at least 60 seconds including camera movement; median ≥50 FPS and p95 frame interval ≤33ms |
| Busy world | 50 projects, 1,000 tasks, up to 60 visible workers via grouping/culling; record frame performance and demonstrate that all records/actions remain reachable |
| Selection | p95 input-to-visible-selection ≤100ms from measured samples |
| Lifecycle | 20 World/HQ/detail round trips; bounded listeners, textures and scene entities; no accumulating animation loops |
| Asset budget | Initial transfer ≤20MiB; estimated resident RGBA textures ≤192MiB; record actual transferred bytes and decoded dimensions separately |
| Motion/background | Reduced-motion and user motion-off preserve information/actions; no unnecessary hidden-page loop where the environment can actually verify it |

For context only, M7 recorded 18.31MiB conservative payload, 83.88MiB estimated RGBA textures and 9.1ms p95 selection. Re-measure rather than carrying these numbers into new qualification. Explain any material regression even when the minimum gate still passes.

Run focused asset/camera/scene/attention tests first, then `npm run test:frontier`, `npm run test:frontier-api`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build:frontier`, `npm run build` and `npm run test:sites`. Run broader repository tests where shared code is affected or an unresolved regression warrants them. Add tests for changed behaviour or contracts; do not add tests that merely restate decorative values. Inspect every failure and distinguish pre-existing failures from regressions without concealing either.

Preserve root `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, `tests/sites-worker.test.mjs`, `src/main.tsx`, `src/App.tsx` and `vite.config.mjs`. The root build must still produce `dist/client/index.html`, `dist/server/index.js` and `dist/.openai/hosting.json`. Use the frontier entry/config for game work. Review the final diff and file ownership; no unrelated cleanup or dependency upgrade.

Use deterministic isolated fixtures for exhaustive interaction and performance. Do not create live paid tasks, approve real work, push a game branch, open/merge a real PR, deploy the game or mutate unrelated user data as QA. The asset agent's authorized execution is distinct from launching paid backend test workflows.

## 8. Journal and final handoff

At the completed visual milestone, update the separate `journal-site/` project from verified evidence. Read its `AGENTS.md` and use the Sites skills for that work. Preserve the original design study and prior dated posts; add the actual before/after images, Blender/asset approach, what changed, measured results and remaining limits. Label fixture content and conceptual art honestly. Never publish local paths, raw task exports, credentials or private backend data.

The journal already has a six-hour update heartbeat. Inspect current source/publication ownership before editing or publishing so another updater's work is not overwritten. Do not create another automation. Reuse the existing journal Site identity and access policy; publication is authorized for the current selected audience. Do not make it public or invite anyone. Journal publication does not authorize publishing the game. Follow its existing sync, checks, exact-source publication and confirmed-deployment record workflow.

Leave a complete `build-evidence/VISUAL-FIDELITY/HANDOFF.md` with:

- A working local preview URL and exact route/scenario for the new island, with the preview running and open for review.
- Matched World/HQ/Agent before-and-after captures, animation evidence, acceptance coverage and any remaining visual differences.
- Actual test and performance results with commands, logs, conditions and limitations; historical results clearly separated.
- Asset sources/licences, used meshes, editable Blender files, export commands, runtime manifest revisions and the way back to the prior presentation.
- The journal update and confirmed published URL/version, or a precise external publication failure retained separately from the game's verified results.
- A concise next recommendation: Shaun reviews this island before any broad asset replacement or architectural expansion.

Mark the goal complete only when required work and qualification are actually done. Report incomplete work honestly if access or an external dependency prevents completion. Finish with a short review handoff rather than a chronological log of the night's work.
