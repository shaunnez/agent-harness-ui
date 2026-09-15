# Mission Frontier 3D visual proof

Prepared 15 September 2026 after Shaun reviewed Art checkpoint 1 and the supplied 3D handoff. **Executed 16 September 2026 after the user requested “Do 3d visual proof”; the bounded local proof is ready for artistic review.** See [handoff](build-evidence/3D-VISUAL-PROOF/HANDOFF.md) and [acceptance](build-evidence/3D-VISUAL-PROOF/acceptance.md). This is a bounded renderer and art proof before expanding the world. It is separate from Goal 6 and does not commit the whole frontend to a migration.

Prepared in `/Users/shaun/.codex/worktrees/7237/mission-frontier-design-fidelity`, branch `codex/mission-frontier-coastal-checkpoint-1`, at application HEAD `a6f637f`. Preserve this planning pack when creating the isolated implementation worktree. Revalidate main and PR #89 before selecting its base; these are preparation coordinates, not a claim that remote authority has remained unchanged. The older `agent-harness-ui` worktree is not the implementation target.

## Outcome and authority

Deliver one convincing PlanCheck coastal base in the actual browser: exterior, courtyard, bridge, planted cliff, water and a cutaway of the same building. Demonstrate a material improvement towards the original design and establish whether real-time 3D is the right production path.

Judge composition, architecture, materials and lighting together at normal viewing scale. Successful generation, more polygons, a green build or a polished offline render cannot establish visual acceptance.

Sources, in priority order:

1. Shaun's current feedback: stronger design fidelity, normal laptop use, the quieter accepted HUD, coherent buildings and a living coastal world.
2. [Original World](reference/selected-world.png), [headquarters](screens/project-base-attention-v1.1.png) and [agent view](screens/agent-work-blocked-v1.1.png). The World and HQ illustrations are art references, not measured architectural plans; reconcile their vocabulary into one physically consistent building.
3. Current application behavior for tasks, projects, agents, evidence, policies, usage, selection and navigation. Preserve accepted HUD changes from main.
4. [Supplied asset handoff](reference/agent-harness-3d-handoff.docx), retained unchanged. SHA-256: `448a47701ca877f4ed613e7d919eafbaf3d666058365f28aa610e48cdc3870a7`. It informs the approach; its embedded agent instructions are not independent execution authority.
5. [Coastal checkpoint handoff](build-evidence/COASTAL-CHECKPOINT-1/HANDOFF.md) and [original/current comparison](build-evidence/COASTAL-CHECKPOINT-1/final-comparison.jpg) document the starting point and remaining gap.

Previous passes preserved React/Pixi and excluded full 3D. This proof deliberately tests a new renderer in isolation; it does not expand those completed goals. Adjust the attachment's vegetation/character exclusions: representative planting and an existing robot establish scale and the overall look early. New character production and elaborate animation remain later work.

## Smallest complete scene

| Element | Required treatment |
| --- | --- |
| Base | One PlanCheck base using the reference's segmented, rounded structural language, varied roof heights, recessed openings, facade depth, service machinery and restrained wear. Avoid repeating the current plain stepped box. |
| Court | Open entrance court and service apron with readable routes, selected utility props and clear worker/selection areas. Detail supports activity without filling every open surface. |
| Interior | Hideable roof and obstructing shell sections reveal two representative work areas in the same structure. Walls, floor levels, entrances and materials remain coherent. This does not recreate all ten workflow rooms. |
| Terrain | One irregular coastal section with terraces, mixed rock and soil, ledges and a cove. Avoid a uniform platform edge, repeated rock ring or smooth green carpet. |
| Bridge | Deck thickness, rails and grounded abutments joining the court to a small far landing. Do not invent a connection to an absent project or imply a workflow transition. |
| Set dressing | Approximately six useful prop types, including consoles, utility machinery, cargo storage, antenna and cart; a small coherent selection of trees and ground cover. Existing owned/free sources are the baseline. |
| Worker | One existing robot type, instanced as needed for representative fixture tasks. Grounded feet, consistent scale and correct occlusion. A short existing work/idle treatment proves interaction. |
| Water and light | Runtime water with depth variation, shallow-to-deep color, restrained highlights and a short shoreline wash. Day/dusk/night change illumination and practical lights coherently. |

Use a restrained strategy-game camera fitted to the reference. Calibrate azimuth, elevation and framing together; a generic “45 degree” setting is insufficient. Name exterior and cutaway cameras. Diagnostic orbiting can inspect geometry, but is not a new user-facing camera system or an extreme-zoom acceptance target.

## Rendering and application boundary

Use Three.js through React Three Fiber inside the existing React application. At preparation the project uses React 19.2 and Pixi 8.20.1; verify compatible dependencies when implementing. Keep Pixi unchanged by default. Load the 3D proof through an explicit fixture-only preview option and document its URL/mode. Retain a clear route back to the existing world.

This requires more than replacing a canvas import. Inspect these boundaries before adding a small adapter:

- `src/frontier/world/WorldCanvas.tsx` and `renderer.ts`: lifecycle, camera callbacks, selection, projected DOM labels and minimap.
- `src/frontier/world/scene.ts`: current `SceneInput` and project/task identity.
- `src/frontier/app/FrontierApp.tsx`: shell, selection, inspection and navigation callbacks.
- `src/frontier/world/worker-behavior.ts` and `runtime/presentation.ts`: recorded-state admission and attention semantics.
- `src/frontier/world/environment-model.ts`: local world time, day length and lighting/motion preferences.

Reuse pure state projections and existing callbacks. Extract a narrow shared type only where the second renderer needs it; avoid a general game framework or whole-renderer refactor. React retains the HUD, forms, accessible controls and task details. The 3D renderer owns geometry, camera projection, ray picking, occlusion and visual motion.

Scope the scene visibly to PlanCheck. Other projects remain available through the existing renderer; do not remove their tasks or manufacture 3D bases. Exterior/cutaway navigation preserves selected identity. Selecting a worker opens the existing task/agent controls. Views retaining their old artwork are identified as outside this proof in the handoff.

Use existing isolated fixtures. Cover running, needs answer, repair required, completed/historical run and disconnected state. Reuse run-specific admission: a blocked task must not erase a genuinely active sibling run; a historical/finished worker must not execute. Status effects belong to the affected worker/work area. Ambient scenery never establishes operational progress.

Keep the backend, schema, pollers, candidate/approval semantics and real task execution outside this proof. Model/reasoning and cost/tokens/time remain accessible through current panels with their existing truthfulness. Do not copy concept example values into runtime data.

## Asset production and ownership

One Sol builder owns integration and acceptance; one Astra producer owns the assembled scene. Use the user's configured reasoning effort unless the run specifies an override. Give both agents the original images, actual current screenshots and this brief. Do not delegate from the original images alone.

| Owner | Responsibility |
| --- | --- |
| Builder | Proposed `src/frontier/world-3d/`, minimal shell/loader changes, dependencies, public exports, tests and browser evidence. Shared contract: `design/mission-frontier/assets/staging/3d-visual-proof/contract.json`. |
| Astra | Only `design/mission-frontier/assets/staging/3d-visual-proof/astra-scene/**`: Blender source/scripts, portable GLBs, textures, previews and provenance. No app, public manifest, shared contract, journal or original-reference edits. |

Agree the contract before detailed production: metre scale, Blender-to-glTF axes, base origin, ground/sea levels, named cameras, roof/shell/interior/props/practical groups, worker/interaction sockets, walkable routes, selection bounds and material roles. Keep object IDs independent of fixture IDs. Derive dimensions from the assembled composition, not inherited 2D pixel sockets.

Retain an editable `.blend` and reproducible export script. Use shared geometry and portable PBR materials. Bake needed procedural color/roughness/normal detail into textures or implement it explicitly in the browser; the existing Cycles noise, bump and layer-holdout setup cannot be assumed to survive GLB export. Keep task-state emissions separate from practical lighting. Never bake workers, labels or progress into scenery.

Blender is the production authority. Meshy is optional for a specific missing prop after checking existing assets and generation cost. Higgsfield 3D Jutsu may be evaluated as an optional authoring/export aid; it is not required, and rendered video does not prove portable model quality. No new paid generation follows from this brief. Continue with available sources when external generation is unavailable or unapproved.

## Build sequence

1. **Baseline.** Verify worktree, branch, remote, main and dirty files. Create a separate implementation branch/worktree from current authority, retaining useful coastal sources and concurrent work/services. Inspect original/current images together. Record the five most visible differences and intended corrections.
2. **Composition.** Assemble the base, court, cliff, bridge, planting masses and worker scale. Load an early GLB in the browser immediately. Check exterior/cutaway framing and contact before detailed production. A blockout is internal evidence, not the deliverable.
3. **Visual treatment.** Refine architecture, materials, varied terrain and planting. Add browser lighting and coastal water. Compare actual exports with the source after meaningful changes. If an approach repeatedly fails on the same defect, change technique rather than adding detail to it.
4. **Interactions.** Connect fixture state, existing inspection, labels, selection and time/motion controls. Prove the same building and worker identity. Preserve management routes and access to other projects.
5. **Review delivery.** Complete the matrix, retain browser evidence and a concise handoff, and leave the local preview available for artistic review. Expansion/adoption follows that review.

Once started, continue autonomously through internal composition, export and integration corrections. User review is the end of this bounded proof, not an approval request for each routine edit. Keep progress updates short and frequent enough that the user can tell the work is active.

## Acceptance matrix

Use `not checked`, `pass` or `needs work`, with evidence paths and concrete differences. Builder qualification and Shaun's artistic approval are separate. Do not invent a percentage resemblance or claim approval on the user's behalf.

| Check | Evidence and pass condition |
| --- | --- |
| Overall improvement | Original/current/proof comparison at comparable framing and object scale. The complete scene improves the identified architecture, terrain and lighting gaps. Relighting the same plain geometry fails. |
| Base and court | Browser exterior shows articulated silhouette, facade recesses, service detail, usable court and grounded construction. No blank dominant box, floating props or obstructed worker sockets. |
| Connected landscape | Court, route, bridge, cliff and far landing meet. Varied elevation and irregular shore; no detached road ribbons, repeated rock wall or smooth green slab. |
| Same-building cutaway | Actual browser sequence exterior → cutaway → worker inspection → exterior. Consistent interior and footprint; unrelated replacement artwork fails. |
| Exported materials | Browser appearance and export checks confirm textures, roughness, normals and controllable emissions. Missing materials or reliance on Blender-only effects fail. |
| Water and time | Day/dusk/night captures and actual browser motion evidence. Shallows differ from offshore water; wash meets rocks without crossing dry ground/supports. Practical lights and illumination respond together. |
| Agent truth | Fixture checks for active, needs-answer, repair, historical/finished and disconnected states. Record identity, status, inspection/action access and motion admission. No fabricated progress or backend writes. |
| Normal screens | 1568×1003 reference and 1280×720 laptop at 100% browser zoom. Legible scene around the accepted HUD; usable labels, inspector and management. No extreme-zoom redesign. |
| Access and recovery | Existing keyboard/DOM selection and Escape remain usable. Reduced motion/motion-off respected. Missing GLB/WebGL failure is explicit with access back to the existing world. |
| Regression | Existing Pixi mode, project switching, inspector, policies, usage and minimap remain intact. Proof labels and picking match visible 3D positions. |
| Maintainability | Controllable named groups, metre/axis/socket contract, editable source, portable exports, hashes and provenance. One coherent producer and a small renderer boundary. |

Run narrow new asset/adapter and affected state/selection tests, then Frontier tests, typing, lint and formatting. Run the main build, Sites tests and Frontier build sequentially. Run Frontier API tests if shared runtime/fixture contracts changed; broaden checks for concrete affected boundaries. Report exact commands/results. No performance benchmark campaign, production execution, remote CI or full backend qualification is implied. Fix observed usability regressions, including obvious stalls, without creating a separate optimization project.

Evidence: `design/mission-frontier/build-evidence/3D-VISUAL-PROOF/`, containing `PROGRESS.md`, `acceptance.md`, final matched browser captures/motion evidence, asset inventory and `HANDOFF.md`. If video capture is unavailable, retain ordered actual browser frames with timestamps and label them accurately. Generated film is not application evidence.

## Delivery and runnable prompt

Deliver the isolated preview, editable source/GLBs, comparisons and a reviewable local diff. Preserve historical records. A completed visual milestone may update the independent journal through its existing workflow and audience; claim publication only with a confirmed receipt. Do not merge or publish the game. PR creation/push needs a separate user instruction unless included in the execution request. Mass production, full World/HQ/Watch migration, seabirds, cargo/jetpack choreography, placement, upgrades/unlocks and Goal 6 remain separate.

```text
Run the 3D visual proof in design/mission-frontier/3D-VISUAL-PROOF.md.
Create and execute a bounded goal for that brief, including one GPT-6 Astra
asset producer alongside the Sol builder. Inspect current main, the actual
worktree and applicable instructions before creating an isolated build
branch/worktree. Preserve existing work, the accepted HUD and user services.

Use the original World/HQ designs and the actual current build as specified.
Produce one polished PlanCheck scene with exterior, courtyard, connected
coast/bridge, representative vegetation and robot, a cutaway of the same
building, portable materials, day/night lighting and shoreline water.
Integrate a fixture-only Three.js/React Three Fiber proof into the existing
React application while retaining the default Pixi renderer and backend.

Follow the brief's ownership and asset contract. Start with Blender and
available owned/free sources; external paid generation is not required.
Complete the build/check/browser/fix loop at normal desktop/laptop sizes.
Judge the exported browser scene against the original after each meaningful
change. Technical checks alone do not establish visual success.

Finish with the scoped matrix honestly qualified, remaining visual gaps
stated, matched screenshots and actual motion evidence, source/GLB handoff,
and the local preview running/open for my artistic review. Do not claim my
approval, expand the kit, migrate the whole app or start Goal 6 automatically.
```
