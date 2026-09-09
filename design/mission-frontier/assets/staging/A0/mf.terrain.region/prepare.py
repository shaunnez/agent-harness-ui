from pathlib import Path
from PIL import Image,ImageDraw
import shutil
R=Path(__file__).resolve().parent
p=Path('/Users/shaun/.codex/generated_images/01a0749d-4c28-78f1-ba94-00501ef2ade3/exec-937b5774-80a6-425f-8f51-4a7f6caee8f2.png')
shutil.copy2(p,R/'source/terrain-region-master-attempt1.png')
im=Image.open(p).convert('RGB').resize((2048,1280),Image.Resampling.LANCZOS)
im.save(R/'source/terrain-region-attempt1-resized.png')
d=ImageDraw.Draw(im)
for x,y in [(824,950),(544,590),(1364,750)]:
 d.rectangle((x-235,y-135,x+235,y+135),outline='#ff8200',width=10)
 d.ellipse((x-8,y-8,x+8,y+8),fill='#ff8200')
im.save(R/'source/clearing-placement-guidance.png')
