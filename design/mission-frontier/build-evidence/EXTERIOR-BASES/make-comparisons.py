from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
root=Path(__file__).resolve().parents[4]
out=Path(__file__).parent
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',22)
def board(cells, cols, cell=(800,590), filename='comparison.jpg'):
 w,h=cell
 canvas=Image.new('RGB',(cols*w,((len(cells)+cols-1)//cols)*h),'#101a20');d=ImageDraw.Draw(canvas)
 for i,(title,path,crop) in enumerate(cells):
  im=Image.open(path).convert('RGB');im=im.crop(crop) if crop else im
  fitted=ImageOps.contain(im,(w-24,h-64));x=(i%cols)*w;y=(i//cols)*h
  d.text((x+12,y+12),title,font=font,fill='#e6ecee')
  canvas.paste(fitted,(x+(w-fitted.width)//2,y+48+(h-60-fitted.height)//2))
 canvas.save(out/filename,quality=91)
board([
 ('Original world study — generated concept',root/'design/mission-frontier/reference/selected-world.png',None),
 ('Three project bases — actual browser, sample data',out/'world-day.png',None),
],2,(800,564),'comparison-world.jpg')
board([
 ('Annotated exterior reference',root/'design/mission-frontier/reference/exterior-base-details-annotated.jpg',(0,160,1185,1100)),
 ('Earlier accepted 3D proof',root/'design/mission-frontier/build-evidence/3D-VISUAL-PROOF/world-day.jpg',(190,115,1130,735)),
 ('Command — larger crew/cargo, coloured roof',out/'command-day.png',(200,110,1000,605)),
 ('Command — warm windows and instrument lights',out/'command-night.png',(200,110,1000,605)),
],2,(800,655),'comparison-details.jpg')
board([(f'{name.title()} — actual browser exterior',out/f'{name}-day.png',(195,45,1010,608)) for name in ['command','relay','foundry']],3,(620,485),'base-lineup.jpg')
for name in ['world-day','command-day','command-dusk','command-night','command-cutaway','picker-laptop']:
 Image.open(out/f'{name}.png').convert('RGB').save(out/f'{name}.jpg',quality=90)
print('Comparisons and journal copies written')
