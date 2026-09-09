"""Composite accepted base layers at their registered anchors for DOM thumbnails."""
import json
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[2]
manifest = json.loads((root / 'design/mission-frontier/assets/runtime-asset-manifest.json').read_text())
assets = {asset['id']: asset for asset in manifest['assets']}
canvas = Image.new('RGBA', (1536, 1280))
for layer in ['floor', 'back', 'roof', 'front']:
    asset = assets['mf.base.standard.' + layer]
    image = Image.open(root / 'public/frontier' / asset['file'].lstrip('/')).convert('RGBA')
    x = round(768 - asset['groundAnchor'][0] * 2)
    y = round(1044 - asset['groundAnchor'][1] * 2)
    canvas.alpha_composite(image, (x, y))
canvas = canvas.crop(canvas.getbbox())
canvas.thumbnail((720, 480), Image.Resampling.LANCZOS)
canvas.save(root / 'public/frontier/assets/mf.ui.project-thumbnail.png', optimize=True)
