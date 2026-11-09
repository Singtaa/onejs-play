// primoeden-three's ground step (tools/grain-textures.mjs) as tex lines, for
// the ground cart to bake on 1.7 instead of shipping the PNGs: grey round
// 0.9, as far from it as the picture is from its own mean, times spread, with
// the height in alpha. The palette owns the colour, so only light and dark
// are kept. run.mjs --ground holds it to the shipped pictures.
import { type TexImage } from "oj"

const MEAN = 0.9

export async function grain(lit: TexImage, height: TexImage, spread = 1): Promise<TexImage> {
    const grey = lit.gradientMap(["#000000", "#ffffff"])
    // The picture's own mean: one number, read back once.
    const bytes = await grey.pixels()
    let sum = 0
    for (let i = 0; i < bytes.length; i += 4) sum += bytes[i]!
    const mean = sum / (bytes.length / 4) / 255
    // MEAN + (l - mean) * spread, clamped, is a straight line: Levels draws
    // the part of it that lands between 0 and 1.
    const at = (l: number) => MEAN + (l - mean) * spread
    const inputBlack = Math.max(mean - MEAN / spread, 0)
    const inputWhite = Math.min(mean + (1 - MEAN) / spread, 1)
    return grey.levels({ inputBlack, inputWhite, outputBlack: at(inputBlack), outputWhite: at(inputWhite) }).alpha(height)
}
