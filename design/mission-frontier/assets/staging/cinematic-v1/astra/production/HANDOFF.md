# Worker production handoff — coordinator review pending

Exported with Blender5.2.1 LTS, Cycles64samples, denoising, straightRGBA. Every work/idle image is384×384, logical192×192, groundAnchor exactly[96,167]. Camera/proportions/light direction preserve the integrated calibration. No app/manifest edits.

Changes: crown gasket seam, recessed torso/shin seams, chest vents and fasteners, ear pins, shoulder vents/fasteners, segmented fingers and probe grip/tip. Ceramic bevels and object-space roughness variation are retained. Identity, blue eyes and overall silhouette remain consistent. No semantic state lights, labels or worker-wide bobbing.

`entries.json` supplies neutral, working and portrait entries. `worker-metadata.json` supplies camera, source anchor, ground foot contacts, per-frame upper/elbow angles, elbow positions and probe tip coordinates. Twelve genuinely distinct work frames run at100ms each (1.2s loop); both upper arm and forearm articulate, with no duplicate closing frame. Frame0 is the placement reference. Maximum probe excursion from frame0 is4.1222source pixels /2.0611logical pixels. Idle is static.

`qa/checks.json` verifies12unique image hashes and probe positions, exact anchor, dimensions,64samples and identical alpha in foot rows300–383. The source model holds feet/body fixed; small physically rendered shading variations may occur elsewhere. `qa/work-playback.gif`, `qa/twelve-frames.png`, actual-scale and dark/light/magenta sheets support review. These are not an in-app pass.

`renders/worker-portrait.png` is a384² render of the same neutral model using a closer orthographic camera. Portrait anchor is only a frame centre, not a ground contact. Full head has margin; lower torso crops. The production `.blend` retains full-body camera and12keyframes; portrait camera is recorded in metadata.

Rebuild: `/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/frontier/blender/astra_worker_production.py`. QA: use bundled Pillow Python on`scripts/frontier/blender/astra_worker_qa.py`. `rebuild-source.py` is a provenance snapshot; canonical script uses repository-relative output paths. `checksums.json` records runtime PNGs. No pack meshes or external textures are used by this worker; geometry is agent-authored from the accepted model. Calibration sources remain unchanged. Tree production was not started.
