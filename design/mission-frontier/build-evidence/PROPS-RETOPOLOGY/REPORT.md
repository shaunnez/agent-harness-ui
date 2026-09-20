# FabCell and ServiceCart retopology — 21 September 2026

Continuation of PR #107 from `458862c`, in `claude/meshy-models-frontier-ui-b8527f`.
Changes are local; no PR push, merge, deployment, or paid generation was performed.

## Result

| Asset | Prior recorded triangles | Exported triangles | Target |
| --- | ---: | ---: | ---: |
| FabCell | 14,622 | 5,984 | 6,000 |
| ServiceCart | 11,291 | 4,998 | 5,000 |
| Complete eight-prop kit | 50,910 | 35,947 | 40,000 |

Kit size: 2,909,480 bytes against the stated 4,000,000-byte producer budget.
SHA-256: `3f7eccc2db4287b7f9ba88db1e907f76ade52c414deafbf589bf80873a7752d6`.
The receipt now counts exported GLB accessors, including triangles removed during export,
rather than reporting only Blender's pre-export face counts.

## Diagnosis and correction

Inspected the old exported meshes in Blender workbench renders from front and rear, and the
original scans under neutral lighting. The old reduced surfaces had severe folding/faceting.
Re-welding at the original tolerance did not release the collapse stall. A larger 0.001-unit
weld plus degenerate-edge cleanup before reduction also failed: it stalled at 36,852 / 36,196
triangles and visibly damaged the FabCell. Do not repeat that as the solution.

The failure is consistent with the scan's complex topology constraining collapse, rather than
new duplicate vertices introduced between passes. The practical correction is a 0.004-unit voxel
remesh of each original scan, followed by collapse to 6,000 / 5,000 and a selected-to-active bake
of base colour, tangent normal, roughness, metallic, and emission into 1024px atlases. No source
GLB was changed. `preparation.json` records source/output hashes and bake settings. A second run
of the committed preparation script produced byte-identical GLBs and preparation receipts.

The source and rebuilt PNGs beside this report show the quality tradeoff: retained gantry,
robot arm, cart rails, drawers and wheels, with softer small texture detail than the 4K source.
The final HQ was inspected in Chrome at the normal desktop size and a 1440×900 viewport override;
the override was reset afterward. `hq-preview.png` records the integrated desktop result.
This is local fixture acceptance, not live-runtime acceptance or new performance benchmarking.

## Integration

- Added the missing three-cell fabrication row within radial 8–14 and the service cart on its
  frozen dispatch pad. Updated existing placement bounds to the current producer receipt;
  the original branch already failed that parity test before this work.
- Removed the corresponding placeholders and stale obstacles through the existing shell
  producer recipe and regenerated only the shell. Its crowns, doors, lighting and sockets
  remain unchanged. Prior shell files are backed up under `/tmp/frontier-props-qa.SIeCss/`.
- Reintegrated the hashed shell and props assets and their receipts. Retained old hashed public
  files for recovery. Shared material role names remain unsuffixed and all eight prop atlases
  remain distinct.
- Enforced build failures for stalled reductions, source/preparation hash mismatch, and kit
  budget violations. Aligned integration validation with the stated 40k / 4MB producer budget;
  its previous 350 KB × 8 byte check conflicted with that budget and the already-recorded 2.9MB kit.

## Verification

- `npm run test:frontier`: 142/142 passed; transcript retained here.
- `npm run typecheck`: passed.
- `npm run lint`: passed across 497 files.
- Biome check for changed JavaScript/TypeScript files: passed.
- `npm run build:frontier`: passed; existing large-chunk advisory remains.
- Integration asset validation: passed, including shell geometry/contract/hash checks.
- glTF Transform validation of both the compressed kit and a separately Draco-decoded copy:
  no errors; eight generated-tangent-space portability warnings remain. The compressed form
  additionally reports the validator's unsupported-Draco notice. Do not describe this as
  warning-free validation.
- Browser: new props visible in HQ; no console errors in captured fixture logs. A Three.Clock
  deprecation warning remains. Placement tests cover pad containment, fabrication reservation,
  socket clearance, exported counts, receipt hash, and preservation of separate textures.
- `git diff --check`: passed.

No journal update was made: this worktree has no `journal-site/` directory.

## Reproduce

Run from this worktree with Blender 5.2.1 LTS. `PREPARED` can be a scratch directory; its
GLBs are intermediate bake outputs, not additional runtime dependencies.

```sh
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
SOURCE=design/mission-frontier/assets/staging/meshy-kit/source
MESHY=/Users/shaun/projects/agent-harness-ui/meshy_output
PREPARED=/tmp/frontier-props-prepared
OUT=design/mission-frontier/assets/staging/meshy-kit/producer
"$BLENDER" -b -t 4 --python-exit-code 1 --python "$SOURCE/prepare_complex_props.py" -- "$MESHY" "$PREPARED"
"$BLENDER" -b -t 4 --python-exit-code 1 --python "$SOURCE/build_props_kit.py" -- "$MESHY" "$OUT" "$PREPARED"
node scripts/frontier/integrate-3d-proof.mjs
npm run test:frontier
npm run build:frontier
```

Local review preview: `http://127.0.0.1:5257/?mode=fixture#project/plancheck`.
