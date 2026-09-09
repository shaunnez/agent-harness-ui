from pathlib import Path
import hashlib, json
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parent
export=ROOT/'exports/worker-standard-se-neutral-r1.png'
image=Image.open(export).convert('RGBA'); a=np.asarray(image)[:,:,3]
def contour(xa,xb):
    return [(x,int(np.flatnonzero(a[:,x]>=128)[-1])) for x in range(xa,xb+1)]
near=contour(165,194); far=contour(224,248)
near_mean=np.mean(near,axis=0); far_mean=np.mean(far,axis=0)
ground=((near_mean+far_mean)/2).round(3).tolist()
def hull(points):
    p=sorted(set(points))
    def cross(o,a,b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    low=[]
    for v in p:
        while len(low)>=2 and cross(low[-2],low[-1],v)<=0: low.pop()
        low.append(v)
    high=[]
    for v in reversed(p):
        while len(high)>=2 and cross(high[-2],high[-1],v)<=0: high.pop()
        high.append(v)
    return low[:-1]+high[:-1]
foot=hull(contour(148,196)+contour(213,252))
half=lambda pair: [round(v/2,4) for v in pair]
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
refs=[Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/reference/selected-world.png'),Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/screens/agent-work-blocked-v1.1.png')]
measure=json.loads((ROOT/'qa/measurements-r1.json').read_text())
entry={'id':'mf.worker.standard.se.neutral','revision':1,'status':'delivered-pending-coordinator-integration-review','file':'exports/worker-standard-se-neutral-r1.png','sourceSize':[384,384],'logicalSize':[192,192],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':half(ground),'footprint':[half(p) for p in foot],'labelAnchor':[96,10],'occlusionClass':'entity','layer':'entity','sockets':{},'sourceId':'exec-0d136c05-5ba2-42b2-8bba-ad6d29bf2ee7','sha256':sha(export),'alpha':'straight RGBA','facing':'screen lower right (SE), authored orthographic-like view','boundsSourcePixels':measure['exportBoundsAlphaGt0'],'groundAnchorSourcePixels':ground,'contactMeasurementsSourcePixels':{'nearSoleContourColumns':[165,194],'farSoleContourColumns':[224,248],'nearMean':near_mean.tolist(),'farMean':far_mean.tolist(),'method':'Visually identify two front sole contour spans on registered raster; obtain lowest alpha >=128 pixel in each column; ground anchor is midpoint of mean contact points. Footprint is convex hull of lower sole contours x148..196 and x213..252. This is a projected raster support footprint, not recovered 3D geometry.'},'labelAnchorMethod':'Source x192 at y20, 8px above visible bounds y28. Placement aid; not a physical attachment.','display':{'hqVisibleHeightCssPx':58,'hqFullCanvasCssPx':round(384*58/312,4),'detailVisibleHeightCssPx':180,'detailFullCanvasCssPx':round(384*180/312,4)},'qa':['qa/alpha-and-hq-r1.png','qa/detail-actual-scale-r1.png','qa/registration-r1.png','qa/measurements-r1.json','qa/QA.md'],'limits':['One parked pose only; no rig or independent animation parts.','Projected ground anchor is measured from visible sole silhouettes, not a 3D ground solve.','Actual worker is slimmer/taller than the squat close-up concept; coordinator must assess identity/proportions in scene.','58px display preserves silhouette and face; tiny eye separation and mechanical detail are reduced.','No cast shadow; renderer supplies separate ground shadow.']}
(ROOT/'entry.json').write_text(json.dumps(entry,indent=2)+'\n')
register=Image.new('RGBA',(768,768),'#071923');register.alpha_composite(image.resize((768,768),Image.Resampling.NEAREST));d=ImageDraw.Draw(register)
d.line([(x*2,y*2) for x,y in foot]+[(foot[0][0]*2,foot[0][1]*2)],fill='#ffb64c',width=2)
for pts in [near,far]:
    for x,y in pts: d.ellipse((x*2-1,y*2-1,x*2+1,y*2+1),fill='#ffb64c')
x,y=ground; d.line((x*2-10,y*2,x*2+10,y*2),fill='#62d7ff',width=2);d.line((x*2,y*2-10,x*2,y*2+10),fill='#62d7ff',width=2)
d.text((16,16),'Orange: measured sole hull; cyan: contact midpoint',fill='white');d.text((16,36),'Source pixels: '+str(ground)+'; logical pixels: '+str(half(ground)),fill='white')
register.convert('RGB').save(ROOT/'qa/registration-r1.png')
prov={'assetId':entry['id'],'revision':1,'classification':'original AI-generated art using supplied project reference images','generator':'Built-in ImageGen','model':'not selected or asserted by the asset agent; built-in tool','sourceId':entry['sourceId'],'generationPath':'/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-0d136c05-5ba2-42b2-8bba-ad6d29bf2ee7.png','sourceFile':'source/worker-standard-se-neutral-master-r1.png','sourceSha256':sha(ROOT/'source/worker-standard-se-neutral-master-r1.png'),'prompt':(ROOT/'source/generation-prompt.txt').read_text(),'references':[{'path':str(p),'sha256':sha(p),'role':('world style and worker identity' if i==0 else 'worker close-up identity')} for i,p in enumerate(refs)],'correctiveGenerations':0,'transforms':[{'script':'process.py','operations':['RGB source kept unchanged','Green chroma key alpha = 1 - clamp((G-max(R,B)-20)/170,0,1)','Green-only spill clamp to max(R,B)+10 on chroma-key affected pixels','Zero RGB beneath alpha=0','Crop alpha bounds; Lanczos resize to 141x312; composite at 122,28 into transparent 384x384 canvas','Actual-scale compositing QA; no anatomy redraw, no inpainting, no perspective transform']},{'script':'finalize.py','operations':['Pixel-contour measurement in visually chosen sole spans','Runtime entry and provenance metadata','Registration overlay QA']}],'exportSha256':entry['sha256'],'exportBytes':export.stat().st_size,'decodedRgbaBytes':384*384*4,'approval':'Not accepted; coordinator render review required','rightsNote':'Supplied project references and built-in generated output only. No third-party asset imported. Generation provenance is not an assertion of legal clearance.'}
(ROOT/'provenance.json').write_text(json.dumps(prov,indent=2)+'\n')
print(json.dumps({'groundSource':ground,'groundLogical':entry['groundAnchor'],'footprint':entry['footprint'],'exportBytes':prov['exportBytes'],'sha256':entry['sha256']}))
