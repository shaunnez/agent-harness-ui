"""Independent standard-library audit of the final exported GLBs, not source meshes."""
import hashlib, json, math, struct
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
COMP={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}
WIDTH={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def sub(a,b):return tuple(x-y for x,y in zip(a,b))
def cross(a,b):return(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def audit(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);buf=raw[28+n:]
    def accessor(i):
        a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']];fmt,size=COMP[a['componentType']];count=WIDTH[a['type']];stride=v.get('byteStride',count*size);start=v.get('byteOffset',0)+a.get('byteOffset',0)
        return [struct.unpack_from('<'+fmt*count,buf,start+j*stride) for j in range(a['count'])]
    material_errors=[m['name'] for m in doc.get('materials',[]) if m.get('doubleSided',False)]
    groups=[o.get('name','') for o in doc['nodes']]
    required=['MF_Terrain','MF_Planting','MF_Road_Ring']+[f'MF_{kind}_E{edge}' for kind in ['Pad','Road_Spur'] for edge in range(30,331,60)]
    missing=[name for name in required if name not in groups]
    triangles=0;normals_bad=[];edges=Counter();core_down=0;core_faces=0;degenerate=0
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            pos=accessor(p['attributes']['POSITION']);normal=accessor(p['attributes']['NORMAL']);ids=[v[0] for v in accessor(p['indices'])]
            triangles+=len(ids)//3
            for i in range(0,len(ids),3):
                inds=ids[i:i+3];a,b,c=[pos[k] for k in inds];face=cross(sub(b,a),sub(c,a))
                if dot(face,face)<1e-15:degenerate+=1;continue
                if dot(face,tuple(sum(normal[k][axis] for k in inds) for axis in range(3)))<0:normals_bad.append(mesh['name'])
                if mesh['name'].startswith('parcel_closed_manifold_core'):
                    core_faces+=1
                    vv=[tuple(round(v,4) for v in pt) for pt in [a,b,c]]
                    for j in range(3):edges[tuple(sorted((vv[j],vv[(j+1)%3])))]+=1
                    # Slice 2A: the wave-cut notch leans 0.25 m over the waterline (normal y about -0.43); only steeper undersides are defects.
                    if face[1]<-.5*math.sqrt(dot(face,face)) and min(a[1],b[1],c[1])>-2.999:core_down+=1
    report={'file':path.name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'triangles':triangles,'images':len(doc.get('images',[])),'missingGroups':missing,'doubleSidedMaterials':material_errors,'normalWindingDisagreements':len(normals_bad),'normalWindingMeshes':dict(Counter(normals_bad)),'coreTriangles':core_faces,'coreBoundaryEdges':sum(n==1 for n in edges.values()),'coreNonManifoldEdges':sum(n!=2 for n in edges.values()),'coreDownwardExposedFaces':core_down,'degenerateTriangles':degenerate}
    assert not missing and not material_errors and not normals_bad and not core_down,report
    assert all(n==2 for n in edges.values()) and core_faces>0,report
    assert triangles<=120000 and len(raw)<=12000000 and len(doc.get('images',[]))<=8,report
    return report
if __name__=='__main__':
    reports=[audit(ROOT/f'parcel-{kind}.glb') for kind in ['hub','a']]
    (ROOT/'export-validation.json').write_text(json.dumps(reports,indent=2)+'\n');print(json.dumps(reports,indent=2))
