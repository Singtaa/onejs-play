/**
 * The determinism fixture: the same numbers on every host, or a failing test.
 *
 * 100 boxes dropped on a floor for 300 fixed steps, then every body's position
 * and rotation hashed as 64-bit floats. It touches only Rapier's own API, so
 * any host that can load oj's glue can run it: Node, Chrome and workerd agreed
 * with Cloudflare's x86 on 5 Nov 2026 (PlaySite/docs/physics.md §3.3), and
 * OneJS's native module is held to the same hash.
 *
 *     import { fallingBoxesHash, PARITY } from "./parity.mjs"
 *     fallingBoxesHash(R) === PARITY.hash
 *
 * Changing anything here changes the hash. Don't, unless every host's test
 * moves with it.
 */

export const PARITY = Object.freeze({ boxes: 100, steps: 300, hash: "14949dab8b8ba85d" })

export function fallingBoxesHash(R, n = PARITY.boxes, steps = PARITY.steps) {
    const world = new R.World({ x: 0, y: -9.81, z: 0 })
    world.createCollider(R.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0))
    const side = Math.ceil(Math.cbrt(n))
    const bodies = []
    for (let i = 0; i < n; i++) {
        const x = (i % side) - side / 2, y = 2 + Math.floor(i / (side * side)) * 1.1, z = (Math.floor(i / side) % side) - side / 2
        const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x * 1.05 + (i % 3) * 0.01, y, z * 1.05).setRotation({ x: 0.1, y: 0, z: 0, w: 0.995 }))
        world.createCollider(R.ColliderDesc.cuboid(0.5, 0.5, 0.5).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), b)
        bodies.push(b)
    }
    const queue = new R.EventQueue(true)
    for (let f = 0; f < steps; f++) {
        world.step(queue)
        queue.drainCollisionEvents(() => {})
    }
    let h1 = 0x811c9dc5 >>> 0, h2 = 0x01000193
    for (const b of bodies) {
        const t = b.translation(), q = b.rotation()
        const words = new Uint32Array(new Float64Array([t.x, t.y, t.z, q.x, q.y, q.z, q.w]).buffer)
        for (const w of words) {
            h1 = Math.imul(h1 ^ w, 16777619) >>> 0
            h2 = Math.imul(h2 ^ w, 2246822519) >>> 0
        }
    }
    queue.free()
    world.free()
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
}
