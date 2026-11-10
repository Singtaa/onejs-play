# tex parity goldens

`goldens/` holds Magerie's kernel-parity baselines for the nodes tex draws,
copied unchanged from magerie-one at commit `dce81bcd4`
(`js/tests/fixtures/kernel-parity/`). Each `.bin` file is the raw stored bytes
of a Metal readback: RGBA, premultiplied, gamma encoded, row 0 at the top,
`width * height * 4`. `cart/cases.ts` builds the input and the call each one
was recorded from, ported from that commit's `js/tests/kernel-parity.test.tsx`.

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
