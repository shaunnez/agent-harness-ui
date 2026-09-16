"""Record shoreline simplification and immutable source/export checksums."""
import json,math,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'parcel-metadata.json';metadata=json.loads(p.read_text())
for filename,entry in metadata['files'].items():
    phase=.45 if filename=='parcel-a.glb' else 1.5;loop=entry['shorelineXZ'][0];errors=[]
    for j in range(96):
        a=(j*2+1)*math.tau/192
        radius=44.6+.52*math.sin(5*a+phase)+.32*math.sin(9*a-.7)+.18*math.sin(15*a+1.2)+.16*.25/1.55
        pt=(radius*math.cos(a),radius*math.sin(a));u,v=loop[j],loop[j+1];dx,dz=v[0]-u[0],v[1]-u[1]
        t=max(0,min(1,((pt[0]-u[0])*dx+(pt[1]-u[1])*dz)/(dx*dx+dz*dz)))
        errors.append(math.hypot(pt[0]-u[0]-t*dx,pt[1]-u[1]-t*dz))
    entry['shorelineMaxSimplificationError']=round(max(errors),6);entry['seabedLevel']=-3
    assert max(errors)<=.15
p.write_text(json.dumps(metadata,indent=2)+'\n')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
provenance={'sourceBlend':{'path':'../../exterior-bases/astra-kit/environment.blend','sha256':sha((ROOT/'../../exterior-bases/astra-kit/environment.blend').resolve())},'contractVersion':metadata['contractVersion'],'contractSha256':sha(ROOT.parent/'contract.json'),'generated':{x.name:sha(x) for x in [*ROOT.glob('*.glb'),*ROOT.glob('*.blend'),*ROOT.glob('source/*.py')]}}
(ROOT/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
