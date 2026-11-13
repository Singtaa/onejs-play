# tex parity goldens

`goldens/` holds Magerie's kernel-parity baselines for the nodes tex draws,
copied unchanged from magerie-one at commit `dce81bcd4`
(`js/tests/fixtures/kernel-parity/`). Each `.bin` file is the raw stored bytes
of a Metal readback: RGBA, premultiplied, gamma encoded, row 0 at the top,
`width * height * 4`. `cart/cases.ts` builds the input and the call each one
was recorded from, ported from that commit's `js/tests/kernel-parity.test.tsx`.

`goldens/noise/` is from magerie-one main at `1484d0843` (#1251), where
Noise's lattice hash became pcg3d and all twelve baselines were recorded
again; tex draws each byte for byte. `goldens/buildings`, `goldens/leaves`
and `goldens/atlas` were exported again at that commit (handed over on
magerie-one `primoeden-tex-check-pcg3d` at `5c7cc649d`; each folder's
`MAGERIE-EXPORT.md` is theirs), every `.ts` and PNG replacing the older
set named below. On 12 Nov 2026 buildings passes 22 of 22; the three birch
boards fail the cutout (leaves' spray 203 px and curtain 515, atlas's
birch-leaves 718, against 105) with their means under 0.06, which is open.

To refresh them, copy the same folders from a newer magerie-one, change the
commit above, and run `node run.mjs`: a golden that moved is a Magerie change
to look at, not a number to accept.

`goldens/ojplay/` is the set Magerie records for tex (its
`js/tests/fixtures/kernel-parity/ojplay/`), described by its own
`manifest.json`, whose `magerieCommit` says where it came from. Sets C, D
and E (Tile Grid, cases 70 to 88) are on magerie-one main at `8f34a17d6`,
byte for byte as vendored here; set E's float cases are held to 1/8192,
which an 8-bit or half-float picture fails. An output whose
`format` is `rgba32f` is little-endian float32 RGBA, `width * height * 16`
bytes, read back in float, and its tolerance is in stored value, not bytes.

The set's sdfShape cases are from magerie-one `4f1e3d32c`, which draws a
shape by one layout rule: each side on -1 to 1 less twice the offset, then
scaled by the side over the long side, so the long side spans -1 to 1 and a
unit is half the long side in pixels both ways (antialiasing, distance and
edge band alike). `iso-*` pin that rule off square, each with its distance
twin. `vesica-broad-96x64` and `vesica-needle-72x14` carry `stretch: true`,
the per-axis space every shape was drawn in before it, where a unit is half
the short side; their pixels did not move. On a square the two are one, and
every square case is byte for byte as it was.

`goldens/buildings/` is eleven of Magerie's building textures as its OJPlay
exporter writes them: each board's `.ts` and the PNGs Magerie exported from
the same board, from magerie-one `44d69541b` (handed over on the
`primoeden-buildings-tex-check` branch at `69f20abf3`; its
`MAGERIE-README.md` is theirs). `node run.mjs --buildings` draws each file
through tex and compares every export with its PNG, held to the Look tier
`buildings.json` states with its reason. The `.ts` files are Magerie's and
are not edited here: a difference is fixed in tex or reported to Magerie.

A board's per-node dump (`scripts/ojplay-dumps.sh` in magerie-one: a
`manifest.json` and each node's stored bytes, float32 where the node is
32-bit) is what `--chain <folder>` reads, to find the node where a texture
first leaves Magerie's. Dumps are too large to vendor; shingles' and
thatch's are on that branch at `3e32efec3`. `stone-face` was refreshed from
`primoeden-leaves-tex-check` `298f0e803`: v1.1's board with the lichen
drawn from a tiling noise, the same Magerie commit.

`goldens/leaves/` is four of Magerie's PrimoEden leaf atlas cells, one board
a cell, from magerie-one `44d69541b` (handed over on
`primoeden-leaves-tex-check` at `298f0e803`; `MAGERIE-README.md` is
theirs, and says why the delivered atlas boards do not emit whole yet).
`node run.mjs --set leaves` compares them as `--buildings` does, and also
counts the pixels whose alpha falls on the other side of 0.5 from Magerie's,
since a leaf is drawn cut out there; `leaves.json` has the limit and why.

`goldens/atlas/` is Magerie's four PrimoEden leaf atlas boards emitted whole
by magerie-one `fix/ojplay-truthful-win003` at `cefa1f516` (#1196, #1155),
with the PNGs from `primoeden-leaves-tex-check` `298f0e803`. The two mass
boards carry their own Look in `atlas.json`, with why. `buildings/thatch.ts`
is the same commit's emit; the other building emits were byte for byte
what was here, and its `stone-face` predates the lichen fix, so it was kept.

`goldens/sdf/` is sdfShape's signed distance (tex's `.sdf`, Magerie's
`out-distance`) as Magerie itself stores it: a circle off centre at 256 by
256 and a needle vesica turned 45 degrees at 128 by 128, dumped by
magerie-one `ea7b1ae92` (main `396dc943a` plus #1199, which does not touch
sdfShape) on Windows D3D11, each with its 8-bit picture. Its
`manifest.json` is in `goldens/ojplay`'s format and a plain `node run.mjs`
draws it with the rest, as `sdf/<name>` and `sdf/<name>-distance`. The
distance is float32, in pixels, positive inside, and is held to one
half-float step of the value (`halfSteps: 1`): tex stores it in halves, and
a GPU that truncates a half (D3D) and one that rounds it (SwiftShader)
differ by exactly that. Measured on 10 Nov 2026 the largest difference was
0 and 0.008 on this GPU, 0.125 and 0.031 on SwiftShader, every value
inside its step; `--plant sdf` (every shape 0.2% too large) fails all four
on both.

The same dump held two more shapes, which are not vendored because tex
and Magerie's Windows build disagree on them, on both backends alike: a
rotated ellipse (the distance up to 0.067 px apart at the edge, the picture
up to 8 levels at 22 pixels; tex differs from itself by as much between
GPU and SwiftShader, so the ellipse's solver is where it comes from) and a
192 by 128 vesica (two pixels on the line where Magerie's formula changes
sign, where the two take opposite sides). The dump is
`D:/handoff/magerie-win003-sdfshape-ea7b1ae92/chain-dumps/sdf-shapes` on
the Windows PC; both are magerie-one issue 1201
(https://gitea.magerie.com/rootroot/magerie-one/issues/1201).
