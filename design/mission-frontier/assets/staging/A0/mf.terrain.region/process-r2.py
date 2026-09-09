from pathlib import Path
from PIL import Image,ImageDraw
import hashlib,json
R=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,o):(R/n).write_text(json.dumps(o,indent=2)+'\n')
p=R/'source/terrain-region-master-attempt1.png';m=Image.open(p);out=m.convert('RGB').resize((2048,1280),Image.Resampling.LANCZOS);e=R/'exports/terrain-region-r2.png';out.save(e)
# Terrain world origin: (760,750) - (512,540)*2 =(-264,-330).
placements={'PC':[280,650],'Harness':[340,120],'MyStrata':[1090,560]}
base=Image.open(R.parent/'mf.base.standard.roof/qa/closed-compound-r1.png').convert('RGBA');scale=.55/2;base=base.resize((round(base.width*scale),round(base.height*scale)),Image.Resampling.LANCZOS)
proof=out.convert('RGBA');guides=out.copy();d=ImageDraw.Draw(guides);locations={}
for name,(x,y) in placements.items():
 a=[x+264,y+330];locations[name]={'frontAnchorWorld':[x,y],'frontAnchorTerrainSource':a,'footprintCenterTerrainSource':[a[0],a[1]-96.8]}
 proof.alpha_composite(base,(round(a[0]-768*scale),round(a[1]-1044*scale)))
 corners=[(a[0],a[1]-193.6),(a[0]+193.6,a[1]-96.8),(a[0],a[1]),(a[0]-193.6,a[1]-96.8)]
 d.line(corners+[corners[0]],fill='#ffdd55',width=3);d.text((a[0],a[1]+5),name,fill='white')
proof.convert('RGB').save(R/'qa/independent-bases-proof-r2.png');guides.save(R/'qa/placement-registration-r2.png');out.resize((1568,980),Image.Resampling.LANCZOS).save(R/'qa/scene-1568-r2.png')
write('geometry-r2.json',{'masterDimensions':list(m.size),'sourceSize':[2048,1280],'logicalSize':[1024,640],'groundAnchor':[512,540],'terrainRuntimePosition':[760,750],'terrainRuntimeScale':2,'terrainWorldTopLeft':[-264,-330],'compoundRuntimeScale':.55,'compoundSourceToWorldScale':.275,'placements':locations,'note':'QA uses coordinator supplied runtime placement transform and accepted closed compound; no placement marks or bases baked into terrain.'})
entry=json.loads((R/'entry.json').read_text());entry.update(revision=2,status='pending-coordinator-integration-review',file='exports/terrain-region-r2.png',sourceId='exec-937b5774-80a6-425f-8f51-4a7f6caee8f2',sha256=sha(e),geometry='geometry-r2.json',qa=['qa/QA-r2.md','qa/independent-bases-proof-r2.png','qa/placement-registration-r2.png','qa/scene-1568-r2.png']);entry.pop('clearingCenters',None);entry['limits']=['Natural clearings determine runtime placements; original specified clearing centers superseded.','Not a seamless repeating tile; static scenery only.','Integrated M1 remains pending.'];write('entry-r2.json',entry)
write('provenance-r2.json',{'assetId':'mf.terrain.region','revision':2,'generator':'Built-in ImageGen original attempt1, deterministic export only for r2','sourceId':entry['sourceId'],'sourceFile':str(p.relative_to(R)),'sourceSha256':sha(p),'originalGenerationProvenance':'provenance.json','promptFile':'source/generation-prompt.txt','transforms':['Single full-frame Lanczos resize to2048x1280 RGB','QA-only accepted base overlays using revised runtime positions'],'creativeGenerationForThisRevision':False,'reason':'Coordinator rejected high contrast texture after generative corrections; restore original natural terrain and adapt runtime positions.','exportSha256':sha(e),'exportBytes':e.stat().st_size})
(R/'qa/QA-r2.md').write_text('''# Terrain r2 QA

Restores original cleaner source with a single deterministic resize; r1 retained. No new ImageGen call.

Placement proof uses terrain position[760,750], scale2, anchor[512,540], giving world top-left[-264,-330]. Compound scale0.55 gives source-to-world0.275 and footprint center96.8world pixels above front anchor. PC front[280,650], Harness[340,120], MyStrata[1090,560]. See geometry-r2.json and visual proof; these are calibration placements, not terrain collision geometry.

Original source detail is retained; export upsampling adds no detail. Non-seamless static terrain, integrated M1 pending.
''')
write('checksums-r2.json',{str(x.relative_to(R)):sha(x) for x in sorted(R.rglob('*')) if x.is_file() and ('r2' in x.name or x==p) and x.name!='checksums-r2.json'})
print(sha(e))
