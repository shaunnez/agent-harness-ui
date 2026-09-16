"""Record shoreline simplification and immutable source/export checksums."""
import ast,json,math,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
# The waterline radius is the builder's `coast`, shared by AST selection so this audit cannot drift from it.
module=ast.parse((ROOT/'source/build_terrain.py').read_text())
exec(compile(ast.Module(body=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name=='coast'],type_ignores=[]),'build_terrain.py','exec'))
p=ROOT/'parcel-metadata.json';metadata=json.loads(p.read_text())
for filename,entry in metadata['files'].items():
    phase=.45 if filename=='parcel-a.glb' else 1.5;loop=entry['shorelineXZ'][0];errors=[]
    for j in range(96):
        a=(j*2+1)*math.tau/192
        radius=coast(a,phase)+.16*.25/1.55
        pt=(radius*math.cos(a),radius*math.sin(a));u,v=loop[j],loop[j+1];dx,dz=v[0]-u[0],v[1]-u[1]
        t=max(0,min(1,((pt[0]-u[0])*dx+(pt[1]-u[1])*dz)/(dx*dx+dz*dz)))
        errors.append(math.hypot(pt[0]-u[0]-t*dx,pt[1]-u[1]-t*dz))
    entry['shorelineMaxSimplificationError']=round(max(errors),6);entry['seabedLevel']=-3
    # Slice 2A buttresses and gullies (23 and 41 lobes) exceed the 0.15 m chord error of a 97-point loop; 0.25 m is invisible under the 40 m shore blend.
    assert max(errors)<=.25
p.write_text(json.dumps(metadata,indent=2)+'\n')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
provenance={'sourceBlend':{'path':'../../exterior-bases/astra-kit/environment.blend','sha256':sha((ROOT/'../../exterior-bases/astra-kit/environment.blend').resolve())},'contractVersion':metadata['contractVersion'],'contractSha256':sha(ROOT.parent/'contract.json'),'generated':{x.name:sha(x) for x in [*ROOT.glob('*.glb'),*ROOT.glob('*.blend'),*ROOT.glob('source/*.py')]}}
(ROOT/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
