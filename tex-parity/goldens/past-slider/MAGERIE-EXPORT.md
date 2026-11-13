# Past-slider goldens for tex (#1199)

- Recorded on magerie-one main `1484d0843`, macOS Metal, 12 Nov 2026, by magerie-one Mac 006 for OneJSv3Container Mac 004 (task 67726b87).
- `manifest.json` is in the ojplay set's format (`js/tests/fixtures/kernel-parity/ojplay/manifest.json`): each case is the node's executor run alone on the named input, 32 x 32, the stored RGBA8 bytes, row 0 at the top, tolerance 1.
- `recorder.test.tsx.txt` is the scratch test that wrote it: the same call as `js/tests/ojplay-goldens.test.tsx` (the executor through `createMockContext`, params as the node's defaults under the case's). It is not on main, and the set is not in Magerie's own ojplay goldens.
- Each case ran twice, byte for byte the same.

## Inputs

- `height-waves.bin`: the ojplay set's, byte for byte (0.06 to 0.94).
- `grey-steps-0-7.bin`: greys 0 to 7 of 255, a step every four columns, opaque. The birch band's window ends at 0.00098, under one byte, so only a byte of 0 tells -0.0000234 from 0.
- `colour-asym.bin`: opaque colour with no symmetry.

## Against the pre-#1199 clamp

The same executor run with the params as Metal clamped them before `80294efab` (Levels black and white to 0..1, gamma to 0.1..10; Threshold to 0..1, smoothness to 0..0.5; Transform scale to at least 0.01):

| case | largest byte difference | bytes more than 1 off |
|---|---|---|
| levels/waves-in-black-m05 | 79 | 3072 |
| levels/waves-in-white-2 | 114 | 3072 |
| levels/waves-gamma-20 | 27 | 3066 |
| levels/waves-gamma-005 | 57 | 876 |
| levels/waves-out-white-2 | 127 | 3072 |
| levels/waves-out-black-m05 | 85 | 3072 |
| levels/steps-birch-band | 6 | 384 |
| threshold/waves-t12-s04 | 69 | 600 |
| threshold/waves-tm02-s04 | 75 | 630 |
| threshold/waves-t05-s08 | 34 | 2922 |
| transform/asym-scale-m1 | 255 | 4096 |
| transform/asym-scale-m05 | 255 | 1024 |
| transform/asym-scale-0 | 255 | 4096 |

## Cases changed from the request

- The birch band is on `grey-steps-0-7`, not `height-low-waves`: on the waves both draw white everywhere (difference 0).
- Transform scale 0.005 is left out: it and the old floor of 0.01 both draw an empty picture at 32 px (0.16 and 0.32 px), as does any positive scale under 0.01.
- In its place: scale -0.5, and scale 0, which now draws as scale 1 (the old floor drew it empty). Scale -1 is the picture turned half round, byte for byte; scale 0 is the input, byte for byte.
