"""Rebuild Mission Frontier's layered terrain from authored geometry and CC0 rocks.

Blender --background --threads 4 --python scripts/frontier/blender/environment.py -- --asset island
Sources stay in design staging; integration into the runtime is a separate step.
"""

import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[3]
STAGE = ROOT / "design/mission-frontier/assets/staging/cinematic-v1/environment"
SOURCES = STAGE.parent / "astra/sources/stylized-nature-megakit/glTF"
SEED = 602617
RNG = random.Random(SEED)


def material(name, low, high, scale=3.0, roughness=0.85, metallic=0.0, bump=0.1):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 5
    noise.inputs["Roughness"].default_value = 0.72
    coords = nodes.new("ShaderNodeTexCoord")
    links.new(coords.outputs["Object"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.24
    ramp.color_ramp.elements[0].color = (*low, 1)
    ramp.color_ramp.elements[1].position = 0.77
    ramp.color_ramp.elements[1].color = (*high, 1)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
    grain = nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = scale * 26
    grain.inputs["Detail"].default_value = 3
    links.new(coords.outputs["Object"], grain.inputs["Vector"])
    relief = nodes.new("ShaderNodeBump")
    relief.inputs["Strength"].default_value = 0.45
    relief.inputs["Distance"].default_value = bump
    links.new(grain.outputs["Fac"], relief.inputs["Height"])
    links.new(relief.outputs["Normal"], shader.inputs["Normal"])
    return mat


def solid(name, color, metallic=0.0, roughness=0.5, glow=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    if glow:
        p.inputs["Emission Color"].default_value = (*color, 1)
        p.inputs["Emission Strength"].default_value = glow
    return mat


def mesh(name, vertices, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    return obj


def box(name, at, size, mat, bevel=0.04):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Machined edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
        obj.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return obj


def camera(width, height, ortho, target=(0, 0, -0.4)):
    bpy.ops.object.camera_add(location=Vector(target) + Vector((18, 18, 18 * math.sqrt(2 / 3))))
    cam = bpy.context.object
    cam.name = "Production camera 2-to-1"
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho
    bpy.context.scene.camera = cam
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    return cam


def lighting():
    scene = bpy.context.scene
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.43, 0.54, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.42
    bpy.ops.object.light_add(type="SUN", location=(10, -6, 16))
    sun = bpy.context.object
    sun.name = "Warm upper-left daylight"
    sun.rotation_euler = (Vector((0, 0, 0)) - sun.location).to_track_quat("-Z", "Y").to_euler()
    sun.data.energy = 2.2
    sun.data.angle = math.radians(6)
    sun.data.color = (1, 0.86, 0.7)
    bpy.ops.object.light_add(type="AREA", location=(8, 3, 14))
    fill = bpy.context.object
    fill.rotation_euler = (Vector((0, 0, 0)) - fill.location).to_track_quat("-Z", "Y").to_euler()
    fill.data.energy = 1100
    fill.data.size = 18
    fill.data.color = (0.63, 0.79, 1)


def import_rock(name, mat):
    path = SOURCES / f"{name}.gltf"
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [o for o in bpy.data.objects if o not in before]
    geometry = [o for o in imported if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in geometry:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = geometry[0]
    if len(geometry) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    obj.parent = None
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    minimum = Vector(tuple(min(c[i] for c in corners) for i in range(3)))
    maximum = Vector(tuple(max(c[i] for c in corners) for i in range(3)))
    center = (maximum + minimum) / 2
    for vertex in obj.data.vertices:
        vertex.co -= center
    obj.location = (0, 0, -100)
    largest = max(maximum - minimum)
    for vertex in obj.data.vertices:
        vertex.co /= largest
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for extra in imported:
        if extra != obj and extra.name in bpy.data.objects and extra.type != "MESH":
            bpy.data.objects.remove(extra, do_unlink=True)
    return obj


def boundary(theta):
    variation = 1 + 0.095 * math.sin(theta * 3 + 0.7) + 0.075 * math.cos(theta * 5 - 0.8)
    variation += 0.025 * math.sin(theta * 11 + 1.1)
    return Vector((15 * math.cos(theta) * variation, 11.5 * math.sin(theta) * variation, 0))


def surface_height(p, radius):
    # Continuous heights and dense rings avoid long, flat-shaded radial triangles.
    outer = max(0, (radius - 0.52) / 0.48)
    return outer * (0.12 * math.sin(p.x * 1.25) * math.cos(p.y * 1.4) - 0.07)


def meadow():
    moss = material("Dry meadow blades", (0.09, 0.09, 0.027), (0.36, 0.27, 0.10), 2, bump=0.015)
    vertices, faces = [], []
    for _ in range(1850):
        theta, radius = RNG.uniform(0, math.tau), math.sqrt(RNG.uniform(0.02, 0.98))
        p = boundary(theta) * radius
        density = math.sin(p.x * 0.65) + math.cos(p.y * 0.9) + math.sin((p.x + p.y) * 1.7)
        if density < (0.25 if radius > 0.6 else 1.55):
            continue
        p.z = surface_height(p, radius) + 0.025
        for _ in range(RNG.randrange(12, 24)):
            angle = RNG.uniform(0, math.tau)
            x, y = p.x + RNG.uniform(-0.28, 0.28), p.y + RNG.uniform(-0.28, 0.28)
            width, height = RNG.uniform(0.012, 0.035), RNG.uniform(0.07, 0.23)
            dx, dy = math.cos(angle) * width, math.sin(angle) * width
            start = len(vertices)
            vertices.extend([(x-dx,y-dy,p.z), (x+dx,y+dy,p.z), (x+dx*2,y+dy*2,p.z+height)])
            faces.append((start,start+1,start+2))
    mesh("Low meadow tufts", vertices, faces, moss)


def island():
    earth = material("Warm fractured limestone", (0.28, 0.24, 0.18), (0.59, 0.51, 0.35), 2.2)
    soil = material("Moss and pale soil", (0.25, 0.18, 0.10), (0.55, 0.43, 0.27), 1.4, bump=0.055)
    sand = material("Wet shore", (0.12, 0.16, 0.13), (0.33, 0.36, 0.22), 4.0, roughness=0.6)
    n = 128
    vertices = [(0, 0, 0)]
    rings = 32
    for ring in range(1, rings + 1):
        radius = ring / rings
        for i in range(n):
            p = boundary(i * math.tau / n) * radius
            p.z = surface_height(p, radius)
            vertices.append(tuple(p))
    faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
    for ring in range(rings - 1):
        a, b = 1 + ring * n, 1 + (ring + 1) * n
        faces += [(a + i, b + i, b + (i + 1) % n, a + (i + 1) % n) for i in range(n)]
    surface = mesh("Island surface", vertices, faces, soil)
    for polygon in surface.data.polygons:
        polygon.use_smooth = True
    edge = [boundary(i * math.tau / n) for i in range(n)]
    cliff_vertices = []
    for ring, scale, z in [(0, 1, -0.1), (1, 0.98, -1.5), (2, 1.03, -3.05)]:
        for i, p in enumerate(edge):
            v = p * scale
            v.z = z + math.sin(i * 1.9 + ring) * 0.16
            cliff_vertices.append(tuple(v))
    cliff_faces = []
    for ring in range(2):
        cliff_faces += [(ring*n+i, (ring+1)*n+i, (ring+1)*n+(i+1)%n, ring*n+(i+1)%n) for i in range(n)]
    mesh("Layered cliff core", cliff_vertices, cliff_faces, earth)
    templates = [import_rock(f"Rock_Medium_{i}", earth) for i in (1, 2, 3)]
    for i in range(510):
        theta = (i % 102) * math.tau / 102 + (i // 102) * 0.029
        p = boundary(theta) * (1 + 0.035 * math.sin(theta * 9 + i // 102))
        level = i // 102
        rock = bpy.data.objects.new(f"Cliff outcrop {i:03}", templates[i % 3].data)
        bpy.context.collection.objects.link(rock)
        rock.location = (p.x, p.y, -2.9 + level * 0.63 + RNG.uniform(-0.14, 0.14))
        rock.rotation_euler = (RNG.uniform(-0.10, 0.10), RNG.uniform(-0.15, 0.15), theta + RNG.uniform(-0.5, 0.5))
        rock.scale = (RNG.uniform(1.1, 2.7), RNG.uniform(1.1, 2.4), RNG.uniform(0.5, 1.05))
    for i in range(1700):
        theta = RNG.uniform(0, math.tau)
        radius = math.sqrt(RNG.uniform(0.08, 0.99))
        p = boundary(theta) * radius
        rock = bpy.data.objects.new(f"Surface debris {i:03}", templates[i % 3].data)
        bpy.context.collection.objects.link(rock)
        rock.location = (p.x, p.y, surface_height(p, radius))
        rock.rotation_euler.z = RNG.uniform(0, math.tau)
        size = RNG.uniform(0.05, 0.35) * (1.7 if radius > 0.8 else 0.6)
        rock.scale = (size, size * 0.8, size * RNG.uniform(0.35, 0.85))
    for obj in templates:
        bpy.data.objects.remove(obj, do_unlink=True)
    meadow()
    shore_vertices = []
    for scale in (1.0, 1.12):
        for p in edge:
            shore_vertices.append((p.x * scale, p.y * scale, -3.01))
    mesh("Shallow shore shelf", shore_vertices, [(i,n+i,n+(i+1)%n,(i+1)%n) for i in range(n)], sand)
    camera(2048, 1536, 37, (0, 0, -0.5))
    return ["Rock_Medium_1.gltf", "Rock_Medium_2.gltf", "Rock_Medium_3.gltf"]


def bridge():
    metal = material("Structural slate", (0.055, 0.07, 0.075), (0.14, 0.17, 0.17), 7, 0.55, 0.65, 0.025)
    ceramic = solid("Ceramic guardrail", (0.55, 0.59, 0.55), 0.25, 0.45)
    asphalt = material("Bridge deck", (0.035, 0.055, 0.065), (0.08, 0.10, 0.10), 12, bump=0.02)
    stripe = solid("Safety paint", (0.8, 0.48, 0.12))
    glow = solid("Bridge running light", (0.4, 0.65, 0.7), glow=1.2)
    box("Steel bridge span", (0,0,-0.18), (12,2.8,0.35), metal)
    box("Deck surface", (0,0,0.035), (12,2.45,0.08), asphalt, 0.015)
    for x in (-5.8,-3,-0.2,2.6,5.6):
        for y in (-1.35,1.35):
            box("Railing upright", (x,y,0.35), (0.09,0.10,0.75), metal, 0.015)
            box("Light cap", (x,y,0.75), (0.13,0.15,0.08), glow, 0.02)
    for y in (-1.35,1.35):
        box("Upper rail", (0,y,0.63), (12,0.075,0.07), ceramic, 0.02)
        box("Lower rail", (0,y,0.26), (12,0.075,0.065), metal, 0.012)
    for x in range(-5,6,2):
        box("Lane stripe", (x,0,0.085), (0.7,0.055,0.005), stripe, 0)
    for x in (-5.1,5.1):
        box("Masonry abutment", (x,0,-0.52), (1.35,3.25,0.75), ceramic, 0.10)
        for y in (-1.16,1.16):
            box("Side beam", (0,y,-0.35), (11,0.18,0.45), metal, 0.025)
    camera(1024,768,14,(0,0,0.1))
    return []


def bridge_se():
    used = bridge()
    rotation = Matrix.Rotation(math.pi / 2, 4, "Z")
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.matrix_world = rotation @ obj.matrix_world
    return used


def water():
    mat = solid("Periodic turquoise water", (0.028,0.16,0.21), 0.05, 0.3)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    coords = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords.outputs["Generated"], separate.inputs[0])
    periodic = []
    for axis in ("X","Y"):
        phase = nodes.new("ShaderNodeMath")
        phase.operation = "MULTIPLY"
        # The mesh extends beyond the camera to avoid an antialiased edge at each tile.
        phase.inputs[1].default_value = math.tau * 28 / 26
        links.new(separate.outputs[axis],phase.inputs[0])
        for operation in ("SINE","COSINE"):
            node = nodes.new("ShaderNodeMath")
            node.operation = operation
            links.new(phase.outputs[0],node.inputs[0])
            periodic.append(node.outputs[0])
    combine = nodes.new("ShaderNodeCombineXYZ")
    for index in range(3):
        links.new(periodic[index],combine.inputs[index])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 4
    noise.inputs["Detail"].default_value = 4
    noise.inputs["Roughness"].default_value = 0.55
    links.new(combine.outputs[0],noise.inputs["Vector"])
    links.new(periodic[3],noise.inputs["W"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.022,0.135,0.19,1)
    ramp.color_ramp.elements[1].color = (0.048,0.205,0.25,1)
    links.new(noise.outputs["Fac"],ramp.inputs[0])
    shader = nodes.get("Principled BSDF")
    links.new(ramp.outputs[0],shader.inputs["Base Color"])
    relief = nodes.new("ShaderNodeBump")
    relief.inputs["Strength"].default_value = 0.25
    relief.inputs["Distance"].default_value = 0.12
    links.new(noise.outputs["Fac"],relief.inputs["Height"])
    links.new(relief.outputs[0],shader.inputs["Normal"])
    box("Open water", (0,0,-0.03), (28,28,0.02), mat, 0)
    cam = camera(1024,1024,26,(0,0,0))
    cam.location = (0,0,20)
    cam.rotation_euler = (0,0,0)
    for light in list(bpy.data.objects):
        if light.type == "LIGHT" and light.data.type == "AREA":
            bpy.data.objects.remove(light,do_unlink=True)
    return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", choices=["island","bridge","bridge-se","water"], default="island")
    parser.add_argument("--quality", choices=["preview","final"], default="preview")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("Mission Frontier daylight")
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 24 if args.quality == "preview" else 72
    scene.cycles.use_denoising = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    scene.render.film_transparent = args.asset != "water"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 25
    scene.view_settings.view_transform = "AgX"
    lighting()
    used = {"island":island,"bridge":bridge,"bridge-se":bridge_se,"water":water}[args.asset]()
    bpy.context.view_layer.update()
    origin = world_to_camera_view(scene, scene.camera, Vector((0,0,0)))
    output = STAGE / args.quality
    output.mkdir(parents=True,exist_ok=True)
    blend = output / f"{args.asset}.blend"
    image = output / f"{args.asset}.png"
    scene.render.filepath = str(image)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.render.render(write_still=True)
    width,height=scene.render.resolution_x,scene.render.resolution_y
    metadata = {
        "id":f"mf.cinematic.{args.asset}","file":str(image.relative_to(ROOT)),
        "sourceSize":[width,height],"logicalSize":[width/2,height/2],
        "groundAnchor":[origin.x*width/2,(1-origin.y)*height/2],
        "seed":SEED,"blenderVersion":bpy.app.version_string,"samples":scene.cycles.samples,
        "projection":{"type":"orthographic","elevationDegrees":90 if args.asset == "water" else 30,"azimuthDegrees":0 if args.asset == "water" else 45,"orthoScale":scene.camera.data.ortho_scale},
        "sha256":hashlib.sha256(image.read_bytes()).hexdigest(),
        "bytes":image.stat().st_size,"sources":[str((SOURCES/p).relative_to(ROOT)) for p in used],
        "sourceBlend":str(blend.relative_to(ROOT)),
        "note":"Static scenery only. No task identity, semantic indicators or worker occupancy baked in."
    }
    (output / f"{args.asset}.json").write_text(json.dumps(metadata,indent=2)+"\n")
    print("FRONTIER_EXPORT "+json.dumps(metadata))


if __name__ == "__main__":
    main()
