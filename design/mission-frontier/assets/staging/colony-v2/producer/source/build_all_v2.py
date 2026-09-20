"""Build the Contract 2.0 HQ set. Blender 5.2.1 headless:

  /Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python build_all_v2.py -- shell command relay foundry bastion

Bridge span and end are unchanged 1.0.1 assets and are not rebuilt here.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from v2_lib import write_metadata  # noqa: E402
from build_hq_v2 import shell_v2  # noqa: E402
from build_crowns_v2 import CROWNS  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
known = ['shell', *CROWNS]
kinds = [x for x in args if x in known] or known
results = {}
for kind in kinds:
    result = shell_v2() if kind == 'shell' else CROWNS[kind]()
    results[result['file'].removesuffix('.glb')] = result
    print('BUILT', kind, result['glb'])
print('METADATA', write_metadata(results))
