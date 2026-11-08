/**
 * Ground as a grid of heights: what `world.heightfield` makes, and its
 * triangles for whatever reads a collider as triangles (`world.nav`,
 * `visibility`).
 *
 * A cart gives heights x fastest from the grid's corner, as it lays out a
 * mesh grid. Rapier keeps them as a column-major matrix whose rows run along
 * z, centred on the collider. The conversion is here and nowhere else, so a
 * cart never meets Rapier's order. Each cell is split from its (x + 1, z)
 * corner to its (x, z + 1) corner, as Rapier splits it (heightfield.test.ts
 * checks a ray against a mesh split so), so the triangles read back are the
 * surface Rapier collides with.
 */

import type { Triangles } from "./gltf"

export interface HeightGrid {
    /** Samples along x and along z, each at least 2. */
    nx: number
    nz: number
    /** Rapier's order: column-major, rows along z. */
    heights: Float32Array
}

/** A cart's heights, x fastest, in Rapier's order; `samples` defaults to a square grid. */
export function heightGrid(heights: ArrayLike<number>, samples?: readonly [number, number]): HeightGrid {
    const n = heights.length
    const side = Math.round(Math.sqrt(n))
    const [nx, nz] = samples ?? [side, side]
    if (!Number.isInteger(nx) || !Number.isInteger(nz) || nx < 2 || nz < 2 || nx * nz !== n) {
        throw new Error(samples === undefined
            ? `[oj] world.heightfield: ${n} heights is not a square grid; give samples: [along x, along z]`
            : `[oj] world.heightfield: samples ${nx} by ${nz} needs ${nx * nz} heights, and there are ${n}`)
    }
    const out = new Float32Array(n)
    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const h = heights[ix + iz * nx]!
            if (!Number.isFinite(h)) throw new Error(`[oj] world.heightfield: height ${ix + iz * nx} is ${h}`)
            out[iz + ix * nz] = h
        }
    }
    return { nx, nz, heights: out }
}

/** A heightfield collider's surface in its own frame, centred, two triangles a cell, facing up. */
export function heightfieldTriangles(c: any): Triangles {
    const heights: Float32Array = c.heightfieldHeights()
    const nz = c.heightfieldNRows() + 1, nx = c.heightfieldNCols() + 1
    const s = c.heightfieldScale()
    const vertices = new Float32Array(nx * nz * 3)
    for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
            const k = (iz + ix * nz) * 3
            vertices[k] = (ix / (nx - 1) - 0.5) * s.x
            vertices[k + 1] = heights[iz + ix * nz]! * s.y
            vertices[k + 2] = (iz / (nz - 1) - 0.5) * s.z
        }
    }
    const indices = new Uint32Array((nx - 1) * (nz - 1) * 6)
    let i = 0
    for (let ix = 0; ix < nx - 1; ix++) {
        for (let iz = 0; iz < nz - 1; iz++) {
            const p00 = iz + ix * nz, p10 = p00 + 1, p01 = p00 + nz, p11 = p01 + 1
            // Split along (x + 1, z) to (x, z + 1), as Rapier splits it, and wound so each faces up, which is what Recast reads as floor.
            indices[i++] = p00; indices[i++] = p10; indices[i++] = p01
            indices[i++] = p10; indices[i++] = p11; indices[i++] = p01
        }
    }
    return { vertices, indices }
}
