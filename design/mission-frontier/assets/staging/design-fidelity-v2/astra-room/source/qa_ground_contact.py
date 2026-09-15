from PIL import Image,ImageDraw
from pathlib import Path
import hashlib,json
R=Path(__file__).resolve().parents[1]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
p=R/'renders/ground-contact.png';im=Image.open(p).convert('RGBA');a=im.getchannel('A');bounds=a.getbbox();meta=json.loads((R/'source/ground-contact-geometry.json').read_text())
assert im.size==(1536,1280) and a.getextrema()==(0,255)
edges=[a.crop(b).getextrema()[1] for b in [(0,0,1536,1),(0,1279,1536,1280),(0,0,1,1280),(1535,0,1536,1280)]];assert edges==[0]*4
unchanged={f:sha(R/f)==h for f,h in meta['unchangedRoomFileHashes'].items()};assert all(unchanged.values())
assert max(abs(meta['groundAnchorSourceMeasured'][i]-[768,1044][i]) for i in [0,1])<.002
room=Image.new('RGBA',im.size)
for layer in ['floor','back','front']:room=Image.alpha_composite(room,Image.open(R/'renders'/('room-'+layer+'-r1.png')).convert('RGBA'))
combined=Image.alpha_composite(im,room);combined.save(R/'qa/ground-contact-combined.png')
# Compare before/after at the actual 0.6 room scale. Two facing room tiles demonstrate shared-edge registration.
scale=.6;tile_size=(round(768*scale),round(640*scale));smallroom=room.resize(tile_size,Image.Resampling.LANCZOS);smallground=im.resize(tile_size,Image.Resampling.LANCZOS)
qa=Image.new('RGB',(1420,560),(75,84,64));draw=ImageDraw.Draw(qa)
for section,grounded in enumerate([False,True]):
 canvas=Image.new('RGBA',(710,560),(75,84,64,255));positions=[(15,20),(round(15+352*scale),round(20+176*scale))]
 if grounded:
  for pos in positions:canvas.alpha_composite(smallground,pos)
 for pos in positions:canvas.alpha_composite(smallroom,pos)
 qa.paste(canvas.convert('RGB'),(section*710,30));draw.text((section*710+18,10),'0.6 scale — '+('WITH CONTACT' if grounded else 'EXISTING ROOM ONLY'),fill='white')
qa.save(R/'qa/ground-contact-tiled-0.6.png')
sheet=Image.new('RGB',(2304,680),'#14222a');draw=ImageDraw.Draw(sheet)
for i,(name,color) in enumerate([('DARK',(17,29,36)),('LIGHT',(224,224,211)),('MAGENTA',(150,28,125))]):
 bg=Image.new('RGBA',(768,640),(*color,255));bg.alpha_composite(im.resize((768,640),Image.Resampling.LANCZOS));sheet.paste(bg.convert('RGB'),(i*768,40));draw.text((i*768+15,12),name+' — CONTACT LAYER ONLY',fill='white')
sheet.save(R/'qa/ground-contact-alpha.png')
checks={'status':'static-qa-passed-pending-builder-in-app-review','sourceSize':[1536,1280],'alphaBoundsSource':list(bounds),'alphaExtrema':list(a.getextrema()),'allCanvasEdgesTransparent':True,'groundAnchorSourceMeasured':meta['groundAnchorSourceMeasured'],'unchangedExistingRoomFiles':unchanged,'qaScale':.6,'drawOrder':'all contact surrounds before any room floor/back/entity/front layers','contactWorldZ':{'slabBottom':-.60,'groundSurface':-.655},'sha256':sha(p),'bytes':p.stat().st_size,'decodedRGBABytes':1536*1280*4,'noBroadShadowHalo':'only slab casts shadow, received by narrow gravel apron; no external shadow-catcher plane','limits':'static image registration and 0.6-scale tiled composition; actual terrain blend/contact is builder-owned'}
(R/'qa/ground-contact-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
entry={'id':'mf.fidelity.room.ground-contact','revision':1,'file':'renders/ground-contact.png','sourceSize':[1536,1280],'logicalSize':[768,640],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[384,522],'footprint':[[384,170],[736,346],[384,522],[32,346]],'footprintNote':'Existing room ground plane z=0 registration; visible contact surface is 0.655 world units lower, matching slab thickness.','labelAnchor':None,'occlusionClass':'ground','sourceId':'astra-original-blender-ground-contact-20260915-r1','sha256':sha(p),'status':checks['status'],'alphaBoundsSource':list(bounds),'alphaBoundsLogical':[x/2 for x in bounds],'bytes':p.stat().st_size,'decodedRGBABytes':1536*1280*4,'qa':['qa/ground-contact-checks.json','qa/ground-contact-alpha.png','qa/ground-contact-tiled-0.6.png'],'provenance':{'tool':'Blender '+meta['blenderVersion'],'source':'original procedural gravel/stone geometry and materials; reused read-only room camera and lighting','renderSamples':48,'renderThreads':4,'seed':915640,'referenceImages':['design/mission-frontier/build-evidence/DESIGN-FIDELITY/grounding/before-hq.png','design/mission-frontier/screens/project-base-attention-v1.1.png'],'sourceFiles':{f:sha(R/f) for f in ['source/build_ground_contact.py','source/qa_ground_contact.py','blend/ground-contact.blend']}}}
(R/'grounding-entry.json').write_text(json.dumps(entry,indent=2)+'\n');print(json.dumps(checks,indent=2))
