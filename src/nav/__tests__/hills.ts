// Ground for the tiled nav's and the heightfield's tests and the world-scale bench.

/** Rolling hills, metres, as PrimoEden's terrain rolls: a few metres over tens. */
export function hill(x: number, z: number): number {
    return 2 * Math.sin(x / 23) * Math.cos(z / 17) + 1.5 * Math.sin((x + z) / 31) + 0.5 * Math.sin(x / 7.3 + 1) * Math.sin(z / 5.9)
}

/** A chunk's heights on a 2 m grid, x fastest, from its corner. */
export function hills(x0: number, z0: number, n = 33, step = 2): Float32Array {
    const out = new Float32Array(n * n)
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) out[ix + iz * n] = hill(x0 + ix * step, z0 + iz * step)
    return out
}
