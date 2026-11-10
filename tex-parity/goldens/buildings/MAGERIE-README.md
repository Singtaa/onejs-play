# PrimoEden buildings v1.1 (9 Nov 2026)

Made in Magerie (main 44d69541b) for primoeden-three Mac 002's building restyle (Tachi d7554af3 and bab42e46; specs bd59c8e6, cart notes a64a9508 and c88757a3).
Each texture is a graph:
- `<name>.mage` opens in main (storage user version 2);
- `<name>.graph.json` lists every node and wire;
- `<name>.ts` is OJPlay `tex` code from Magerie's own emitter.

## What changed from v1

| File | Change | Why |
|---|---|---|
| planks-6m (new) | 512 x 512, 6 x 6 m: 8 boards, 2 butt joints a row. Neighbouring rows' joints 0.96 m or more apart, rows two apart 0.43 m or more, uneven steps (no staircase). | Mac 002: the 3 m tile shows as a grid on floors at 5 m |
| timber-6m (new) | 256 x 1024, 1.5 x 6 m: the same timber, with knots and splits repeating every 6 m instead of 3 | Tachi: the knots repeat at the same height on a long beam |
| plaster | No large flaked patch. Many small ochre flakes instead (the same flake scale Mac 002 liked at 8 m), fainter cracks, blotch tone 0.9 to 0.55 | Tachi: the brown patch was the one shape the eye found, a grid of stains at 2x2 |
| plaster-daub-decal (new) | 256 x 256 decal, not tiling: one place where the wash broke away to the straw daub, about 1.3 m across, with a chipped wash lip. Alpha covers the break and the lip. | For the kit to place now and then over the plaster |
| stone-face (new) | 128 x 128, tiling at 1.5 m. One stone's surface, no courses or joints: hewn lumps, chisel marks in patches, pits, warm and cool greys, a little lichen low (v near 1; the gradient wraps, so a trace sits at the top edge) | Mac 002: for stones modelled one by one |
| thatch | A dark shadow under each layer's lip, saturation 0.66 to 0.54, a few warm-grey weathered streaks down the slope | Mac 002: one flat golden sheet |
| planks, timber, stone, shingles, earth | Unchanged (byte-identical to v1) | |

The coursed `stone` stays for flat walls and paving.

## Files

| File | Size | Tile | Notes |
|---|---|---|---|
| planks | 256 x 256 | 3 x 3 m | 4 boards (0.75 m), one butt joint a row |
| planks-6m | 512 x 512 | 6 x 6 m | 8 boards, two joints a row; for floors |
| timber | 256 x 512 | 1.5 m (u) x 3 m (v) | grain along v; value 0.28 |
| timber-6m | 256 x 1024 | 1.5 m (u) x 6 m (v) | for beams longer than 3 m |
| plaster | 256 x 256 | 3 x 3 m | cream lime wash, small ochre flakes, hairline cracks |
| plaster-daub-decal | 256 x 256 | decal, 3 m square | RGBA, alpha is the decal; no -3x3 |
| stone | 256 x 256 | 3 x 3 m | 7 courses, for unmodelled walls and paving |
| stone-face | 128 x 128 | 1.5 x 1.5 m | one stone's face, for modelled stones |
| shingles | 256 x 256 | 3 x 3 m | image top = ridge |
| thatch | 256 x 256 | 3 x 3 m | image top = ridge; 6 layers |
| earth | 256 x 256 | 4 x 4 m (64 px/m) | packed earth |

- Colour: opaque RGBA except the decal. Flat-lit: no light in the bake, only painted cavity and worn edges. Top and bottom half luma within 5% on every tiling texture.
- `-normal.png`: OpenGL, green up, from the same height. Magerie's Normal Map has Flip Y on for this (#1181).
- `-3x3.png`: the seam check (3x nearest, tiled 3x3).
- The contact sheet shows each texture tiled to 512 at 1:1, with its normal map below. The decal is shown over the plaster.

## OJPlay: running the emitted code in OJPlay's own tex

I built each `.ts` into a cart and drew it in headless Chrome:
- on runtime 1.7.0, the published container;
- on the 9.9.99 dev runtime, the newest local build of the 1.8 stack. onejs-play main (0.16.0) has the same tex source as the published 0.16.0 package.

Every picture's bytes were compared with Magerie's PNG. A shim logged each missing node or option and stood in for it, so every file ran to the end. Both runtimes gave identical results.

Missing in tex:
1. **`scatter`**: no such node. It is used by planks, planks-6m, timber, timber-6m and earth (knots, splits, pebbles). Magerie's side of a scatter emit is #1155.
2. **`noise` option `bitDepth`**: tex's Noise takes no Bit Depth. All eleven files use `bitDepth: "32"` on some Noise (13 calls across the seven v1 files). tex refuses the option and stops the file. Tile Grid's `bitDepth` is accepted.
3. **`resize`**: not used here, because I built everything at the delivery size to avoid it (#1185).

Draws without the missing parts. Mean byte difference against Magerie:
- stone 0.04, plaster 2.8, earth 3.1, stone-face 1.7, decal 0.6;
- shingles 9.4, thatch 15, planks 17, timber 18 (these four lose scatter or depend most on stretched 32-bit noise).

Not traced further. tex also reports `edges` instead of `tiles` for stone-face's colour, planks, timber and earth: its `gradient` is never tiling, so whatever a Gradient feeds stops tiling there.

## Friction (filed as magerie issues)

1. Normal Map writes DirectX green by default: #1181.
2. 8-bit generator dither amplified into stripes, nothing hints at Bit Depth: #1183 (bears on height-precision.md section 8, question 1).
3. Flood Fill has no wrap: #1184.
4. Resize has no OJPlay op: #1185.
5. Tile Grid's UV is one RG image: #1186.
6. No "distance from a value" op (|x - c|): #1187.
7. Tile Grid has one joint width: #1188.
8. Tile Grid's stagger takes a seed search. The v1 claim that offsets "only tile at multiples of 1/rows" was wrong: the texture tiles either way; only a regular stagger changes step at the seam. #1189.
9. White noise Scale is cells across: #1190.

`tools/joints.mjs` computes Tile Grid joint positions with the JS twin's maths; `tools/s2.mjs` is the search that chose planks-6m's layout (`node s2.mjs`).
