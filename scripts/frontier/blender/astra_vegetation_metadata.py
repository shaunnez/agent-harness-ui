"""Refresh vegetation r2 handoff metadata without rendering or changing artwork."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
PACKAGE = ROOT / 'design/mission-frontier/assets/staging/cinematic-v1/astra/vegetation-production'


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    entry_path = PACKAGE / 'entry-r2.json'
    entry = json.loads(entry_path.read_text())
    image_path = PACKAGE / 'renders/spreading-grove-r2.png'
    blend_path = PACKAGE / 'blend/spreading-grove-r2.blend'
    before = {str(p.relative_to(PACKAGE)): sha256(p) for p in (image_path, blend_path)}
    with Image.open(image_path) as image:
        if image.mode != 'RGBA' or image.size != (768, 768):
            raise ValueError('Expected the approved 768x768 RGBA vegetation export')
        bounds = list(image.getchannel('A').getbbox())
        pixels = np.asarray(image, dtype=np.float64)
    if entry['sourceSize'] != [768, 768] or entry['logicalSize'] != [384, 384]:
        raise ValueError('Vegetation size metadata differs from the approved contract')
    if entry['groundAnchor'] != [192, 340] or entry['samples'] != 64:
        raise ValueError('Vegetation anchor or render quality differs from the approved contract')
    if bounds != [110, 266, 689, 746]:
        raise ValueError(f'Alpha bounds differ from the approved final geometry: {bounds}')
    rgb = pixels[:, :, :3]
    purple = ((pixels[:, :, 3] > 240)
              & (rgb[:, :, 0] > rgb[:, :, 1] * 1.15)
              & (rgb[:, :, 2] > rgb[:, :, 1] * 1.15))
    if not purple.any():
        raise ValueError('No opaque purple foliage pixels were found')
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722])
    measured = np.quantile(luma[purple], [0.1, 0.5, 0.9]).tolist()
    entry.update({
        'file': 'renders/spreading-grove-r2.png',
        'alphaBoundsSource': bounds,
        'sha256': before['renders/spreading-grove-r2.png'],
        'measuredPurpleLumaP10P50P90': measured,
    })
    # Keep prior acquisition, camera, material, shadow and acceptance provenance intact.
    entry_path.write_text(json.dumps(entry, indent=2) + '\n')
    checksums_path = PACKAGE / 'checksums.json'
    checksums = json.loads(checksums_path.read_text()) if checksums_path.exists() else {}
    for relative_path in list(checksums):
        path = PACKAGE / relative_path
        if not path.is_file():
            raise FileNotFoundError(f'Retained checksum artifact is missing: {path}')
        checksums[relative_path] = sha256(path)
    for path in (image_path, blend_path, entry_path):
        checksums[str(path.relative_to(PACKAGE))] = sha256(path)
    checksums_path.write_text(json.dumps(checksums, indent=2) + '\n')
    after = {str(p.relative_to(PACKAGE)): sha256(p) for p in (image_path, blend_path)}
    if before != after:
        raise RuntimeError('Artwork changed during metadata refresh')
    print(json.dumps({'artworkUnchanged': True, 'alphaBoundsSource': bounds,
                      'groundAnchor': entry['groundAnchor'],
                      'measuredPurpleLumaP10P50P90': measured,
                      'sha256': entry['sha256']}, indent=2))


if __name__ == '__main__':
    main()
