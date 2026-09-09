"""Registered additive window-light pass from the accepted authored observatory."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
source = Path(args.source)
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source))
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.threads_mode = "FIXED"
scene.render.threads = 4
scene.world.use_nodes = True
scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value = 0
for obj in bpy.data.objects:
    if obj.type == "LIGHT":
        obj.hide_render = True
matched = []
for material in bpy.data.materials:
    label = material.name.lower()
    color = (0, 0, 0, 1)
    if "blue glass" in label:
        color = (0.65, 0.32, 0.08, 1)
        matched.append(material.name)
    elif "amber" in label:
        color = (1, 0.57, 0.16, 1)
        matched.append(material.name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    shader = nodes.new("ShaderNodeEmission")
    shader.inputs["Color"].default_value = color
    shader.inputs["Strength"].default_value = 1
    result = nodes.new("ShaderNodeOutputMaterial")
    material.node_tree.links.new(shader.outputs[0], result.inputs["Surface"])
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = str(output / "observatory-lights.png")
bpy.ops.render.render(write_still=True)
record = {
    "source": str(source.name),
    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "blender": bpy.app.version_string,
    "materials": matched,
    "sourceSize": [scene.render.resolution_x, scene.render.resolution_y],
    "logicalSize": [768, 640],
    "groundAnchor": [384, 522],
    "blendMode": "add",
    "description": "Identical camera and occluding geometry; non-light surfaces are additive black.",
    "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
}
(output / "metadata.json").write_text(json.dumps(record, indent=2) + "\n")
