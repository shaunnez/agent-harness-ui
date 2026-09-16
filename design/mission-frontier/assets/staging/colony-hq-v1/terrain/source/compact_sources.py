"""Drop unreferenced inherited source data from editable parcel blend files."""
import bpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
for kind in ['hub','a']:
    path=ROOT/f'parcel-{kind}.blend'
    bpy.ops.wm.open_mainfile(filepath=str(path))
    for pool in [bpy.data.materials,bpy.data.meshes,bpy.data.images,bpy.data.objects]:
        for data in pool:data.use_fake_user=False
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    # Save only the scene dependency graph, not unused inherited libraries or screens.
    bpy.data.libraries.write(str(path),{bpy.context.scene},fake_user=True,compress=True)
    bpy.ops.wm.open_mainfile(filepath=str(path))
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    print('COMPACT_SOURCE',path.name,path.stat().st_size)
