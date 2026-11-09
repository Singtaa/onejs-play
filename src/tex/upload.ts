/**
 * Bytes to a texture: RGBA, row 0 at the top as Magerie stores them, read
 * linearly so a byte samples as itself over 255 and not sRGB decoded.
 */
declare const CS: any

export function uploadRGBA(width: number, height: number, rgba: ArrayLike<number>, tile: boolean): unknown {
    const T = CS.UnityEngine
    const texture = new T.Texture2D(width, height, T.TextureFormat.RGBA32, false, true)
    texture.filterMode = T.FilterMode.Bilinear
    texture.wrapMode = tile ? T.TextureWrapMode.Repeat : T.TextureWrapMode.Clamp
    // Magerie's row 0 is the top, Unity's the bottom.
    const flipped = new Uint8Array(rgba.length)
    const row = width * 4
    for (let y = 0; y < height; y++) {
        for (let i = 0; i < row; i++) flipped[(height - 1 - y) * row + i] = rgba[y * row + i]!
    }
    texture.LoadRawTextureData(flipped)
    texture.Apply(false, false)
    return texture
}

export function destroyTexture(texture: unknown): void {
    CS.UnityEngine.Object.Destroy(texture)
}
