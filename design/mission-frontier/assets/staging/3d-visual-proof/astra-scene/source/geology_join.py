"""Seat open scan rims in closed, irregular geological contact volumes."""
import math
from mathutils import Vector
# Tuck the camera-facing scan cut margins inward into the solid contact geology.
for o in list(S.objects):
 if o.name=='coastal_scanned_formation_0':o.location.y+=1.6
 elif o.name.startswith('interlocking_scanned_cliff'):
  o.location.x-=1.3
# Broad joined contact volumes, not a necklace of repeated scatter rocks.
for name,cx,cz,rx,rz,top in [('east_contact_geology',22.8,3.4,3.8,16.2,5.0),('court_contact_geology',-2,22.8,21,2.9,3.95)]:
 verts=[];faces=[];n=48
 for j,(h,scale) in enumerate([(-1.2,.84),(-.15,1.02),(.9,1.04),(1.8,.99),(2.8,.91),(top,.82)]):
  for i in range(n):
   a=math.tau*i/n;r=scale*(1+.065*math.sin(a*7+.8)+.035*math.cos(a*11+j*.47));x=cx+rx*r*math.cos(a);z=cz+rz*r*math.sin(a);y=h+.15*math.sin(a*5+j*.8)
   if x>11 and 11<z<17:y=min(y,3.65)
   verts.append((x,-z,y))
 for j in range(5):
  for i in range(n):
   a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
 bottom=len(verts);verts.append((cx,-cz,-1.2));cap=len(verts);verts.append((cx,-cz,top-.1))
 for i in range(n):faces.append((bottom,(i+1)%n,i));faces.append((cap,5*n+i,5*n+(i+1)%n))
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);S.collection.objects.link(o);o.parent=bpy.data.objects['MF_Terrain'];me.materials.append(bpy.data.materials['terrain_stratified_warm_limestone']);uv=me.uv_layers.new(name='UVMap')
 for p in me.polygons:
  p.use_smooth=True
  for li in p.loop_indices:
   co=me.vertices[me.loops[li].vertex_index].co
   uv.data[li].uv=(co.x*.28,co.y*.28) if abs(p.normal.z)>.65 else ((co.y if abs(p.normal.x)>abs(p.normal.y) else co.x)*.28,co.z*.28)
 # Subdivision and metre-scale rock relief break the broad exposed backing into actual geology.
 sub=o.modifiers.new('contact_geology_subdivision','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=2
 tex=bpy.data.textures.new(name+'_relief',type='CLOUDS');tex.noise_scale=1.1;tex.noise_depth=2
 dis=o.modifiers.new('contact_geology_relief','DISPLACE');dis.texture=tex;dis.texture_coords='GLOBAL';dis.strength=1.1;dis.mid_level=.5
 o['geology_join']='closed textured contact volume intersects scan rims and continuous island core'
