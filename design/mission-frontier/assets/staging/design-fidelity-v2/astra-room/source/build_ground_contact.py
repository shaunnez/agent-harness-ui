"""Ground-contact apron only. Existing room blend and PNG layers remain read-only."""
import bpy, math, random, json, hashlib
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
R=Path(__file__).resolve().parents[1];rng=random.Random(915640)
original_files=[R/'entries.json',R/'provenance.json',*[R/'renders'/('room-'+k+'-r1.png') for k in ['floor','back','front','lights']]]
original_hashes={str(p.relative_to(R)):hashlib.sha256(p.read_bytes()).hexdigest() for p in original_files}
bpy.ops.wm.open_mainfile(filepath=str(R/'blend/room-final.blend'));S=bpy.context.scene
for ob in list(bpy.data.objects):
 if ob.type not in ['LIGHT','CAMERA']:bpy.data.objects.remove(ob,do_unlink=True)
S.cycles.samples=48;S.cycles.seed=915640;S.cycles.use_denoising=True;S.render.threads_mode='FIXED';S.render.threads=4;S.render.film_transparent=True;S.render.image_settings.file_format='PNG';S.render.image_settings.color_mode='RGBA';S.render.image_settings.color_depth='8'
S.render.resolution_x=1536;S.render.resolution_y=1280;S.render.resolution_percentage=100

def material(name,color):
 m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=.88
 tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=24;tex.inputs['Detail'].default_value=3
 ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.20;ramp.color_ramp.elements[0].color=(*(x*.78 for x in color),1);ramp.color_ramp.elements[1].position=.8;ramp.color_ramp.elements[1].color=(*(x*1.1 for x in color),1);l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],p.inputs['Base Color'])
 noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=100;noise.inputs['Detail'].default_value=2;b=n.new('ShaderNodeBump');b.inputs['Strength'].default_value=.33;b.inputs['Distance'].default_value=.018;l.new(noise.outputs['Fac'],b.inputs['Height']);l.new(b.outputs[0],p.inputs['Normal'])
 return m
soil=material('compacted earth with fine muted gravel',(.23,.225,.192));stones=[material('weathered footing stone '+str(i),(.225+i*.013,.224+i*.012,.20+i*.012)) for i in range(4)];shadowmat=material('invisible slab shadow caster',(.08,.085,.083))
# Mesh opacity fades over the outermost irregular 0.10 world-unit gravel fringe.
n=soil.node_tree.nodes;l=soil.node_tree.links;p=n.get('Principled BSDF');out=n.get('Material Output');attr=n.new('ShaderNodeAttribute');attr.attribute_name='edge_opacity';trans=n.new('ShaderNodeBsdfTransparent');mix=n.new('ShaderNodeMixShader');l.new(attr.outputs['Fac'],mix.inputs[0]);l.new(trans.outputs[0],mix.inputs[1]);l.new(p.outputs[0],mix.inputs[2]);l.new(mix.outputs[0],out.inputs['Surface'])
# A squircle-like boundary with clipped square corners preserves the fixed canvas margins.
N=128;verts=[(0,0,-.665)];values=[1.0]
# Square inner body, lightly uneven apron, and a feathered perimeter. No vertical outer rim.
for ring in range(3):
 for i in range(N):
  a=i*math.tau/N;c,s=math.cos(a),math.sin(a);radius=(5.08 if ring==0 else 5.31 if ring==1 else 5.40)/max(abs(c),abs(s));x,y=radius*c,radius*s
  # Cap long diagonal corners to avoid diamond tips clipping at source width.
  if abs(x)+abs(y)>10.5:
   scale=10.5/(abs(x)+abs(y));x*=scale;y*=scale
  jitter=0 if ring==0 else rng.uniform(-.045,.045);x+=c*jitter;y+=s*jitter
  z=-.655+(rng.uniform(-.013,.013) if ring else 0)
  verts.append((x,y,z));values.append(1.0 if ring<2 else 0.0)
faces=[]
for i in range(N):faces.append((0,1+i,1+(i+1)%N))
for ring in range(2):
 for i in range(N):
  a=1+ring*N+i;b=1+ring*N+(i+1)%N;faces.append((a,b,b+N,a+N))
mesh=bpy.data.meshes.new('irregular ground skin');mesh.from_pydata(verts,[],faces);mesh.update();attr=mesh.attributes.new('edge_opacity','FLOAT','POINT')
for v,a in zip(values,attr.data):a.value=v
ob=bpy.data.objects.new('compact feathered gravel apron',mesh);bpy.context.collection.objects.link(ob);ob.data.materials.append(soil)
# Only the real slab mass casts a close contact shadow; tall room walls cannot create a broad halo.
bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,-.34));caster=bpy.context.object;caster.name='camera invisible original slab volume';caster.dimensions=(10,10,.52);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);caster.data.materials.append(shadowmat);caster.visible_camera=False
# Embedded irregular support stones intersect the slab underside (-0.60) and ground skin.
# Irregular small stones provide contact detail, rather than another clean raised platform.
stone_count=0
for side in range(4):
 for i in range(26):
  along=-4.90+i*.39+rng.uniform(-.08,.08);outward=5.015+rng.uniform(-.06,.075)
  x,y=(along,outward) if side==0 else (outward,-along) if side==1 else (-along,-outward) if side==2 else (-outward,along)
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,y,-.625));o=bpy.context.object;o.name='embedded weathered foundation fragment';o.scale=(rng.uniform(.16,.29),rng.uniform(.11,.22),rng.uniform(.065,.105));o.rotation_euler=(rng.uniform(-.12,.12),rng.uniform(-.12,.12),rng.uniform(0,math.tau));o.data.materials.append(rng.choice(stones))
  for v in o.data.vertices:v.co*=rng.uniform(.85,1.12)
  bevel=o.modifiers.new('worn stone corners','BEVEL');bevel.width=.045;bevel.segments=2;o.modifiers.new('weighted rock normals','WEIGHTED_NORMAL');stone_count+=1
# Fine scattered chips sit in the narrow apron. None extend into the scene as a decorative halo.
for i in range(340):
 side=i%4;along=rng.uniform(-5.10,5.10);outward=rng.uniform(5.04,5.29)
 x,y=(along,outward) if side==0 else (outward,-along) if side==1 else (-along,-outward) if side==2 else (-outward,along)
 if abs(x)+abs(y)>10.44:continue
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,y,-.647));o=bpy.context.object;o.name='grounded apron gravel chip';o.scale=(rng.uniform(.022,.070),rng.uniform(.023,.057),rng.uniform(.014,.036));o.rotation_euler.z=rng.uniform(0,math.tau);o.data.materials.append(rng.choice(stones));stone_count+=1
bpy.context.view_layer.update()
def px(v):
 p=world_to_camera_view(S,S.camera,Vector(v));return [round(p.x*1536,6),round((1-p.y)*1280,6)]
meta={'id':'mf.fidelity.room.ground-contact','sourceSize':[1536,1280],'logicalSize':[768,640],'groundAnchor':[384,522],'groundAnchorSourceMeasured':px((5,5,0)),'roomFloorCornersSourceMeasured':[px(p) for p in [(-5,-5,0),(-5,5,0),(5,5,0),(5,-5,0)]],'slabBottomWorldZ':-.60,'groundSkinWorldZ':-.655,'shadowCasterOnly':'original slab volume, camera-invisible; no wall shadow and no external shadow-catcher plane','embeddedStoneCount':stone_count,'outerEdge':'irregular feathered flat mesh, no raised rim','renderThreads':4,'samples':48,'seed':915640,'blenderVersion':bpy.app.version_string,'unchangedRoomFileHashes':original_hashes,'camera':{'location':list(S.camera.location),'orthoScale':S.camera.data.ortho_scale,'rotationEuler':list(S.camera.rotation_euler)}}
(R/'source/ground-contact-geometry.json').write_text(json.dumps(meta,indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(R/'blend/ground-contact.blend'));S.render.filepath=str(R/'renders/ground-contact.png');bpy.ops.render.render(write_still=True)
