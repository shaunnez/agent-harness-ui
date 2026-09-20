"""Validate the Contract 2.0 HQ exports independently by re-importing into Blender; exits nonzero on defect."""
import sys, json, hashlib, math, struct
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from v2_lib import *  # noqa: F401,F403
from v2_lib import V2, C2, CONTRACT2_PATH, MASSING, APRON

checks = []
def require(condition, detail):
    if not condition: raise AssertionError(detail)
    checks.append(detail)

def bounds(objects):
    p = [gl(o.matrix_world @ v.co) for o in objects if o.type == 'MESH' for v in o.data.vertices]
    return [min(x[i] for x in p) for i in range(3)], [max(x[i] for x in p) for i in range(3)]

meta = json.loads((V2 / 'hq-metadata.json').read_text())
require(meta['contractSha256'] == hashlib.sha256(CONTRACT2_PATH.read_bytes()).hexdigest(), 'metadata binds Contract 2.0 SHA256')
env = MASSING['envelope']
for name, a in meta['assets'].items():
    path = V2 / a['file']; raw = path.read_bytes(); n = struct.unpack_from('<I', raw, 12)[0]; d = json.loads(raw[20:20 + n])
    require(hashlib.sha256(raw).hexdigest() == a['glb']['sha256'], name + ': hash matches export')
    budget = C2['budgets']['hqShell' if name == 'hq-shell' else 'crown']
    tris = sum(d['accessors'][p['indices']]['count'] // 3 for mesh in d.get('meshes', []) for p in mesh['primitives'])
    require(len(raw) <= budget['bytes'] and tris <= budget['triangles'], f'{name}: {len(raw)} B / {tris} tris within budget')
    require(all('uri' not in x for x in d.get('images', [])), name + ': all textures embedded')
    require(len(d.get('images', [])) <= 8, name + ': texture count <=8')
    for m in d.get('materials', []):
        if m['name'].startswith('identity_'):
            c = m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])
            require(max(c[:3]) - min(c[:3]) < .001, name + ': neutral ' + m['name'])
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=str(path)); bpy.context.view_layer.update()
    for root in a['rootGroups']: require(bpy.data.objects.get(root) is not None, name + ': root ' + root)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']; lo, hi = bounds(meshes)
    for i in range(3):
        require(abs(lo[i] - a['bounds']['min'][i]) < .005 and abs(hi[i] - a['bounds']['max'][i]) < .005, name + ': measured bounds axis ' + str(i))
    if name == 'hq-shell':
        for room in C2['hq']['rooms']: require(bpy.data.objects.get('MF_Interior_' + room) is not None, 'room child ' + room)
        sockets = [s for r in C2['hq']['rooms'].values() for s in r['sockets']] + C2['hq']['hubOverflowSockets'] + C2['hq']['courtSockets']
        require(len(sockets) == 53, 'contract has 53 worker sockets')
        for s in sockets:
            o = bpy.data.objects.get(s['id']); require(o is not None, 'export socket ' + s['id'])
            p = gl(o.matrix_world.translation); expected = (s['xz'][0], s['y'], s['xz'][1])
            require(max(abs(p[i] - expected[i]) for i in range(3)) <= .05, 'socket coordinates ' + s['id'])
        for name2 in ['MF_ShellCutaway_FrontFlats', 'MF_ShellCutaway_PartitionGlass']:
            o = bpy.data.objects.get(name2); require(o and o.parent.name == 'MF_ShellCutaway', 'cutaway ownership ' + name2)
        # Envelope: nothing outside the eaves radius except the court apron and bay canopy in front.
        worst = 0.0; top = -1e9; over_drum = -1e9
        for o in meshes:
            for v in o.data.vertices:
                x, y, z = gl(o.matrix_world @ v.co)
                top = max(top, y)
                if math.hypot(x, z) <= env['crownFitRadius'] + .2: over_drum = max(over_drum, y)
                in_front = z > 13.5 and abs(x) <= (APRON['x'][1] + .2)
                if not in_front: worst = max(worst, math.hypot(x, z))
        require(worst <= env['maxRadius'] + .02, f'shell within eaves radius {env["maxRadius"]} (measured {worst:.2f})')
        require(over_drum <= MASSING['hubDrum']['top'] + .3, f'nothing above the drum deck inside the crown radius (measured {over_drum:.2f}); crowns start at {env["crownBase"]}')
        require(top <= env['maxHeight'] - 1.0, f'shell roof equipment tops at {top:.2f}, under the label anchor')
        # Six rooms' floor inlays and the bay are present and the roof group hides with the cutaway.
        roof = bpy.data.objects.get('MF_Roof'); require(roof is not None and roof.children, 'roof group carries the drum and bay roofs')
    elif name.startswith('crown-'):
        require(lo[1] >= env['crownBase'] - .1 and hi[1] <= env['maxHeight'] + .01, f'{name}: crown between drum deck and {env["maxHeight"]}')
        worst = max(math.hypot(*[gl(o.matrix_world @ v.co)[i] for i in (0, 2)]) for o in meshes for v in o.data.vertices)
        require(worst <= env['crownFitRadius'] + .15, f'{name}: crown inside the drum fit radius (measured {worst:.2f})')
        require(any(m.name.startswith('identity_') for o in meshes for m in o.data.materials if m), name + ': carries identity materials')
report = {'passed': True, 'contractVersion': C2['version'], 'assets': list(meta['assets']), 'checks': checks, 'checkCount': len(checks)}
(V2 / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
print('PASS:', len(checks), 'independent GLB checks')
