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
