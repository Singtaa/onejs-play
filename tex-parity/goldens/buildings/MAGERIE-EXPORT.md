# PrimoEden buildings v1.1, on the pcg3d hash

- Exported at magerie-one main `1484d0843` (the pcg3d noise hash, #1251), macOS Metal, 12 Nov 2026, by magerie-one Mac 006 for OneJSv3Container Mac 004 (task 4e97a845).
- Each `.ts` is Magerie's own OJPlay emit at that commit, selection = the board's exporters (the `-3x3` seam-check exporter left out).
- Each `.png` is the Image Exporter's file as the app writes it (`exportImageWithAlpha`): 8-bit RGBA with an sRGB chunk; alpha from the exporter's Alpha input where it is wired, as straight alpha.
- Run twice: every PNG came out byte for byte the same.
- The emitter has moved since the earlier handovers (`ae5c2e0a5`, #1191): a Noise whose Scale Y is locked no longer writes `scaleY`, and a Gradient writes its default `colors`. Nothing else in the emits changed.
- Sources: `~/Downloads/Magerie game textures/primoeden buildings v1.1/<name>.mage`; `stone-face` is `primoeden leaves v1/stone-face (lichen fix)/stone-face.mage` (the lichen from a tiling noise, as on `primoeden-leaves-tex-check` `298f0e803`).
- Replaces the set from `44d69541b` (`primoeden-buildings-tex-check` `69f20abf3`). Same file names and sizes.
- Emits that differ from that set: planks, planks-6m, plaster, stone (one Noise each, no `scaleY`), timber, timber-6m (three). The rest are the same text.
