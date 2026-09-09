# Shore rim A1 r1

Deterministic five-part partition of approved ground r1. Each1024×768RGBA frame retains the same logical512×384 and anchor[256,290]. Interior and nw/ne/se/sw parts own mutually exclusive pixels, including fractional source alpha. No resampling, palette changes, double-alpha overlap or invented fill.

Reconstruction has exactRGBA pixel equality, zero differing pixels, zero overlapping occupied pixels and zero uncovered original alpha. See machine-readable reconstruction-r1.json. Source and assembled PNG hashes may differ only if encoding differs; pixel equality is canonical.

Native source1× equals logical2×: reconstruction-at-scale2 and joins-at-scale2 show inner edge junctions and outer corner seams at the requested scale. Part ownership sheet is half-size for overview. Edge endpoint and approach sockets are nearest fully opaque owned raster points to original registered corners/midpoints.

Use assembled OR parts, never both together. Parts can be independently translated for bridge approaches/expanded composition, but arbitrary neighboring tiles are not automatically seamless; coordinator must align endpoints and assess new joins. No new terrain, connector geometry or water created. Accepted ground source untouched. Pending coordinator review.

Sampling boundary: source equality does not prove independent bilinear-filtered sprites remain seam-free at fractional zoom. Compose a same-island group at native resolution before scene scaling, or qualify equivalent sampling. No overlapping extrusion was added because ownership must remain mutually exclusive.
