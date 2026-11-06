/**
 * The 2D determinism fixture: the same numbers on every host, or a failing
 * test. The 3D one (src/physics3d/parity.mjs) laid flat, as onejs-physics
 * first wrote it (Tests~/falling-boxes-2d.mjs): 100 boxes dropped on a floor
 * for 300 fixed steps, then every body's position and angle hashed as 64-bit
 * floats. It touches only Rapier's own API, so any host that can load oj's 2D
 * glue can run it: Node, Chrome and workerd agree, and OneJS's native module
 * is held to the same hash.
 *
 *     import { fallingBoxesHash, PARITY } from "./parity.mjs"
 *     fallingBoxesHash(R) === PARITY.hash
 *
 * Changing anything here changes the hash. Don't, unless every host's test
 * moves with it.
 */

export const PARITY = Object.freeze({ boxes: 100, steps: 300, hash: "3a6e8d5a9fd7056c" })

export function fallingBoxesHash(R, n = PARITY.boxes, steps = PARITY.steps) {
    const world = new R.World({ x: 0, y: -9.81 })
    world.createCollider(R.ColliderDesc.cuboid(50, 0.5).setTranslation(0, -0.5))
    const side = Math.ceil(Math.sqrt(n))
    const bodies = []
    for (let i = 0; i < n; i++) {
        const x = (i % side) - side / 2, y = 2 + Math.floor(i / side) * 1.1
        const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x * 1.05 + (i % 3) * 0.01, y).setRotation(0.1))
        world.createCollider(R.ColliderDesc.cuboid(0.5, 0.5).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), b)
        bodies.push(b)
    }
    const queue = new R.EventQueue(true)
    for (let f = 0; f < steps; f++) {
        world.step(queue)
        queue.drainCollisionEvents(() => {})
    }
    let h1 = 0x811c9dc5 >>> 0, h2 = 0x01000193
    for (const b of bodies) {
        const t = b.translation()
        const words = new Uint32Array(new Float64Array([t.x, t.y, b.rotation()]).buffer)
        for (const w of words) {
            h1 = Math.imul(h1 ^ w, 16777619) >>> 0
            h2 = Math.imul(h2 ^ w, 2246822519) >>> 0
        }
    }
    queue.free()
    world.free()
    return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")
}
