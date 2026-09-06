from pathlib import Path
from PIL import Image,ImageDraw
import shutil,json,hashlib
R=Path(__file__).resolve().parent
G=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,v):(R/n).write_text(json.dumps(v,indent=2)+'\n')
for source,name in [('exec-af400100-dc8a-4b6d-b98f-a64242baf802.png','terrain-region-master-correction1.png'),('exec-cf838e4f-cdf6-4307-ba34-6e2e35b6a8a4.png','terrain-region-master-r1.png')]:shutil.copy2(G/source,R/'source'/name)
master=Image.open(R/'source/terrain-region-master-r1.png');out=master.convert('RGB').resize((2048,1280),Image.Resampling.LANCZOS);e=R/'exports/terrain-region-r1.png';out.save(e)
centers=[[824,950],[544,590],[1364,750]]
qa=out.copy();d=ImageDraw.Draw(qa)
for x,y in centers:
 d.rectangle((x-225,y-125,x+225,y+125),outline='#ffdd55',width=3)
 d.line((x-15,y,x+15,y),fill='white',width=3);d.line((x,y-15,x,y+15),fill='white',width=3)
qa.save(R/'qa/clearing-registration-r1.png')
preview=Image.new('RGB',(1568,1003),'#071923');preview.paste(out.resize((1568,980),Image.Resampling.LANCZOS),(0,11));preview.save(R/'qa/scene-1568x1003-r1.png')
# QA only: independent accepted roof/base composite, footprint440x220 source.
base=Image.open(R.parent/'mf.base.standard.roof/qa/closed-compound-r1.png').convert('RGBA')
scale=440/1408;base=base.resize((round(base.width*scale),round(base.height*scale)),Image.Resampling.LANCZOS)
compound=out.convert('RGBA')
for x,y in centers:compound.alpha_composite(base,(round(x-768*scale),round(y-692*scale)))
compound.convert('RGB').save(R/'qa/independent-bases-proof-r1.png')
geometry={'masterDimensions':list(master.size),'exportDimensions':[2048,1280],'logicalDimensions':[1024,640],'groundAnchorLogical':[512,540],'clearingCentersSourcePixels':centers,'clearingExtentSourcePixels':[450,250],'clearingAssessment':'Visual land/support assessment, not semantic segmentation or terrain collision geometry. Natural boundaries approximate.','qaBaseFootprintSourcePixels':[440,220],'qaBaseCompositeScale':scale,'resampling':'Single full-frame Lanczos resize; no crop or painted terrain substitute.'};write('geometry.json',geometry)
entry={'id':'mf.terrain.region','revision':1,'status':'pending-coordinator-integration-review','file':str(e.relative_to(R)),'sourceSize':[2048,1280],'logicalSize':[1024,640],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':[512,540],'footprint':[[0,0],[1024,0],[1024,640],[0,640]],'layer':'terrain','occlusionClass':'background','sockets':{},'clearingCenters':[[x/2,y/2] for x,y in centers],'sourceId':'exec-cf838e4f-cdf6-4307-ba34-6e2e35b6a8a4','sha256':sha(e),'alpha':'opaque RGB terrain','geometry':'geometry.json','qa':['qa/QA.md','qa/clearing-registration-r1.png','qa/scene-1568x1003-r1.png','qa/independent-bases-proof-r1.png'],'limits':['Not a seamless repeating tile. Neighbor regions require authored continuation.','Water, trees and bridge are static scenery; no independent animation or foreground occluder layers.','Clearing support is visual; integrated M1 remains unverified.']};write('entry.json',entry)
ref=Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/reference/selected-world.png')
write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','references':[{'path':str(ref),'sha256':sha(ref),'role':'Initial primary landscape source'},{'path':'source/clearing-placement-guidance.png','sha256':sha(R/'source/clearing-placement-guidance.png'),'role':'Correction1 input; QA-only orange guide overlay on initial generation'},{'path':'source/terrain-region-master-correction1.png','sha256':sha(R/'source/terrain-region-master-correction1.png'),'role':'Correction2 input'}],'generationIds':['exec-937b5774-80a6-425f-8f51-4a7f6caee8f2','exec-af400100-dc8a-4b6d-b98f-a64242baf802','exec-cf838e4f-cdf6-4307-ba34-6e2e35b6a8a4'],'prompts':{p.name:p.read_text() for p in sorted((R/'source').glob('*prompt.txt'))},'correctiveGenerations':2,'transforms':['Preserve all source attempts','QA guide overlay after resize for creative correction only','Final full-frame Lanczos resize to2048x1280 opaqueRGB','QA-only independent base compositions; not included in export'],'sourceSha256':sha(R/'source/terrain-region-master-r1.png'),'exportSha256':sha(e),'exportBytes':e.stat().st_size,'decodedRgbBytes':2048*1280*3,'rightsNote':'Supplied/generated project references; no external licensed assets added. Provenance is not legal clearance.'})
(R/'qa/QA.md').write_text('''# Terrain region A0 r1

Pending coordinator review and integrated M1. Opaque2048×1280RGB export, logical1024×640, anchor[512,540].

Two ImageGen corrections moved obstructing water/cliffs away from prescribed clearings; all original attempts retained. Final terrain remains static and free of bases/workers/UI. Guide marks exist only in QA.

Inspect clearing-registration at requested centers[824,950],[544,590],[1364,750] with450×250source rectangles. Independent-bases-proof places accepted compound imagery at440×220source floor footprint for calibration only. This composition is not baked into export.

The source is smaller than requested output and is resampled once, with actual dimensions in geometry.json. Repeated generative editing increased some grass/rock texture contrast; assess at actual scene scale rather than assuming source-detail fidelity. No seamless edge matching, 3D collision map, terrain animation or foreground tree separation is supplied.
''')
write('checksums.json',{str(p.relative_to(R)):sha(p) for p in sorted(R.rglob('*')) if p.is_file() and p.name!='checksums.json'})
print(json.dumps({'export':str(e),'sha256':sha(e),'bytes':e.stat().st_size,'master':master.size}))
