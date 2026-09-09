# Verified render batch

Final Blender 5.2.1 render completed all 24 PNG frames successfully. Contact sheets for walk, scan, and type were visually inspected at logical 192px scale. Light/dark/magenta alpha composites show clean transparent silhouettes. Numeric report confirms 8 distinct frames per loop, full RGBA alpha extrema, no edge clipping, stable source anchor [192,334] and grounded walk support foot on every frame.

Compressed PNG total: 1,673,793 bytes. Walk: 543,885; scan: 566,281; type: 563,627. Decoded frame textures: 4,718,592 bytes per loop, 14,155,776 bytes for all three before renderer overhead.

Reopened worker-walk.blend independently: 82 animated objects; all retained action frame ranges [1,8]; fps 20 with fpsBase 3.0, yielding 150ms frames. The same source loop saves scan and type with identical timing.

The initial gait was refined with two-link IK; QA then caught and corrected the new ankle bearing scale evaluation before final export. Superseded intermediate renders and backup blends are not part of this handoff.

Runtime scene integration, console alignment, path movement and animation state selection remain builder acceptance work.
