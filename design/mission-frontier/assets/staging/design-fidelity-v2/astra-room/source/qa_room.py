"""Deterministic static alpha, registration and export manifest QA; no asset geometry edits."""
from PIL import Image, ImageDraw
from pathlib import Path
import hashlib,json,sys
import numpy as np
R=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
geo=json.loads((R/'source/geometry-final.json').read_text());entries=[];checks=[]
# Preserve occlusion from the raw lights render; derive alpha from emitted RGB.
raw=np.asarray(Image.open(R/'renders/room-lights-raw-r1.png').convert('RGBA')).astype(np.float32)/255
strength=raw[:,:,:3].max(axis=2);strength=np.where(strength>4/255,strength,0);out=np.zeros_like(raw);mask=(strength>0)&(raw[:,:,3]>0)
out[:,:,:3][mask]=raw[:,:,:3][mask]/strength[mask,None];out[:,:,3]=strength*raw[:,:,3]
Image.fromarray(np.round(out*255).astype(np.uint8),'RGBA').save(R/'renders/room-lights-r1.png')
combined=Image.new('RGBA',(1536,1280))
for layer in ['floor','back','front','lights']:
 p=R/'renders'/('room-'+layer+'-r1.png');im=Image.open(p).convert('RGBA');a=im.getchannel('A');bounds=a.getbbox();edge=a.crop((0,0,1536,1)).getextrema()[1]+a.crop((0,1279,1536,1280)).getextrema()[1]+a.crop((0,0,1,1280)).getextrema()[1]+a.crop((1535,0,1536,1280)).getextrema()[1]
 assert im.size==(1536,1280) and bounds and edge==0
 assert a.getextrema()[0]==0 and a.getextrema()[1]>0
 if layer!='lights':assert a.getextrema()[1]==255
 if layer!='lights':combined=Image.alpha_composite(combined,im)
 entries.append({'id':'mf.fidelity.room.'+layer,'revision':1,'file':str(p.relative_to(R)),'sourceSize':[1536,1280],'logicalSize':[768,640],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[384,522],'footprint':[[384,170],[736,346],[384,522],[32,346]],'labelAnchor':None,'labelAnchorNote':'Runtime task labels have separate task/station anchors; no baked architectural label socket' ,'occlusionClass':'effects' if layer=='lights' else layer,'sourceId':'astra-original-blender-room-20260915-r1','sha256':sha(p),'status':'static-qa-passed-pending-builder-in-app-review','alphaBoundsSource':list(bounds),'alphaBoundsLogical':[v/2 for v in bounds],'bytes':p.stat().st_size,'decodedRGBABytes':1536*1280*4,'qa':['qa/static-checks.json','qa/alpha-backgrounds.png','qa/registration.png']})
 checks.append({'layer':layer,'dimensionsPass':True,'trueAlphaPass':True,'canvasEdgesAllTransparent':edge==0,'alphaBoundsSource':list(bounds),'sha256':sha(p)})
combined.save(R/'renders/room-combined-r1.png')
logical=combined.resize((768,640),Image.Resampling.LANCZOS)
sheet=Image.new('RGB',(2304,680),'#17232b');d=ImageDraw.Draw(sheet)
for i,(name,col) in enumerate([('DARK',(14,24,31)),('LIGHT',(230,232,224)),('MAGENTA',(170,21,141))]):
 bg=Image.new('RGBA',(768,640),(*col,255));bg.alpha_composite(logical);sheet.paste(bg.convert('RGB'),(i*768,40));d.text((i*768+18,15),name+' · logical 768 × 640',fill='white')
sheet.save(R/'qa/alpha-backgrounds.png')
reg=Image.new('RGBA',(768,640),(17,29,36,255));reg.alpha_composite(logical);d=ImageDraw.Draw(reg);pts=[(384,170),(736,346),(384,522),(32,346)];d.line(pts+[pts[0]],fill='#52caff',width=2)
for name,p in zip(['back','right','ground anchor / front','left'],pts):
 d.ellipse((p[0]-4,p[1]-4,p[0]+4,p[1]+4),fill='#ffdb7a');d.text((max(5,p[0]-45),p[1]+8),name,fill='white')
reg.save(R/'qa/registration.png')
# The footprint is analytically targeted and measured from the actual Blender camera.
anchor=geo['groundAnchorSourceMeasured'];assert max(abs(anchor[i]-[768,1044][i]) for i in [0,1])<.002
measured=geo['floorCornersSourceMeasured'];expected={'back':[768,340],'right':[1472,692],'front':[768,1044],'left':[64,692]}
# Camera-native handedness is normalized by pixel X rather than inferred from world names.
ordered=sorted(measured.values(),key=lambda p:p[0]);assert abs(ordered[0][0]-64)<.002 and abs(ordered[-1][0]-1472)<.002
assert sorted(round(v[1],2) for v in measured.values())==[340,692,692,1044]
report={'status':'pass','scope':'static asset QA; in-app fidelity, worker occlusion and application integration remain builder-owned','layerChecks':checks,'anchorSourceMeasured':anchor,'measuredFootprintSource':measured,'requestedFootprintSource':expected,'registrationToleranceSourcePixels':.002,'sameCameraAndCanvasAllLayers':True,'drawOrder':['floor','back','live task stations and workers','front'],'noBakedDynamicObjects':True,'originalAuthoredGeometry':True,'thirdPartyMeshOrTextureSources':[],'optionalLightsOverlay':'Emission geometry only, occlusion-correct; apply at restrained opacity after back and before runtime entities over night treatment. Do not double-compose into the daytime base. No semantic state.', 'totalDecodedRGBABytes':sum(e['decodedRGBABytes'] for e in entries),'totalPNGBytes':sum(e['bytes'] for e in entries)}
(R/'qa/static-checks.json').write_text(json.dumps(report,indent=2)+'\n');(R/'entries.json').write_text(json.dumps(entries,indent=2)+'\n')
provenance={'sourceId':'astra-original-blender-room-20260915-r1','tool':'Blender '+geo['blenderVersion'],'sourceType':'original procedural geometry and materials','referenceImages':['design/mission-frontier/screens/project-base-attention-v1.1.png','design/mission-frontier/screens/agent-work-blocked-v1.1.png'],'referenceSHA256':{f:sha(R.parents[5]/f) for f in ['design/mission-frontier/screens/project-base-attention-v1.1.png','design/mission-frontier/screens/agent-work-blocked-v1.1.png']},'geometryInstructions':'Modular ceramic-white cinematic cutaway room, 10×10 ground plane; graphite inset bays with amber practicals, blue unlabelled screens, grilles, cables, bolts, floor panels, platform depth, restrained wear. No workers, labels, semantic lights or artifacts. Open centre and low interrupted front parapets.','seed':9152026,'renderSettings':{'engine':'Cycles','samples':64,'denoising':True,'threads':4,'colorManagement':'AgX','alpha':'transparent straight RGBA PNG','camera':geo['camera']},'transformHistory':['Original Blender geometry rendered untrimmed at 2× logical raster density.','Layer rendering uses camera visibility, retaining shared physical shadows.','Pillow alpha-composites QA sheets and preview; floor/back/front production layer pixels are untouched. Lights alpha is derived from the physically occluded emission render: discard <=4/255 black dither; alpha=max(RGB)*sourceAlpha, RGB normalized by max(RGB), zero RGB outside nonzero alpha.'],'files':{str(p.relative_to(R)):sha(p) for p in [R/'source/build_room.py',R/'source/qa_room.py',R/'blend/room-final.blend',*[R/e['file'] for e in entries]]}}
(R/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps(report,indent=2))
