"""Producer QA and picker thumbnails: each crown on the shared shell, exterior azimuth, transparent background."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from hq_lib import *
R.joinpath('previews').mkdir(exist_ok=True)
variants=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['bastion','command','relay','foundry']
for variant in variants:
    bpy.ops.wm.open_mainfile(filepath=str(R/'hq-shell.blend'))
    with bpy.data.libraries.load(str(R/('crown-'+variant+'.blend')),link=False) as (src,dst): dst.objects=list(src.objects)
    for o in dst.objects:
        if o:bpy.context.scene.collection.objects.link(o)
    preview_lighting()
    cfg=C['cameras']['exterior']
    # Tighter than the contract exterior: the tile shows the crown and the front of the shell, not the court.
    cam=camera('preview_crown',(0,8.6,1.5),cfg['offset'],36,1.5)
    render(R/'previews'/('crown-'+variant+'.png'),cam,True,20,(720,480))
