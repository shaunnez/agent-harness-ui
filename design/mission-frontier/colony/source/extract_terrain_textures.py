#!/usr/bin/env python3
"""Extract the Poly Haven CC0 terrain textures embedded in the accepted Astra environment GLB.

Run from the repository root:
  python3 design/mission-frontier/colony/source/extract_terrain_textures.py
Writes design/mission-frontier/assets/staging/colony-v2/terrain-textures/*.jpg plus textures.json
(sha256, bytes, source material). The runtime height field samples these tri-planar; nothing else
in the environment GLB is used. Requires Pillow.
"""
import hashlib, io, json, os, struct
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
GLB = os.path.join(ROOT, "design/mission-frontier/assets/staging/exterior-bases/astra-kit/environment.glb")
OUT = os.path.join(ROOT, "design/mission-frontier/assets/staging/colony-v2/terrain-textures")
# material -> (channel, output stem, max size)
WANTED = [
    ("terrain_gravel_sand", "baseColorTexture", "gravel-albedo", 1024),
    ("terrain_stratified_warm_limestone", "baseColorTexture", "limestone-albedo", 1024),
    ("coastal_cliff_01", "baseColorTexture", "cliff-albedo", 1024),
    ("coastal_cliff_01", "normalTexture", "cliff-normal", 1024),
    ("court_weathered_basalt", "baseColorTexture", "basalt-albedo", 512),
]

raw = open(GLB, "rb").read()
json_len = struct.unpack_from("<I", raw, 12)[0]
gltf = json.loads(raw[20:20 + json_len])
bin_start = 20 + json_len + 8
materials = {m["name"]: m for m in gltf["materials"]}

def image_bytes(material, channel):
    m = materials[material]
    ref = m.get(channel) if channel == "normalTexture" else m.get("pbrMetallicRoughness", {}).get(channel)
    image = gltf["images"][gltf["textures"][ref["index"]]["source"]]
    view = gltf["bufferViews"][image["bufferView"]]
    start = bin_start + view.get("byteOffset", 0)
    return raw[start:start + view["byteLength"]], image.get("name")

os.makedirs(OUT, exist_ok=True)
report = {"source": os.path.relpath(GLB, ROOT), "license": "Poly Haven CC0 (see 3d-visual-proof/astra-scene/sources/polyhaven/provenance.json)", "files": {}}
total = 0
for material, channel, stem, size in WANTED:
    data, name = image_bytes(material, channel)
    im = Image.open(io.BytesIO(data)).convert("RGB")
    if max(im.size) > size:
        im = im.resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, f"{stem}.jpg")
    im.save(path, "JPEG", quality=88 if "normal" not in stem else 92, optimize=True)
    out = open(path, "rb").read()
    total += len(out)
    report["files"][f"{stem}.jpg"] = {"material": material, "channel": channel, "sourceImage": name, "size": im.size, "bytes": len(out), "sha256": hashlib.sha256(out).hexdigest()}
report["totalBytes"] = total
with open(os.path.join(OUT, "textures.json"), "w") as f:
    json.dump(report, f, indent=2); f.write("\n")
print("wrote", len(WANTED), "textures,", total, "bytes")
