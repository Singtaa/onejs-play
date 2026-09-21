/**
 * The dependency list of usePhysics's effect.
 *
 * This reads source rather than behaviour, which is the weaker kind of test,
 * and it is here because the stronger kind is not available: the defect is
 * pure React scheduling, so seeing it needs a mounted component, and oj's
 * suite deliberately does not reach into onejs-react's test fixtures (see
 * pre-setup.ts). What it does cover is the exact way the bug returns.
 *
 * The bug: the list read `[host.current]`. A dependency list is evaluated
 * during RENDER, and a ref for an element the component is about to mount is
 * null then. The effect ran with the ref populated, built the world, and
 * setWorld re-rendered; on that pass the dependency was the element, so React
 * saw the list change, disposed the world and built a second one. Every world
 * was built twice. On the Drop Everything sketch that was 170 GameObjects
 * created and thrown away, and it doubled every per-body warning the engine
 * had to make into 190 console lines before the first frame.
 *
 * Nothing failed. The game played correctly, both times, and the only visible
 * trace was console noise that read as the engine being chatty.
 *
 * `[host.current]` is also what `react-hooks/exhaustive-deps` asks for, so the
 * lint rule actively pushes this back in and the disable comment above the
 * list is load-bearing. That is the regression this guards.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const SOURCE = readFileSync(fileURLToPath(new URL("../physics.ts", import.meta.url)), "utf8")

/** The dependency list of the single useEffect in usePhysics. */
function effectDeps(src: string): string {
    const start = src.indexOf("useEffect(() => {")
    expect(start, "usePhysics no longer contains a useEffect written the way this test reads it").toBeGreaterThan(-1)
    // The list is the last `}, [...])` of the effect: the call's closing line.
    const close = src.indexOf("\n    }, [", start)
    expect(close, "could not find the end of the effect in physics.ts").toBeGreaterThan(start)
    const line = src.slice(close + 1, src.indexOf("\n", close + 1))
    const open = line.indexOf("[")
    return line.slice(open, line.lastIndexOf("]") + 1)
}

describe("usePhysics builds one world, not two", () => {
    it("depends on nothing, so the effect runs once per mount", () => {
        expect(effectDeps(SOURCE)).toBe("[]")
    })

    it("never depends on host.current, which is null during the first render", () => {
        expect(effectDeps(SOURCE)).not.toContain("host.current")
    })

    it("reads the host inside the effect, where refs are populated", () => {
        const body = SOURCE.slice(SOURCE.indexOf("useEffect(() => {"))
        expect(body).toContain("createPhysicsWorld(host.current, config)")
    })

    it("keeps the disable comment that stops lint restoring the dependency", () => {
        expect(SOURCE).toContain("eslint-disable-next-line react-hooks/exhaustive-deps")
    })
})
