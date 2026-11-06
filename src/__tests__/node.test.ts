import "../node"
import { createWorld, shape } from "../index"

describe("ojplay/node", () => {
    it("gives a test physics and paths with nothing handed over by hand", async () => {
        const world = await createWorld()
        world.box({ at: [0, -0.5, 0], size: [10, 1, 10] })
        world.box({ at: [0, 1, 0], size: [6, 2, 0.5] })
        world.step()
        expect(world.raycast([0, 1, -3], [0, 1, 3])?.distance).toBeCloseTo(2.75)
        const nav = await world.nav()
        expect(nav.path([0, 0, -2], [0, 0, 2]).length).toBeGreaterThan(1)
    })

    it("lets a test import oj itself", () => {
        expect(shape.sphere(1).kind).toBe("sphere")
    })
})
