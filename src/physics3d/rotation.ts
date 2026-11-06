/**
 * Degrees as the scene names them, and quaternions as the engine keeps them.
 *
 * `yaw`, `pitch` and `roll` mean what they mean on an Actor, which is Unity's
 * `Quaternion.Euler(pitch, yaw, roll)`: roll about z first, then pitch about x,
 * then yaw about y. Yaw 90 turns +z (forward) to +x. The algebra is the
 * standard one, so the same quaternion means the same turn to Unity and to the
 * engine.
 */

import type { Rotation, Vec3 } from "../models"

export interface Quat { x: number, y: number, z: number, w: number }

const RAD = Math.PI / 180

export function toQuat(r: Partial<Rotation> | undefined): Quat {
    const hy = ((r?.yaw ?? 0) * RAD) / 2, hx = ((r?.pitch ?? 0) * RAD) / 2, hz = ((r?.roll ?? 0) * RAD) / 2
    const cy = Math.cos(hy), sy = Math.sin(hy), cx = Math.cos(hx), sx = Math.sin(hx), cz = Math.cos(hz), sz = Math.sin(hz)
    // qy * qx * qz
    return {
        w: cy * cx * cz + sy * sx * sz,
        x: cy * sx * cz + sy * cx * sz,
        y: sy * cx * cz - cy * sx * sz,
        z: cy * cx * sz - sy * sx * cz,
    }
}

export function fromQuat(q: Quat): Readonly<Rotation> {
    const { x, y, z, w } = q
    const m02 = 2 * (x * z + w * y), m12 = 2 * (y * z - w * x), m22 = 1 - 2 * (x * x + y * y)
    const m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z)
    const pitch = Math.asin(Math.max(-1, Math.min(1, -m12)))
    let yaw: number, roll: number
    if (Math.abs(m12) < 0.999999) {
        yaw = Math.atan2(m02, m22)
        roll = Math.atan2(m10, m11)
    } else {
        // Straight up or down: yaw and roll turn about the same axis, so all of it is yaw.
        const m00 = 1 - 2 * (y * y + z * z), m20 = 2 * (x * z - w * y)
        yaw = Math.atan2(-m20, m00)
        roll = 0
    }
    return Object.freeze({ yaw: tidy(yaw / RAD), pitch: tidy(pitch / RAD), roll: tidy(roll / RAD) })
}

/** Rounds away float noise, so a body turned by 90 reads back 90. */
function tidy(deg: number): number {
    const r = Math.round(deg * 1e6) / 1e6
    return r === 0 ? 0 : r
}

/** A vector turned by a quaternion. */
export function rotate(q: Quat, v: Readonly<Vec3>): Vec3 {
    const { x, y, z, w } = q
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0])
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
