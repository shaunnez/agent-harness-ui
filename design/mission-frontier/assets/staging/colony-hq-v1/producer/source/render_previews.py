"""Producer QA only: load authored shell/crown and render contract camera views."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from hq_lib import *
R.joinpath('previews').mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(R/'hq-shell.blend'))
with bpy.data.libraries.load(str(R/'crown-command.blend'),link=False) as (src,dst): dst.objects=list(src.objects)
for o in dst.objects:
    if o:bpy.context.scene.collection.objects.link(o)
# Shell MF_Roof contains the bay roof; crown root receives a suffix on append.
preview_lighting()
for kind in ['exterior','cutaway']:
    cfg=C['cameras'][kind]
    cam=camera('preview_'+kind,cfg['target'],cfg['offset'],cfg['verticalSpan'],1.5)
    hide=[] if kind=='exterior' else [o.name for o in bpy.data.objects if o.type=='EMPTY' and (o.name.startswith('MF_Roof') or o.name=='MF_ShellCutaway')]
    render(R/'previews'/('command-'+kind+'.png'),cam,False,24,(1350,900),hide)

for stem in ['bridge-span-27','bridge-end']:
    bpy.ops.wm.open_mainfile(filepath=str(R/(stem+'.blend')))
    preview_lighting()
    target=(13.5,1.2,0) if stem=='bridge-span-27' else (0,1,0)
    cam=camera('preview_bridge',target,(25,19,30),18 if stem=='bridge-span-27' else 13,1.5)
    render(R/'previews'/(stem+'.png'),cam,False,20,(1350,900))
