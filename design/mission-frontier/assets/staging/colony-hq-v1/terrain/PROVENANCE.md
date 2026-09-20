# Colony slice 1 terrain provenance

Original connected manifold parcel geometry, ring roads, junction mouths, abutment pads, empty hub landing pad and coastal grass blades are authored by `source/build_terrain.py` for the frozen colony contract. No external downloads or paid generation were used.

The rebuild reads the accepted `../../exterior-bases/astra-kit/environment.blend` without modification. It reuses its Poly Haven CC0 gravel/limestone/coastal-cliff image sources and Quaternius FREE STANDARD CC0 twisted-tree components. Canonical retained provenance is `../../exterior-bases/astra-kit/provenance.json`, `../../3d-visual-proof/astra-scene/HANDOFF.md` and its `sources/polyhaven/` records. Trees are decimated for repeated colony use, source transforms applied and normals recalculated. Ground colour textures are original low-contrast meadow/gravel and limestone palette bakes, paired with retained CC0 source normals. Texture copies are capped at 1024px; leaf alpha is retained; oversized source bark normal is omitted. Each exported parcel embeds at most eight images.

All materials are portable metallic/roughness PBR and single-sided. No project identity, task status, actor, progress, operational animation or paid asset is baked in. The empty hub pad is scenery; it has no shuttle or arrival semantics.

Source previews use a temporary Blender-only water plane which is absent from GLB assets and editable parcel files. Runtime owns water, shoreline motion and lighting. These previews are asset QA, not browser acceptance.
