# Mission Frontier — Astra asset production brief

Revision 2 · 6 September 2026 · A0/A1 completed and integrated under Goal 1; the first playable is accepted. A2 production and qualification completed under Goal 2. Accepted files and provenance are recorded in `assets/runtime-asset-manifest.json` and `build-evidence/M7/assets.md`.

This brief retains the A0–A2 production contract and historical ImageGen assignments. For the approved Blender/Quaternius fidelity pass, use [VISUAL-FIDELITY-GOAL.md](VISUAL-FIDELITY-GOAL.md); its workflow governs Goal 3 while the measured projection, registration, layer separation and truthful-state requirements below remain applicable.

## 1. Responsibility and dependencies

A dedicated **GPT-6 Astra agent** can produce and qualify the artwork alongside the main builder. Astra coordinates the work; the raster generation tool is built-in ImageGen. This is separate from the models chosen for Agent Harness task execution.

The main builder owns the renderer, application code, browser, state semantics, dependencies and final acceptance. The asset agent owns only assigned source/staging files, asset metadata and static/playback QA. It must not alter the app or backend, run real tasks, choose a new renderer, modify original studies, or publish files.

Read [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md), [DESIGN-SPEC.md](DESIGN-SPEC.md), [ATTENTION-CONTRACT.md](ATTENTION-CONTRACT.md) and the existing [asset-manifest.json](asset-manifest.json). Inspect:

- `reference/selected-world.png`
- `screens/project-base-attention-v1.1.png`
- `screens/agent-work-blocked-v1.1.png`
- `screens/agent-work-needs-input-v1.1.png`

These are flattened concepts, not reusable texture atlases, layered buildings or rigged animation frames. The original `asset-manifest.json` describes design-image provenance and remains intact; create a separate runtime-asset manifest.

## 2. Art and camera contract

Preserve ceramic-white architecture, dark steel/slate structure, bright blue water, purple vegetation, warm compatible daylight and the friendly mechanical worker design. Use the actual reference composition and object proportions as the visual target. Do not substitute an unrelated low-poly, pixel-art or cartoon style.

The first renderer is fixed isometric 2.5D. Prove the overview, cutaway HQ and worker close-up as compatible authored representations; explicit transitions are acceptable. The apparent camera rotation/tilt controls in some studies are not v1 requirements. Do not promise that zoom alone can reveal unseen building interiors.

**The compound must have separate floor/back/front/roof or equivalent occlusion layers with common ground anchors and footprints.** The roof can be absent in HQ; front structures must not hide selectable workers or labels. Decorative background plates may contain fixed landscape and architectural sockets. Occupied bays, task sites, workers, counts, task/model/status labels and semantic lights are independent runtime objects.

Freeze a calibration contract jointly before production. These are proposed defaults to measure, not dimensions reverse-engineered from the concept:

| Property | Starting value / rule |
| --- | --- |
| Ground projection | Orthographic 2:1 diamond, subject to M1 visual calibration |
| Logical tile | 128×64 world pixels |
| Raster density | 2× logical dimensions; actual exports measured and recorded |
| Worker display size | About 48–64 logical pixels tall in HQ; separate detail art for about 160–220px close-up |
| View variants | Overview, HQ and detail with consistent identity, palette, facing and lighting |
| Sprite registration | Untrimmed logical size, ground-contact anchor, footprint, label anchor and attachment sockets |
| Occlusion | Ground/shadows → floors/back structures → entities by ground contact → front structures → effects; live DOM labels above |
| Alpha | Straight-alpha PNG master/export; verify actual alpha, no checkerboard or matte baked into pixels |
| Shadow | Separate cast shadow for movable entities; record its offset/opacity convention |
| Atlas | Maximum 2048×2048 per page initially; no rotated frames; 4px edge extrusion and matching spacing; preserve trim offsets |
| Dynamic text | No baked names, task IDs, costs, counters, labels, buttons or model names |
| Semantic feedback | Main builder renders selection and attention using the trusted UI/icon system and separate effect layers |

Lock projection/anchors before producing more variants. If a sprite cannot register with the agreed footprint, return the incompatibility instead of changing the coordinate convention.

## 3. Production batches

The coordinator dispatches one concrete asset ID at a time with dimensions, reference region, intended consumer, view/pose, output path and acceptance notes. Reuse the Astra agent for the next ID after inspecting its handoff. Serial ImageGen calls produce each requested asset; parallel app work continues independently.

### A0 — calibration, required for M1

Create the smallest set that proves the visual contract:

1. One neutral worker, `mf.worker.standard.se.neutral`, establishing character and scale.
2. One layered compound: `mf.base.standard.floor`, `.back`, `.front`, `.roof`, generated/qualified as individual compatible layers.
3. One fabrication station, `mf.station.fabrication`, plus enough approved ground/environment to judge the scene.
4. Compatible worker portrait/detail and a short credible active-tool/part motion proof, each separately registered.

The main builder renders actual placements at overview/HQ/detail sizes and compares them with the references. The A0 gate is an integrated scene, not just a contact sheet. If identity, projection or layer compatibility fails after two targeted corrective attempts, retain outputs and report the concrete limitation with a smaller alternative production approach. Do not keep regenerating blindly.

### A1 — first playable, required for M2–M3

| Asset family | Required capability |
| --- | --- |
| `mf.terrain.{ground,water}` and `mf.terrain.shore.*` | Reusable terrain and a tested shore connector set; no project count baked into scenery |
| `mf.route.road.*`, `mf.route.bridge.*` | Both ground-axis directions plus junctions/bridge transitions that meet without seams |
| `mf.base.standard.*` | A0 compound, usable for several projects with live project identity |
| `mf.station.{communications,fabrication,inspection}` | Distinguishable Grill, Implement and Dev-review work sites |
| `mf.worker.standard.{se,sw}.neutral` | Two compatible neutral facings; active work comes from registered parts/effects |
| `mf.worker.standard.{portrait,detail.neutral}` | Same character in the selection HUD and Watch an agent |
| `mf.prop.{purple-tree,rock,cargo}` | Reusable identity/scale detail; cargo is task evidence only when the app binds it to a retained artifact |
| `mf.artifact.capsule` | Retained-handoff visual, separate from background art |

The kit must support three projects and the v1.1 running/dependency/needs-answer/repair scenes using instances. It must not require a separately painted building for each possible task or package count.

### A2 — full v1, after first-playable acceptance

Extend the accepted vocabulary to all eleven station identities in DESIGN-SPEC, compatible project architecture variations, the delivery pad/shuttle, remaining required worker facings/tools and terrain connectors. Prioritize the next milestone's visible needs. A large arbitrary sprite count is not an objective.

Persisted handoff travel requires a credible motion asset: registered walking/rolling movement or an appropriate designed carrier. Never slide a rigid humanoid across the ground and claim a walking cycle. Qualify delivery/transition animation independently of runtime state; the code owner binds it to actual recorded events.

No placement editor, named permanent workers, upgrade tiers, unlockables or cosmetic shop assets in these batches.

## 4. Animation requirements

Start with neutral assets and separately registered movable parts, tool activity, monitor illumination and modest mechanical articulation. Ambient water/foliage loops are separate from work motion. Do not stretch/bob the entire rigid robot to imitate limb motion.

Generated pose sequences may change shape, lighting or proportions between frames. Do not assume ImageGen has delivered a usable sprite sheet because every cell contains a robot. For any frame animation, deliver:

- Identical untrimmed frame dimensions and shared ground anchor.
- Explicit frame rectangles, durations, facing, playback mode and neutral/static fallback.
- Stable silhouette, face/material identity, lighting, contact points and tool attachment.
- Loop playback capture at actual screen scale plus registration/contact-sheet QA.
- No popping on loop boundaries, frame drift, clipping, matte halos or atlas bleed.

The main builder owns all state selection: strong work motion requires an active run/package; finished, dependency-waiting and blocked workers remain parked. A blue selected ring and amber/coral attention are independent. Visual motion settings cannot change backend execution.

## 5. Files and manifest

Default workspace-relative ownership:

```text
design/mission-frontier/assets/
  contract.json                 # frozen measured renderer/asset agreement, approved by coordinator
  staging/A0/<asset-id>/         # agent-owned sources, exports, transforms, QA
  staging/A1/<asset-id>/
  staging/A2/<asset-id>/
  runtime-asset-manifest.json    # coordinator merges accepted per-asset entries
  provenance.json               # coordinator merges source/provenance entries
  qa/                           # contact sheets and playback evidence

public/frontier/assets/         # only the coordinator copies accepted runtime files here
```

The asset agent writes its assigned per-asset directory and entry file, not the shared manifests. The coordinator reviews, merges and copies accepted output. Use new revision filenames for changes; do not overwrite a file currently being evaluated by the other agent.

Each entry records `id`, `revision`, `file`, `sourceSize`, `logicalSize`, `groundAnchor`, `footprint`, `labelAnchor`, `layer/occlusionClass`, optional `sockets`, optional animation/atlas metadata, `sourceId`, `sha256`, `status` and QA paths. All coordinates state their units and refer to the untrimmed source convention. Use null or pending status until measured; never fill plausible coordinates and call them verified.

Illustrative schema only:

```json
{
  "id": "mf.worker.standard.se.neutral",
  "revision": 1,
  "file": "exports/worker-standard-se-neutral-r1.png",
  "sourceSize": [192, 192],
  "logicalSize": [96, 96],
  "coordinateUnits": "logical-pixels-untrimmed",
  "groundAnchor": [48, 83],
  "footprint": [[36, 77], [48, 71], [60, 77], [48, 83]],
  "labelAnchor": [48, 15],
  "occlusionClass": "entity",
  "sockets": {"tool": [66, 55]},
  "sourceId": "replace-with-recorded-generation-id",
  "sha256": null,
  "status": "unmeasured-example"
}
```

Provenance records the actual generator/tool, full prompt, input reference paths, generation source path/ID, deterministic transforms and source/export hashes. Supplied/generated/third-party assets are distinguishable. Use supplied references and original generation; if a third-party asset is proposed, retain its actual source and licence. Do not claim legal clearance merely because an image was generated.

## 6. Acceptance

For each asset, check source/export paths, dimensions, checksum, true alpha, dark/light/magenta edge visibility, anchor/footprint registration, intended scale and view compatibility. Check connectors in tiled/composed placement, not only individually. Check atlas extrusion and trim offsets at minimum/maximum supported zoom.

For each batch, the builder compares the integrated result against the selected studies at 1568×1003 (HQ 1567×1004), plus 1488×1058 desktop. Check actor occlusion, readable labels, stable selection/attention and role activity at actual size. An asset's attractive close-up does not override poor readability in the game.

Record initial compressed bytes, decoded texture sizes and actual performance. A 2048² RGBA8 page is 16 MiB before mipmaps and other overhead; the PNG download size is not resident texture memory. Production budgets and scene-level acceptance are in IMPLEMENTATION-PLAN, owned by the builder.

## 7. Paste-ready agent assignment

The coordinator fills the assignment fields from the frozen contract before dispatch. This template itself does not authorize production until the build goal is run. Use GPT-6 Astra for the asset subagent; keep the main builder's configured model unchanged.

```text
You are the Mission Frontier asset producer using GPT-6 Astra. Produce only the
single asset ID assigned below, while the main agent builds the application.

Repository: /Users/shaun/.codex/worktrees/7237/agent-harness-ui
Resolve the actual build worktree with the coordinator before writing.
Read AGENTS.md Current redesign brief and design/mission-frontier/
{IMPLEMENTATION-PLAN.md,ASSET-PRODUCTION.md,DESIGN-SPEC.md,ATTENTION-CONTRACT.md}.
Read the frozen assets/contract.json and inspect the supplied reference images.

Assignment (the coordinator supplies concrete values before dispatch):
- Asset ID and revision:
- A0/A1/A2 batch:
- Exact staging directory and export path:
- Reference image/region and consuming view/component:
- Logical and source dimensions, ground anchor/footprint, facing and layer:
- Required static/animation variants and acceptance notes:

Match Mission Frontier's ceramic-white architecture, dark structure, blue water,
purple vegetation, warm daylight and friendly mechanical workers. The current
brief supersedes the old Evidence Gate/Courier Rooms visual layout. Keep all
names, task IDs, counters, model labels and semantic state out of reusable art.
Do not paint dynamic workers or occupied task bays into background scenery.

Use the built-in ImageGen tool and imagegen skill for creative generation and
corrections. Inspect reference files before editing. You are explicitly allowed
to use deterministic tools for crop, masking/alpha cleanup, registration, resize,
contact sheets and atlas packing. These operations must preserve the selected
art and cannot replace missing geometry or repair incoherent anatomy. Verify
the actual alpha channel; a checkerboard background is not transparency.

Generate one requested asset at a time. Inspect and correct it before delivering.
After two unsuccessful targeted corrections, report the precise problem and
possible next approach to the coordinator; do not spend indefinitely or change
the renderer contract. No batch expansion without a new coordinator assignment.

Write only the assigned staging directory. Do not edit shared manifests,
application/backend code, package files, runtime data, original design images or
the original asset-manifest.json. Do not run the product browser, start tasks or
goals, install packages, push, publish or contact external people. Request a
required tool/library through the coordinator if the existing tools cannot do it.

Deliver master/export files, a measured per-asset manifest entry, provenance with
prompt/reference/transform history and checksums, and intended-scale QA. Include
dark/light/magenta alpha checks. Animation additionally needs registered frame
metadata, timings, a static fallback and playback evidence. Report exact paths,
pass/fail findings and remaining limitations. Do not call an asset accepted until
the coordinator has rendered and qualified it in the game.
```

The coordinator can give the same agent a follow-up assignment for the next ID. If a new chat/task is explicitly requested instead, transfer this plan, the frozen asset contract and exact output ownership; do not assume a separate agent can infer them from a concept screenshot.
