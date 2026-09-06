# Worker calibration r1 — delivered, pending scene review

Built-in ImageGen produced one source; no corrective generation was needed. The 1254×1254 RGB master is retained unchanged. The authorized deterministic processing script removes green, clamps green spill (including a post-resize pass), registers the full silhouette and exports 384×384 straight-alpha RGBA. No anatomy was redrawn or synthesized during processing.

## Checks performed

- Export is RGBA, 384×384; alpha spans 0–255, with 114,811 fully transparent pixels and 4,463 partial-alpha pixels. No nontransparent pixels touch a canvas border.
- Full visible bounds are source [122,28,263,340], all within the provisional target box. Visible height is 312 source pixels / 156 logical pixels.
- Visually inspected dark/light/magenta composites at full export size, 58px HQ visible height and 180px detail visible height. No obvious green matte, clipping, missing body parts or baked ground/shadow. The two eyes and mechanical details become small at HQ size, while the head/limb silhouette remains readable.
- Visually inspected the measurement grid and sole registration overlay. Ground anchor is measured source [207.75,327.753], logical [103.875,163.8765], not the provisional source [192,334]. Footprint is the convex hull of lower raster sole contours; it is a projected support region, not inferred 3D geometry. Label anchor is a derived placement aid 8 source pixels above the visible head.
- The subject faces lower-right, stands parked, carries no tool, and has no baked names, counters, selection ring or semantic status. Blue eyes are character identity, not a running-state indicator.

## Integration notes and limitations

- Use the measured logical ground anchor; do not assume centered/bottom alignment. Full canvas renders at approximately 71.385 CSS pixels for a 58px visible subject, or 221.538 CSS pixels for a 180px subject.
- This worker is slimmer and taller than the squat close-up reference. Materials, round head, face panel, eyes and joints are consistent in this asset review, but the coordinator must judge proportions in the integrated scene. No claim of exact character identity match or acceptance is made.
- This is one neutral sprite. There is no rig, animated limb layer, tool socket or walking cycle. Cast shadow and semantic effects belong to separate runtime layers.
- Lighting and apparent orthographic projection look compatible in isolation; scene-level scale, ground contact, occlusion and cross-view fidelity remain unverified until coordinator rendering.

QA images: `alpha-and-hq-r1.png`, `detail-actual-scale-r1.png`, `measurement-grid-r1.png`, `registration-r1.png`. Reproduce exports with the supplied `process.py`, then metadata and registration with `finalize.py`, using the bundled Python runtime containing Pillow and NumPy. No package was installed.
