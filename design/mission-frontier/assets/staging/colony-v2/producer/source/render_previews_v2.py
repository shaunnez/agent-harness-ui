"""Picker thumbnails for Contract 2.0: each crown on the new shell, exterior azimuth, transparent background."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from v2_lib import *  # noqa: F401,F403
from v2_lib import V2, C2
V2.joinpath('previews').mkdir(exist_ok=True)
variants = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['bastion', 'command', 'relay', 'foundry']
for variant in variants:
    bpy.ops.wm.open_mainfile(filepath=str(V2 / 'hq-shell.blend'))
    with bpy.data.libraries.load(str(V2 / ('crown-' + variant + '.blend')), link=False) as (src, dst): dst.objects = list(src.objects)
    for o in dst.objects:
        if o: bpy.context.scene.collection.objects.link(o)
    preview_lighting()
    cfg = C2['cameras']['exterior']
    cam = camera('preview_crown', (0, 9.8, 1.0), cfg['offset'], 40, 1.5)
    render(V2 / 'previews' / ('crown-' + variant + '.png'), cam, True, 20, (720, 480))
