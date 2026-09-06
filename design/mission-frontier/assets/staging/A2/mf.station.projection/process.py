from pathlib import Path
from PIL import Image,ImageDraw
import numpy as np,json,hashlib,shutil
R=Path(__file__).resolve().parent;A0=R.parents[1]/'A0'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(n,o):(R/n).write_text(json.dumps(o,indent=2)+'\n')
gen=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-e11312ab-fad3-4794-aa36-2420f730a467.png');shutil.copy2(gen,R/'source/projection-master-r1.png');m=Image.open(gen).convert('RGB');a=np.array(m).astype(float);ex=a[:,:,1]-np.maximum(a[:,:,0],a[:,:,2]);alpha=1-np.clip((ex-20)/130,0,1);a[:,:,1]=np.where(ex>20,np.minimum(a[:,:,1],np.maximum(a[:,:,0],a[:,:,2])+10),a[:,:,1]);ar=np.dstack((a,alpha*255)).clip(0,255).astype('uint8');ar[ar[:,:,3]==0,:3]=0;cut=Image.fromarray(ar);cut.save(R/'source/projection-alpha-master-r1.png');box=cut.getbbox();s=320/(box[2]-box[0]);size=(320,round((box[3]-box[1])*s));offset=(96,430-size[1]);out=Image.new('RGBA',(512,512));out.alpha_composite(cut.crop(box).resize(size,Image.Resampling.LANCZOS),offset);ar=np.array(out);ex=ar[:,:,1].astype(float)-np.maximum(ar[:,:,0],ar[:,:,2]);ar[:,:,1]=np.where(ex>20,np.minimum(ar[:,:,1],np.maximum(ar[:,:,0],ar[:,:,2]).astype(int)+10),ar[:,:,1]);ar[ar[:,:,3]==0,:3]=0;out=Image.fromarray(ar);e=R/'exports/station-projection-r1.png';out.save(e)
def p(v):return [round(offset[0]+(v[0]-box[0])*s,4),round(offset[1]+(v[1]-box[1])*s,4)]
pts={k:p(v) for k,v in {'frontFoot':[853,918],'leftFoot':[371,722],'rightFoot':[1164,741],'frontSurface':[853,702],'frontToolPort':[442,660],'screenCenter':[831,316],'projectorLens':[685,468]}.items()};anchor=[v/2 for v in pts['frontFoot']];fp=[pts['leftFoot'],p([590,475]),pts['rightFoot'],pts['frontFoot']];height=(pts['frontFoot'][1]-pts['frontSurface'][1])/2
write('geometry.json',{'masterSize':list(m.size),'masterAlphaBounds':box,'uniformScale':s,'scaledSize':size,'pasteOffset':offset,'exportAlphaBounds':out.getbbox(),'landmarksSourcePixels':pts,'groundAnchorSourcePixels':pts['frontFoot'],'approxSupportFootprintSourcePixels':fp,'footprintNote':'Visible left/right/front feet manually measured; occluded rear support point estimated for layout, not recovered3D.','benchHeightLogical':height,'measurementToleranceMasterPixels':6})
def bg(im,color):
 b=Image.new('RGBA',im.size,color);b.alpha_composite(im);return b.convert('RGB')
sheet=Image.new('RGB',(1536,540),'#16222c');dr=ImageDraw.Draw(sheet)
for i,c in enumerate(['#071923','#f0f3f5','#d000cc']):sheet.paste(bg(out,c),(i*512,28));dr.text((i*512+10,8),['Dark','Light','Magenta'][i],fill='white')
sheet.save(R/'qa/alpha-backgrounds-r1.png')
reg=bg(out,'#071923');dr=ImageDraw.Draw(reg)
for k,(x,y) in pts.items():dr.ellipse((x-3,y-3,x+3,y+3),fill='#ffcc55');dr.text((min(x+6,395),y),k,fill='white')
reg.save(R/'qa/socket-registration-r1.png')
fabric=Image.open(A0/'mf.station.fabrication/exports/station-fabrication-r1.png').convert('RGBA');workerHQ=Image.open(A0/'mf.worker.standard.se.neutral/exports/worker-standard-se-neutral-r1.png').convert('RGBA');workerDetail=Image.open(A0/'mf.worker.standard.detail.neutral/exports/worker-standard-detail-neutral-r1.png').convert('RGBA')
communications=Image.open(R.parents[1]/'A1/mf.station.communications/exports/station-communications-r1.png').convert('RGBA')
qa=Image.new('RGBA',(2250,1040),'#071923');dr=ImageDraw.Draw(qa)
for row,factor,wh,y0 in [(0,1.275,74,30),(1,2.52,200,410)]:
 for col,station in enumerate([fabric,communications,out]):
  sz=round(256*factor);pos=(col*750+120,y0);qa.alpha_composite(station.resize((sz,sz),Image.Resampling.LANCZOS),pos)
  w=workerHQ if row==0 else workerDetail;w=w.crop(w.getbbox());w=w.resize((round(w.width*wh/w.height),wh),Image.Resampling.LANCZOS);qa.alpha_composite(w,(col*750+75,y0+round(sz*.8)-wh))
  dr=ImageDraw.Draw(qa);dr.text((col*750+35,y0+5),['Fabrication','Communications','Projection'][col]+(' /HQ1.275x, worker74px' if row==0 else ' /detail2.52x, worker200px'),fill='white')
qa.convert('RGB').save(R/'qa/calibrated-scale-comparison-r1.png')
entry={'id':'mf.station.projection','revision':1,'status':'pending-coordinator-A2-review','file':str(e.relative_to(R)),'sourceSize':[512,512],'logicalSize':[256,256],'coordinateUnits':'logical-pixels-untrimmed','groundAnchor':anchor,'footprint':[[v/2 for v in q] for q in fp],'footprintUse':'Approximate support footprint; rear point is occluded estimate.','layer':'station','occlusionClass':'solid-station','sockets':{k:[v/2 for v in pts[k]] for k in ['frontToolPort','screenCenter','projectorLens']},'sha256':sha(e),'alpha':'straight RGBA','geometry':'geometry.json','qa':['qa/QA.md','qa/alpha-backgrounds-r1.png','qa/socket-registration-r1.png','qa/calibrated-scale-comparison-r1.png'],'limits':['Static blank screen and unlit projector; no active hologram, beams, status lighting or articulated part.','No workers, floor, state labels or animated parts baked in.','A2 integrated scene review pending.']};write('entry.json',entry)
refs=[R.parent/'mf.station.intake/exports/station-intake-r1.png',Path('/Users/shaun/.codex/worktrees/7237/agent-harness-ui/design/mission-frontier/screens/project-base-attention-v1.1.png'),A0/'mf.station.fabrication/exports/station-fabrication-r1.png',R.parents[1]/'A1/mf.station.communications/exports/station-communications-r1.png'];write('provenance.json',{'assetId':entry['id'],'revision':1,'generator':'Built-in ImageGen','sourceId':'exec-e11312ab-fad3-4794-aa36-2420f730a467','sourceSha256':sha(R/'source/projection-master-r1.png'),'prompt':(R/'source/generation-prompt.txt').read_text(),'references':[{'path':str(v),'sha256':sha(v)} for v in refs],'correctiveGenerations':0,'transforms':['Green key and spill cleanup','Crop subject and uniformly fit320source pixels wide','Lanczos resize and register bottom at430source on512canvas','QA-only comparison at requested consumer factors'],'exportSha256':sha(e),'exportBytes':e.stat().st_size,'rightsNote':'Supplied/generated project references only; provenance is not legal clearance.'})
write('qa/measurements-r1.json',{'mode':out.mode,'size':out.size,'alphaRange':out.getchannel('A').getextrema(),'borderNontransparent':int((ar[[0,-1],:,3]>0).sum()+(ar[:,[0,-1],3]>0).sum()),'benchHeightLogical':height,'approxFootprintWidthLogical':(pts['rightFoot'][0]-pts['leftFoot'][0])/2,'approxFootprintDepthLogical':(pts['frontFoot'][1]-fp[1][1])/2})
(R/'qa/QA.md').write_text('''# Projection station A2 r1

Distinct large blank projection screen and compact optical projector on a mechanical tabletop mount. Ceramic/slate materials and warm light match fabrication. No worker/floor/wall/task text or status symbols; glass is reflective with no semantic illumination. Source generated on flat green in one attempt.

512×512RGBA, logical256×256. Visible feet and front connector/screen centers manually measured, rear footprint estimated. FrontToolPort is an actual visible circular connector for independent active probe contact. See measurements for actual desk height and footprint rather than assuming prompted dimensions.

QA compares approved fabrication, communications and independent worker at HQ0.85×1.5=1.275 and detail2.1×1.2=2.52. Worker shown74px/200px. Alpha inspected on dark/light/magenta. Main renderer owns contact, live state, selection and attention. Pending coordinator A2 integration review.
''')
write('checksums.json',{str(q.relative_to(R)):sha(q) for q in sorted(R.rglob('*')) if q.is_file() and q.name!='checksums.json'})
print(json.dumps({'anchor':anchor,'sockets':entry['sockets'],'benchHeight':height,'sha256':sha(e)}))
