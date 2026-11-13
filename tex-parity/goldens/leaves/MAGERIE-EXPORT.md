# PrimoEden leaf cells, on the pcg3d hash

- Exported at magerie-one main `1484d0843` (the pcg3d noise hash, #1251), macOS Metal, 12 Nov 2026, by magerie-one Mac 006 for OneJSv3Container Mac 004 (task 4e97a845).
- Each `.ts` is Magerie's own OJPlay emit at that commit, selection = the board's exporters (the `-3x3` seam-check exporter left out).
- Each `.png` is the Image Exporter's file as the app writes it (`exportImageWithAlpha`): 8-bit RGBA with an sRGB chunk; alpha from the exporter's Alpha input where it is wired, as straight alpha.
- Run twice: every PNG came out byte for byte the same.
- The emitter has moved since the earlier handovers (`ae5c2e0a5`, #1191): a Noise whose Scale Y is locked no longer writes `scaleY`, and a Gradient writes its default `colors`. Nothing else in the emits changed.
- Sources: `whole/<name>.mage` on `primoeden-leaves-tex-check` `298f0e803`.
- Replaces the set from `44d69541b`. Same file names and sizes.
- All four emits differ from that set, by the two emitter changes above only.
