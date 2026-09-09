# Terrain region A0 r1

Pending coordinator review and integrated M1. Opaque2048×1280RGB export, logical1024×640, anchor[512,540].

Two ImageGen corrections moved obstructing water/cliffs away from prescribed clearings; all original attempts retained. Final terrain remains static and free of bases/workers/UI. Guide marks exist only in QA.

Inspect clearing-registration at requested centers[824,950],[544,590],[1364,750] with450×250source rectangles. Independent-bases-proof places accepted compound imagery at440×220source floor footprint for calibration only. This composition is not baked into export.

The source is smaller than requested output and is resampled once, with actual dimensions in geometry.json. Repeated generative editing increased some grass/rock texture contrast; assess at actual scene scale rather than assuming source-detail fidelity. No seamless edge matching, 3D collision map, terrain animation or foreground tree separation is supplied.
