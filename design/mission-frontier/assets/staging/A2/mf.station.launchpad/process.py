from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;A0=R.parents[1]/'A0'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,o):(R/n).write_text(json.dumps(o,indent=2)+'\n')
gen=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-6ced0bca-2bf4-427a-8422-03dd2182252b.png');shutil.copy2(gen,R/'source/launchpad-master-r1.png');m=Image.open(gen).convert('RGB');a=np.array(m).astype(float);ex=a[:,:,1]-np.maximum(a[:,:,0],a[:,:,2]);alpha=1-np.clip((ex-20)/130,0,1);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2])+10),a[:,:,1]);ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/launchpad-alpha-master-r1.png');box=cut.getbbox();s=500/(box[2]-box[0]);size=(500,round((box[3]-box[1])*s));offset=(134,660-size[1]);out=Image.new('RGBA',(768,768));out.alpha_composite(cut.crop(box).resize(size,Image.Resampling.LANCZOS),offset);ar=np.array(out);ex=ar[:,:,1].astype(float)-np.maximum(ar[:,:,0],ar[:,:,2]);ar[:,:,1]=np.where(ex>20,np.minimum(ar[:,:,1],np.maximum(ar[:,:,0],ar[:,:,2]).astype(int)+10),ar[:,:,1]);ar[ar[:,:,3]==0,:3]=0;out=Image.fromarray(ar);e=R/'exports/station-launchpad-r1.png';out.save(e)
def p(v):return [round(offset[0]+(v[0]-box[0])*s,4),round(offset[1]+(v[1]-box[1])*s,4)]
pts={k:p(v) for k,v in {'frontFoot':[561,790],'leftFoot':[149,549],'rightFoot':[1387,534],'frontSurface':[561,702],'frontToolPort':[278,544],'screenCenter':[318,505],'shuttleDock':[803,468]}.items()};anchor=[v/2 for v in pts['frontFoot']];fp=[pts['leftFoot'],p([1038,259]),pts['rightFoot'],pts['frontFoot']];height=(pts['frontFoot'][1]-pts['frontSurface'][1])/2
write('geometry.json',{'masterSize':list(m.size),'masterAlphaBounds':box,'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'exportAlphaBounds':out.getbbox(),'landmarksSourcePixels':pts,'groundAnchorSourcePixels':pts['frontFoot'],'approxSupportFootprintSourcePixels':fp,'footprintNote':'Visible left/right/front feet manually measured; rear support ground projection estimated beneath visible rear rim.','benchHeightLogical':height,'measurementToleranceMasterPixels':6})
def bg(im,color):
 b=Image.new('RGBA',im.size,color);b.alpha_composite(im);return b.convert('RGB')
sheet=Image.new('RGB',(2304,796),'#16222c');dr=ImageDraw.Draw(sheet)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):sheet.paste(bg(out,c),(i*768,28));dr.text((i*768+10,8),['Dark','Light','Magenta'][i],fill='white')
sheet.save(R/'qa/alpha-backgrounds-r1.png')
reg=bg(out,'#071923');dr=ImageDraw.Draw(reg)
for k,(x,y) in pts.items():dr.ellipse((x-3,y-3,x+3,y+3),fill='#ffcc55');dr.text((min(x+6,395),y),k,fill='white')
reg.save(R/'qa/socket-registration-r1.png')
fabric=Image.open(A0/'mf.station.fabrication/exports/station-fabrication-r1.png').convert('RGBA');workerHQ=Image.open(A0/'mf.worker.standard.se.neutral/exports/worker-standard-se-neutral-r1.png').convert('RGBA');workerDetail=Image.open(A0/'mf.worker.standard.detail.neutral/exports/worker-standard-detail-neutral-r1.png').convert('RGBA')
communications=Image.open(R.parents[1]/'A1/mf.station.communications/exports/station-communications-r1.png').convert('RGBA')
qa=Image.new('RGBA',(2600,1500),'#071923');dr=ImageDraw.Draw(qa)
for row,factor,wh,y0 in [(0,1.275,74,30),(1,2.52,200,410)]:
 for col,station in enumerate([fabric,communications,out]):
  sz=round((384 if col==2 else 256)*factor);baseY=y0+round(256*factor*.85); anchorY=327.8027 if col==2 else (214.5 if col==0 else 212.8818); pos=(col*750+120,round(baseY-anchorY*factor));qa.alpha_composite(station.resize((sz,sz),Image.Resampling.LANCZOS),pos)
  w=workerHQ if row==0 else workerDetail;w=w.crop(w.getbbox());w=w.resize((round(w.width*wh/w.height),wh),Image.Resampling.LANCZOS);qa.alpha_composite(w,(col*750+75,baseY-wh))
  dr=ImageDraw.Draw(qa);dr.text((col*750+35,y0+5),['Fabrication','Communications','Launchpad'][col]+(' /HQ1.275x, worker74px' if row==0 else ' /detail2.52x, worker200px'),fill='white')
qa.convert('RGB').save(R/'qa/calibrated-scale-comparison-r1.png')
entry={'id':'mf.station.launchpad','revision':1,'status':'pending-coordinator-A2-review','file':str(e.relative_to(R)),'sourceSize':[768,768],'logicalSize':[384,384],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':anchor,'footprint':[[v/2 for v in q] for q in fp],'footprintUse':'Approximate support footprint; rear ground point is estimated beneath visible rim.','layer':'station','occlusionClass':'solid-station','sockets':{k:[v/2 for v in pts[k]] for k in ['frontToolPort','screenCenter','shuttleDock']},'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','dockClearancePolygon':[[v/2 for v in p(q)] for q in [[550,450],[950,310],[1190,440],[750,590]]],'qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/socket-registration-r1.png','qa/calibrated-scale-comparison-r1.png'],'limits':['Passive empty docking pad; no shuttle or delivery state. Rear ground footprint is estimated beneath the visible rear rim.','No workers, floor, state labels or animated parts baked in.','A2 integrated scene review pending.']};write('entry.json',entry)
refs=[Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/screens/project-base-attention-v1.1.png'),A0/'mf.station.fabrication/exports/station-fabrication-r1.png',R.parents[1]/'A1/mf.station.communications/exports/station-communications-r1.png'];write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-6ced0bca-2bf4-427a-8422-03dd2182252b','sourceSha256':sha(R/'source/launchpad-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(v),'sha256':sha(v)} for v in refs],'correctiveGenerations':0,'transforms':['Green key and spill cleanup','Crop subject and uniformly fit500source pixels wide','Lanczos resize and register bottom at660source on768canvas','QA-only comparison at requested consumer factors'],'exportSha256':sha(e),'exportBytes':e.stat().st_size,'rightsNote':'Supplied/generated project references only; provenance is not legal clearance.'})
write('qa/measurements-r1.json',{'mode':out.mode,'size':out.size,'alphaRange':out.getchannel('A').getextrema(),'borderNontransparent':int((ar[[0,-1],:,3]>0).sum()+(ar[:,[0,-1],3]>0).sum()),'benchHeightLogical':height,'approxFootprintWidthLogical':(pts['rightFoot'][0]-pts['leftFoot'][0])/2,'approxFootprintDepthLogical':(pts['frontFoot'][1]-fp[1][1])/2})
(R/'qa/QA.md').write_text('''# Launchpad station A2 r1

Cantilevered passive inspection hood above a sealed neutral case distinguishes delivery inspection. The case is illustrative equipment, not evidence of an artifact or approval. Ceramic/slate materials and warm light match fabrication. No worker/floor/wall/task text or status symbols; glass is reflective with no semantic illumination. Source generated on flat green in one attempt.

768×768RGBA, logical384×384. Visible feet and front connector/screen centers manually measured, rear ground footprint estimated beneath visible rim. FrontToolPort is an actual visible circular connector for independent active probe contact. See measurements for actual desk height and footprint rather than assuming prompted dimensions.

QA compares approved fabrication, communications and independent worker at HQ0.85×1.5=1.275 and detail2.1×1.2=2.52. Worker shown74px/200px. Alpha inspected on dark/light/magenta. Main renderer owns contact, live state, selection and attention. Pending coordinator A2 integration review.
''')
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'})
print(json.dumps({'anchor':anchor,'sockets':entry['sockets'],'benchHeight':height,'sha256':sha(e)}))
