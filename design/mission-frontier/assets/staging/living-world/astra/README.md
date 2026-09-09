# Living worker animation handoff

Original authored cinematic worker, with unchanged material, camera and light setup. Geometry comes from the retained `source/original-worker-production.py`; motion script adds small mechanical ankle bearings to close the joint during larger gait poses. No paid or third-party assets are used.

Runtime candidates: `renders/worker-walk-00.png` … `07.png`, `worker-scan-00.png` … `07.png`, `worker-type-00.png` … `07.png`. Each is untrimmed 384×384 RGBA, logical 192×192, with ground anchor [96,167]. No baked floor, labels, particles or semantic state. Each loop uses 8 frames at 150 ms (1.2 s total). Footprint and label anchor remain unspecified; builder owns selection and labels.

Walk is a SE in-place gait with two-link leg IK, support foot on ground, opposite foot lifting, and neutral arm counter-swing. Mirror horizontally for SW. The torso sits 0.08 model units lower during the walking gait to permit bent knees; scene ground anchor never moves. Use approximately 36 logical pixels per full cycle, or 30 logical px/s multiplied by actor scale. This is a suggested screen-space pace, not a simulation of exact no-slip contact: the gait phase uses sinusoidal limb travel and the caller owns route translation. Transition to original idle when stopping; do not leave a frozen mid-stride pose for reduced motion.

Scan: planted feet, articulated head sweep and probing arm, supporting hand held lower. Type: planted feet, small alternating two-hand console taps and a slight downward head nod. The original probe remains in one hand to preserve worker equipment identity; console geometry is supplied by the consuming view. Only the runtime may select work animation from truthful activity.

Registration and per-frame sockets: `worker-motion-manifest.json` includes source-pixel ground anchor, logical-pixel probeTip sockets, alpha bounds, SHA-256, compressed bytes, retained source hashes and decoded RGBA budget. Walk also reports projected foot contacts and world-space foot heights. Null footprint/label positions are deliberately unmeasured.

QA: `qa/*-contact-192.png`, `qa/*-actual-scale.gif`, `qa/*-alpha-backgrounds.png`, and `qa/numeric-report.json`. Contact sheets and GIFs composite transparent frames at actual 192 logical size; exported PNGs retain straight alpha. Each loop decodes to 4.5 MiB before renderer overhead; lazy-load work loops and avoid instantiating one copy per worker.

Editable sources: `blend/worker-{walk,scan,type}.blend` retain frame 1–8 location/rotation keys, with 150 ms frame timing. Rebuild from the repository root using:

```
/Applications/Blender.app/Contents/MacOS/Blender -b -t 4 --python scripts/frontier/blender/astra_living_worker.py
/Users/shaun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 design/mission-frontier/assets/staging/living-world/astra/source/qa.py
```

The retained `source/rebuild-living-worker.py` is a source snapshot; use the repository script path to preserve output-root resolution. Rendering is deterministic in pose and registration; Cycles PNG byte hashes may vary on other Blender versions/platforms. Builder owns final in-app visual acceptance, loop playback at runtime scale, route safety and truthful state selection.
