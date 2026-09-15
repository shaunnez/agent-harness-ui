"""Small reproducible landscape finishing step, called by build_scene before save."""
# Assumes scene authoring helpers and deterministic rng from build_scene.
group='MF_Planting'
for o in list(bpy.data.objects):
 if o.name.startswith(('coastal_low_scrub','scattered_weathered_stone')):
  x,z=o.location.x,-o.location.y
  if x>11 and 11<z<17:bpy.data.objects.remove(o,do_unlink=True)
for p in bpy.data.objects['continuous_gravel_terrace'].data.polygons:p.use_smooth=True
for color in range(3):
 vs=[];fs=[]
 for i in range(160):
  x=rng.uniform(-30,23);z=rng.uniform(-26,25)
  if ((x+3)/29)**2+(z/29)**2>.89 or (-15<x<15 and -12<z<21) or (x>11 and 11<z<17):continue
  for j in range(13):
   xx=x+rng.uniform(-.7,.7);zz=z+rng.uniform(-.7,.7);y=ground(xx,zz)+.04;h=rng.uniform(.13,.43);a=rng.random()*math.tau;dx=math.cos(a)*.055;dz=math.sin(a)*.055;k=len(vs)
   vs.extend([(xx-dx,y,zz-dz),(xx+dx,y,zz+dz),(xx+dx*.9,y+h,zz+dz*.9)]);fs.append((k,k+1,k+2));fs.append((k+2,k+1,k))
 mesh('salt_grass_tufts_'+str(color),vs,fs,leaf[color if color<2 else 4])
