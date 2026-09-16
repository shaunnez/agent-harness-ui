import json,struct,sys,numpy as np
path=sys.argv[sys.argv.index('--')+1]
with open(path,'rb') as f:
    f.read(12); clen,_=struct.unpack('<II',f.read(8)); g=json.loads(f.read(clen)); blen,_=struct.unpack('<II',f.read(8)); bin_=f.read(blen)
def acc(i):
    a=g['accessors'][i]; bv=g['bufferViews'][a['bufferView']]
    off=bv.get('byteOffset',0)+a.get('byteOffset',0)
    n={5126:('<f4',4),5123:('<u2',2),5125:('<u4',4)}[a['componentType']]
    comps={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    stride=bv.get('byteStride',0) or n[1]*comps
    if stride==n[1]*comps:
        arr=np.frombuffer(bin_,dtype=n[0],count=a['count']*comps,offset=off)
    else:
        raw=np.frombuffer(bin_,dtype=np.uint8,offset=off,count=stride*a['count']).reshape(a['count'],stride)
        arr=raw[:,:n[1]*comps].copy().view(n[0])
    return arr.reshape(a['count'],comps)
for node in g['nodes']:
    if 'mesh' not in node or not node.get('name','').startswith(('MF_Terrain','MF_Bridge')): continue
    for p in g['meshes'][node['mesh']]['primitives']:
        pos=acc(p['attributes']['POSITION']); nrm=acc(p['attributes']['NORMAL']); idx=acc(p['indices']).ravel()
        tri=pos[idx].reshape(-1,3,3)
        face_n=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
        vtx_avg=nrm[idx].reshape(-1,3,3).mean(1)
        agree=(np.sign((face_n*vtx_avg).sum(1))>0).mean()
        upish=np.abs(face_n[:,1])>0.5*np.linalg.norm(face_n,axis=1)  # roughly horizontal faces
        print(f"{node['name']:48s} tris={len(tri):7d} horizFaces={upish.mean():.2f} winding-up(of horiz)={np.mean(face_n[upish,1]>0):.2f} vertexN-up(of horiz)={np.mean(vtx_avg[upish,1]>0):.2f} winding/vertex agree={agree:.2f}")
