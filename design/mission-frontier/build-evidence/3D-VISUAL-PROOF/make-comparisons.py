"""Compose actual captures without retouching. Focus crops are enlarged equally."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

EVIDENCE = Path(__file__).resolve().parent
DESIGN = EVIDENCE.parent.parent
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 24)
SMALL = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 19)


def compose(inputs, filename):
    width = 768
    result = Image.new('RGB', (width * len(inputs), 1170), '#101c23')
    draw = ImageDraw.Draw(result)
    for index, (label, source, crop, caption) in enumerate(inputs):
        original = Image.open(source).convert('RGB')
        whole = original.copy()
        whole.thumbnail((width, 510))
        x = index * width
        draw.text((x + 18, 18), label, font=FONT, fill='#f2f0e6')
        result.paste(whole, (x + (width - whole.width) // 2, 58))
        focus = original.crop(crop)
        scale = min((width - 24) / focus.width, 500 / focus.height)
        focus = focus.resize((round(focus.width * scale), round(focus.height * scale)), Image.Resampling.LANCZOS)
        result.paste(focus, (x + (width - focus.width) // 2, 600))
        draw.text((x + 18, 564), 'Closer scene crop · comparable base scale', font=SMALL, fill='#b9cacd')
        draw.text((x + 18, 1124), caption, font=SMALL, fill='#b9cacd')
    result.save(EVIDENCE / filename, quality=94)


compose([
    ('Original study', DESIGN / 'reference/selected-world.png', (265, 335, 860, 732), 'Generated concept · richer finish remains the target'),
    ('Previous coastal implementation', EVIDENCE / 'baseline-world.jpg', (120, 460, 560, 755), 'Actual Pixi browser · sample data'),
    ('New 3D proof', EVIDENCE / 'world-day.jpg', (195, 110, 1040, 675), 'Actual Three.js browser · one PlanCheck scene'),
], 'final-comparison.jpg')
compose([
    ('Original headquarters study', DESIGN / 'screens/project-base-attention-v1.1.png', (245, 103, 1240, 765), 'Generated concept · full headquarters'),
    ('Same-building 3D cutaway', EVIDENCE / 'cutaway-day.jpg', (263, 86, 1200, 704), 'Actual browser · two representative work areas'),
], 'cutaway-comparison.jpg')
