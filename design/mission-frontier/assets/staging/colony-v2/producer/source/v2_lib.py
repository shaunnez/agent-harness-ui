"""Contract 2.0 producer glue: reuse the 1.0.1 authoring library and interior recipe, write into colony-v2/producer.

The 1.0.1 producer directory is read-only history. Everything authored here lands next to this file's parent.
"""
import sys, json, hashlib
from pathlib import Path
V2 = Path(__file__).resolve().parents[1]                 # .../colony-v2/producer
STAGING2 = V2.parent                                      # .../colony-v2
CONTRACT2_PATH = STAGING2 / 'contract.json'
C2 = json.loads(CONTRACT2_PATH.read_text())
V1_SOURCE = STAGING2.parent / 'colony-hq-v1' / 'producer' / 'source'
sys.path.insert(0, str(V1_SOURCE))
import bpy  # noqa: E402
from hq_lib import *  # noqa: E402,F401
import build_hq as B  # noqa: E402
from export_hq import export_asset  # noqa: E402

MASSING = C2['hq']['massing']
DRUM_R = MASSING['hubDrum']['radius']
DRUM_TOP = MASSING['hubDrum']['top']
CROWN_BASE = MASSING['envelope']['crownBase']
CROWN_FIT_R = MASSING['envelope']['crownFitRadius']
CROWN_MAX = MASSING['envelope']['maxHeight'] - 0.1
ENVELOPE_R = MASSING['envelope']['maxRadius']
APRON = C2['terrain']['plateau']['courtApron']


def finish_v2(stem, roots, extra=None):
    bpy.context.view_layer.update()
    bpy.context.preferences.filepaths.save_version = 0
    V2.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(V2 / (stem + '.blend')))
    return export_asset(stem, V2, roots, extra)


def write_metadata(results):
    path = V2 / 'hq-metadata.json'
    old = json.loads(path.read_text()) if path.exists() else {}
    old.update({'version': '2.0.0', 'contractVersion': C2['version'],
                'contractSha256': hashlib.sha256(CONTRACT2_PATH.read_bytes()).hexdigest()})
    old.setdefault('assets', {}).update(results)
    shell = old['assets'].get('hq-shell', {})
    old['lights'] = shell.get('lights', old.get('lights', []))
    old['sockets'] = shell.get('sockets', old.get('sockets', []))
    old['obstacles'] = shell.get('obstacles', old.get('obstacles', []))
    path.write_text(json.dumps(old, indent=2) + '\n')
    return path
