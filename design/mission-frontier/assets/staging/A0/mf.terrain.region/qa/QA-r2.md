# Terrain r2 QA

Restores original cleaner source with a single deterministic resize; r1 retained. No new ImageGen call.

Placement proof uses terrain position[760,750], scale2, anchor[512,540], giving world top-left[-264,-330]. Compound scale0.55 gives source-to-world0.275 and footprint center96.8world pixels above front anchor. PC front[280,650], Harness[340,120], MyStrata[1090,560]. See geometry-r2.json and visual proof; these are calibration placements, not terrain collision geometry.

Original source detail is retained; export upsampling adds no detail. Non-seamless static terrain, integrated M1 pending.
