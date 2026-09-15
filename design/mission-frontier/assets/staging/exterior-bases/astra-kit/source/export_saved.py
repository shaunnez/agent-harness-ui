"""Independent export from saved authoring blends into export-check; no authoring mutations."""
import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parents[1];BASE=R.parents[1]/'3d-visual-proof/astra-scene';C=json.loads((R.parent/'contract.json').read_text());META=json.loads((BASE/'scene-metadata.json').read_text())
exec((R/'source/export_kit.py').read_text(),globals())
for kind in ['environment','command','relay','foundry']:
 filename='environment' if kind=='environment' else 'base-'+kind
 bpy.ops.wm.open_mainfile(filepath=str(R/(filename+'.blend')));export_asset(kind,filename,R/'export-check')
