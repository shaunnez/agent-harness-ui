from pathlib import Path
import json,hashlib
R=Path(__file__).resolve().parent
root=R.parents[5]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,o):(R/n).write_text(json.dumps(o,indent=2)+'\n')
g=json.loads((R/'geometry.json').read_text()); e=R/'exports/station-fabrication-r1.png'
half=lambda p:[round(v/2,4) for v in p]
sockets={k:half(g['visibleLandmarksSourcePixels'][k]) for k in ['moduleCradle','frontToolPort','screenCenter']}
entry={'id':'mf.station.fabrication','revision':1,'status':'pending-coordinator-integration-review','file':str(e.relative_to(R)),'sourceSize':[512,512],'logicalSize':[256,256],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':half(g['groundAnchorSourcePixels']),'footprint':[half(p) for p in g['approxSupportFootprintSourcePixels']],'footprintUse':'Approximate support polygon; rear point is occluded and estimated. Visible support span146x80 logical.','labelAnchor':[128,60],'layer':'station','occlusionClass':'solid-station','sockets':sockets,'socketUse':'Fixed visible feature centers; independent worker/tools are renderer-owned. No rig or detachable parts supplied.','sourceId':'exec-cfd035fe-140f-4cd4-a3cd-3463319c22af','sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/worker-comparison-r1.png','qa/station-logical-scale-r1.png','qa/sockets-registration-r1.png','qa/measurements-r1.json'],'limits':['Single static powered workbench; cyan screen is not execution status.','Bench surface measured about38logical pixels above front foot. Full sprite silhouette146.5logical high includes isometric depth; tallest feature physical height cannot be directly verified from flattened raster.','Integrated M1 and station-worker action pose remain unverified.']}
write('entry.json',entry)
ref=Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/screens/project-base-attention-v1.1.png')
write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','classification':'Original generated fabrication station using supplied project HQ reference','sourceId':entry['sourceId'],'generationPath':'/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-cfd035fe-140f-4cd4-a3cd-3463319c22af.png','sourceFile':'source/station-fabrication-master-r1.png','sourceSha256':sha(R/'source/station-fabrication-master-r1.png'),'masterDimensions':g['masterCanvas'],'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(ref),'sha256':sha(ref),'role':'Primary HQ machinery/material source'}],'correctiveGenerations':0,'transforms':[{'script':'process.py','operations':['Preserve original source','Deterministic green key and spill cleanup','Crop alpha bounds, uniform scale to320source pixels wide, Lanczos resample','Paste on512x512 untrimmed export at96,137','Post-resample edge cleanup','QA composites with separate approved worker at58px visible height']}],'exportSha256':sha(e),'exportBytes':e.stat().st_size,'decodedRgbaBytes':1048576,'rightsNote':'Supplied/generated project reference only; no external brand or artist imitation requested. Provenance is not legal clearance.'})
(R/'qa/QA.md').write_text('''# Fabrication station A0 r1 QA

Pending coordinator integration review and integrated M1.

- Export: 512×512 straight RGBA, logical256×256, visible bounds[96,137,416,430]. Zero occupied border pixels, zero green-dominant visible pixels by recorded threshold; transparent hidden RGB cleaned.
- Inspected dark/light/magenta alpha sheet and actual logical-scale station beside independently composited58px worker. White ceramic chassis, cyan screen, exposed machine module and front tool socket remain recognizable. Screen uses abstract marks, no readable text.
- Ground anchor is the measured front foot: source[262.7692,429], logical[131.3846,214.5]. Visible side/front support landmarks imply about146×80logical ground span. Rear support point is an estimate, not measured 3D geometry.
- Bench surface stands approximately38logical pixels above its visible front foot. Total silhouette146.5logical includes footprint depth; the requested70–100logical physical tallest-feature range is not independently measurable from this flattened source. Integration must assess proportion visually.
- Socket coordinates identify fixed visible feature centers. No worker, separate tool, animation, live status or ground shadow is baked into the export. Worker action/contact proof is a later assigned asset/integration step.
- No corrective generation. Original master, alpha master, generation prompt, deterministic processing script and measured geometry retained.
''')
write('checksums.json',{str(p.relative_to(R)):sha(p) for p in sorted(R.rglob('*')) if p.is_file() and p.name!='checksums.json'})
print(json.dumps({'export':str(e),'sha256':sha(e),'entry':str(R/'entry.json')}))
