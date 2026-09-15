"""Compare separately regenerated output against the frozen review delivery."""
import json
from pathlib import Path
R=Path(__file__).resolve().parents[1]
a=json.loads((R/'validation.json').read_text());b=json.loads((R/'rebuild-check/validation.json').read_text())
x=json.loads((R/'scene-metadata.json').read_text());y=json.loads((R/'rebuild-check/scene-metadata.json').read_text())
checks={k:a['scene'][k]==b['scene'][k] for k in ['meshCount','materialCount','embeddedImages','triangles']}
checks.update({k:x[k]==y[k] for k in ['cameras','sockets','groups','materials','shorelineXZ','walkableRoutes','practicalLightPositions']})
result={'status':'pass' if all(checks.values()) else 'fail','checks':checks,'delivered':a['scene'],'rebuilt':b['scene'],'note':'Independent full authoring build, GLB export, packaging and structural audit; byte identity not required.'}
(R/'rebuild-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));assert all(checks.values())
