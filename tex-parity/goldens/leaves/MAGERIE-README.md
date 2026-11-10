# PrimoEden leaves, for tex parity (OneJSv3Container Win 004, Tachi c97a4ebe)

- Exported at magerie-one main 44d69541b (magerieCommit), 9 Nov 2026.
- Each `.ts` is Magerie's own OJPlay emit (tex.canvas form, `import { tex } from "oj"`).
- Each `.png` is the Image Exporter's output exactly as stored: RGBA, with the alpha from the exporter's Alpha input (Levels 0.499 to 0.501 on the leaves' alpha).
- `leaves.ts` is the lab source that built the boards.

## whole/: these emit whole (one `// Written by` line, no other comments)

One hand-placed cell of an atlas on its own 1024 board:
- Inside the cell, every visible pixel and the whole alpha are byte-identical to the delivered atlas.
- Under alpha 0, the bled colour differs from the atlas, which also bleeds the neighbouring cells.
- Outside the cell, alpha is 0 everywhere.

| File | export const | PNG | atlas cell |
|---|---|---|---|
| oak-leaves-spray.ts | `oakLeavesSprayPng` | oak-leaves-spray.png | oak cell 1 (top right) |
| oak-leaves-plate.ts | `oakLeavesPlatePng` | oak-leaves-plate.png | oak cell 3 (bottom right) |
| birch-leaves-spray.ts | `birchLeavesSprayPng` | birch-leaves-spray.png | birch cell 1 (top right) |
| birch-leaves-curtain.ts | `birchLeavesCurtainPng` | birch-leaves-curtain.png | birch cell 2 (bottom left); the delivered leaves-lab-curtain.png is this cell |

Nodes used:
- **Every whole/ board:** `scatter` (grid 1 x 1, no jitter, no mask: it only centres a leaf stamp on the canvas), `transform` (Translate, Rotation, Scale: each leaf placed), gradient, noise (32-bit), warp, gradientMap, levels, blend, channelMath, channelShuffle, alphaMerge, mask, solidColor, invert, blur, and the `alpha` export form.
- **Missing in tex at 0.16.0 when I last looked:** `scatter` and `transform`.

## boards/: the delivered boards, partly emitted

| File | export | why commented |
|---|---|---|
| oak-leaves.ts | none (`// Image Exporter "oak-leaves.png": needs Blend "+ Plate Colour"`) | the clump's two Scatters read their Mask input: `// Scatter "Clump Leaves": its Mask input has no OJPlay code yet` (and "Edge Leaves"), so the clump and everything after it is a comment (magerie #1155) |
| birch-leaves.ts | none | same, the birch clump |
| oak-leaves-mass.ts | none (`... needs Gradient Map "Mass Colour"`) | reads Scatter's Random output (`... needs Scatter "Deep Leaves"'s random output`, and "Top Leaves"), #1155 |
| birch-leaves-mass.ts | none | same |

What these files do emit is still code, and can be checked node by node: each leaf stamp, the dome masks, the sprays, plates and the curtain up to the final cell composite.

## stone-face/: the v1.1 stone face with the lichen fix

| File | export const | PNG |
|---|---|---|
| stone-face.ts | `stoneFace` | stone-face.png |
| | `stoneFaceNormal` | stone-face-normal.png |

Its lichen gathers from a tiling noise now, not a gradient. Only the lichen changed from v1.1.

## Per-node dumps: not included

`scripts/ojplay-dumps.sh` writes each output as raw float RGBA: 4 MB an output at 512 and 16 MB at 1024. That is about 280 MB a mass board and 2.7 GB or more for each whole/ board, far over 60 MB. Name the nodes that diverge (by label, from the `.graph.json`) and I'll dump just those.
