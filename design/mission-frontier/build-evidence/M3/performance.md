# First-playable performance baseline

6 September 2026, this Mac and Codex IAB,1568×1003 CSS pixels. Measurements use the real Pixi/WebGL renderer and explicit in-memory load fixtures; no paid load tasks. The display produced approximately120Hz frame intervals. Results are local development-build measurements, not a cross-device guarantee.

| Measurement | Observed | Target |
| --- | --- | --- |
| Normal10 projects/100 tasks |72.78s,7,476 frame samples,48 camera/task interaction rounds | At least60s |
| Frame median |119.05fps | >=50fps |
| Frame p95 |12.4ms | <=33ms |
| World selection acknowledgement |40 samples; p95 7.0ms, maximum8.8ms | p95 <=100ms |
| Initial world raster load |13,585,480 compressed bytes (12.96MiB);25 textures | Initial payload <=20MiB |
| Initial decoded raster estimate |66,977,792 bytes (63.88MiB) | <=192MiB |
| World after visiting detail |26 textures;69,337,088 decoded bytes (66.13MiB) | Bounded cache |
|20 world/HQ/detail round trips |World entities12, textures26, ticker listeners2 at0/5/10/15/20 | No increasing entity/texture/ticker count |
| Stress50 projects/1,000 tasks |1,000 rows and50 needs-you records accessible; last task and last attention item opened | All task/attention records reachable |
| Stress renderer snapshot |52 root entities,25 textures; median120.48fps, p95 9.3ms | Reachability/grouping; no additional60s target claimed |

Scene policy renders at most20 representative workers for the normal10-project world and50 for the50-project world. Task history remains available through the journal; grouping never deletes task records. Samples of all12 core fixture task identities were individually opened and checked, separate from the stress count/search test.

The compressed figure is the sum of the loaded manifest textures, not a network-timing guess. The final production entry is about805kB minified (about246kB gzip), plus small renderer chunks, CSS/fonts and a52kB manifest. Even an uncompressed sum of the initial rasters and all emitted non-raster files remains below20MiB. See asset-audit.json and packaging-audit.json. Decoded bytes conservatively count RGBA8 dimensions, including RGB source files; this is not total GPU/process memory. Pixi uses its default non-generated mipmaps for these PNGs. The neutral detail worker loads on first detail entry and remains cached. The shared region scenery is currently eager.

Selection timing starts in the canvas/world-label selection handler and ends at the next React layout commit. It measures HUD acknowledgement, not server completion or physical display latency. The 73-second camera/selection run used48 journal selections plus keyboard pan and zoom; the separate40-sample acknowledgement run used world labels.

The live, isolated completed task produced69 refresh cycles,3 summary reads and1 selected hydration, with0 refresh failures. Browser resource evidence contains82 API requests /145,654 decoded response bytes; p95 resource duration458.8ms, including startup/status/core requests. Projects and lightweight markers refresh around2s; unchanged selected evidence is not fetched every tick. These timings are a mixed local API sample, not model throughput.

Motion-off in the browser produced0 frame samples and `tickerRunning:false`, with selection and forms still usable. The IAB reports all its automated pages as visible even after opening another tab and hiding the browser, so real OS backgrounding could not be demonstrated there. The dedicated visibility-event test verifies stop on hide, no restart from hidden refreshes, correct resume, offline/reduced-motion preservation and listener removal on disposal. System media-query wiring was inspected; no user OS preference was changed. This automation limitation is retained for manual/native-browser confirmation during broader M7 qualification.
