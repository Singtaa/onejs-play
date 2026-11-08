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
