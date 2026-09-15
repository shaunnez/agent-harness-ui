"""Independent package contract and mask-visibility audit; no product/browser changes."""
import json,hashlib
from pathlib import Path
import numpy as np
from PIL import Image
R=Path(__file__).resolve().parents[1];contract=json.loads((R.parent/'contract.json').read_text());entries=json.loads((R/'entries.json').read_text());rows=[]
assert {e['id'] for e in entries}=={f'mf.coastal.{k}' for k in ['terrain','base','bridge','front','lights','shallows','shore']}
for e in entries:
 p=R/e['file'];im=Image.open(p);assert im.size==(2560,1920) and im.mode=='RGBA';assert hashlib.sha256(p.read_bytes()).hexdigest()==e['sha256'];assert p.stat().st_size==e['bytes'];assert e['groundAnchor']==[640,600] and e['logicalSize']==[1280,960];assert list(im.getchannel('A').getbbox())==e['boundsSourcePixels']
 b=e['boundsSourcePixels'];relative=[b[0]/2-640,b[1]/2-600,b[2]/2-640,b[3]/2-600];rows.append({'id':e['id'],'boundsRelativeLogical':relative})
cal=json.loads((R/'qa/detail-calibration.json').read_text());errors={}
for key in ['entrance','bridgeNear','bridgeFar','routeJoin']:
 actual=cal['sockets'][key]['logicalMeasured'];expected=np.array(contract['composition'][key])+[640,600];error=float(np.max(np.abs(actual-expected)));assert error<.001;errors[key]=error
composite=Image.new('RGBA',(2560,1920))
for name in ['terrain','bridge','base','front']:composite=Image.alpha_composite(composite,Image.open(R/'renders'/f'{name}.png'))
opaque=np.asarray(composite)[:,:,3]==255;shore=np.asarray(Image.open(R/'masks/shore.png'));assert np.count_nonzero(shore[:,:,3][opaque])==0;assert np.count_nonzero(shore[:,:,:3][shore[:,:,3]==0])==0
lights=np.asarray(Image.open(R/'renders/lights.png'));assert np.count_nonzero(lights[:,:,:3][lights[:,:,3]==0])==0;assert np.count_nonzero((lights[:,:,3]>0)&(lights[:,:,:3].max(axis=2)==0))==0
# Canvas-relative projected footprint, measured from actual clipped alpha, is the contract authority.
foot=contract['composition']['worldFootprint'];base=contract['composition']['buildingZone'];warnings=[]
for row in rows:
 if row['id'] not in ['mf.coastal.terrain','mf.coastal.base']:continue
 limit=base if row['id'].endswith('base') else foot;b=row['boundsRelativeLogical'];checks=[b[0]>=limit['left']-1,b[1]>=limit['top']-1,b[2]<=limit['right']+1,b[3]<=limit['bottom']+1]
 if not all(checks):warnings.append({'id':row['id'],'measured':b,'contract':limit})
report={'assetCount':len(entries),'socketMaximumErrorsLogical':errors,'actualAlphaBounds':rows,'footprintWarnings':warnings,'opaqueGeometryShoreOverlapPixels':0,'lightBlackMattePixels':0,'sourceHashes':{str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((R/'source').glob('*')) if p.is_file()},'blendSHA256':hashlib.sha256((R/'blend/coastal-detailed.blend').read_bytes()).hexdigest(),'contractSHA256':hashlib.sha256((R.parent/'contract.json').read_bytes()).hexdigest()}
(R/'qa/registration-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

assert not warnings, f'Footprint violations: {warnings}'
