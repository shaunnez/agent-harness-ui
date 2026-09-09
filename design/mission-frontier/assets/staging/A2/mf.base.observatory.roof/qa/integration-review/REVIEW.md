# A2 deterministic integration review

Current runtime manifest contains 35 assets; all 35 primary export hashes match. Scene mappings cover all ten stages plus optional Design. Eleven HQ and eleven detail compositions use the actual manifest, socket offsets, sprite scales and draw order from scene.ts. Working body and probe are rendered separately at zero elbow rotation. Pixel anchors round only at final raster placement.

## Material finding

Human Approval launchpad in DETAIL uses the generic station position and overlaps the right rear floor boundary/wall. Native evidence: detail-launchpad.png. This is a renderer placement issue, not faulty asset registration. Suggested bounded correction: in detail only, offset the launchpad position by (-35*s,+60*s), where station scale s=2.1; apply consistently to pad, shuttle dock and returned tool socket. Candidate detail-launchpad.png demonstrates (-73.5,+126) world placement. Preserve HQ placement: moving it forward identically causes front-pier worker occlusion. Candidate folder retains the unchanged HQ as a control.

## Composition findings

All eleven zero-angle worker probes meet declared tool sockets mathematically. All baseline HQ compositions have zero opaque worker pixels covered by the front layer. Visual review of HQ/detail contact sheets found recognizable props, readable worker/tool approach, and no additional material asset defects. The shuttle uses runtime 0.70 relative pad scale. Standard and observatory roofs share the base interface in the runtime composition, including current front-after-roof draw order. This is bounded sprite composition evidence, not an in-app visual pass.

## Budget and remaining gates

No ImageGen calls, new runtime textures, export changes or app/backend edits. Ten integrated A2 entries account for 2,827,843 compressed bytes (2.70 MiB) and 18,612,224 decoded RGBA bytes (17.75 MiB). This review adds only staging QA files, outside runtime payload. Check actual Pixi texture metrics separately.

Remaining in-app checks: actual camera fit and UI label/attention overlap; hover/selection hit areas; active +/-4 degree probe articulation at every new site; neutral and finished workers; approval pad detail position fix; shuttle travel only on persisted delivery/handoff events; roof switching for actual project variants; dense HQ sites and artifact overlays. No claim that all assets have passed those checks.
