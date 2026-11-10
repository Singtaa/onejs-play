/**
 * `scene.texture` and `scene.depth`, as the calls they make on OneJS's ModelBridge
 * (AcquireSceneTexture and ReleaseSceneTexture, AcquireSceneDepth and
 * ReleaseSceneDepth, tested in OneJS's SceneTextureEditModeTests and
 * SceneDepthEditModeTests). How a program borrows and gives it back is
 * onejs-react's lent texture, tested there (lent-texture.test.tsx); this is
 * the lender's half: it counts its own readers, so a release after its scene
 * is gone, or one too many, never takes a reader from the scene that is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { isLentTexture } from "onejs-react"
import { createScene } from "../models"

type Call = [string, ...unknown[]]

let calls: Call[]
let savedCS: unknown
const TEXTURE = { name: "OneJS Scene" }
const DEPTH = { name: "OneJS Scene Depth" }

// Every ModelBridge method, recorded; `without` names ones an older OneJS lacks.
function bridge(without: string[] = []): any {
    return new Proxy({}, {
        get(_t, name: string) {
            if (without.includes(name)) return undefined
            return (...args: unknown[]) => {
                calls.push([name, ...args])
                if (name === "AcquireSceneTexture") return TEXTURE
                if (name === "AcquireSceneDepth") return DEPTH
                return undefined
            }
        },
    })
}

const of = (name: string) => calls.filter((c) => c[0] === name).length

const disposals: (() => void)[] = []
function scene() {
    const made = createScene()
    disposals.push(made.dispose)
    return made
}

beforeEach(() => {
    calls = []
    savedCS = (globalThis as any).CS
    ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: bridge() } } }
})

afterEach(() => {
    for (const d of disposals.splice(0)) d()
    ;(globalThis as any).CS = savedCS
    vi.restoreAllMocks()
})

describe("scene.texture", () => {
    it("is a lent texture, the same one every read, that nothing can change", () => {
        const { scene: s } = scene()
        expect(isLentTexture(s.texture)).toBe(true)
        expect(s.texture).toBe(s.texture)
        expect(Object.isFrozen(s.texture)).toBe(true)
    })

    it("asks for nothing until a reader acquires it", () => {
        const { scene: s } = scene()
        void s.texture
        expect(of("AcquireSceneTexture")).toBe(0)
        expect(of("ReleaseSceneTexture")).toBe(0)
    })

    it("lends the bridge's texture to each reader and gives each one back", () => {
        const { scene: s } = scene()
        expect(s.texture.acquire()).toBe(TEXTURE)
        expect(s.texture.acquire()).toBe(TEXTURE)
        expect(of("AcquireSceneTexture")).toBe(2)
        s.texture.release()
        s.texture.release()
        expect(of("ReleaseSceneTexture")).toBe(2)
    })

    it("ignores a release too many, so the bridge's count is never taken below its readers", () => {
        const { scene: s } = scene()
        s.texture.acquire()
        s.texture.release()
        s.texture.release()
        s.texture.release()
        expect(of("ReleaseSceneTexture")).toBe(1)
    })

    it("lends nothing once its scene is gone, and a reader giving it back then costs the next scene nothing", () => {
        const first = scene()
        first.scene.texture.acquire()
        first.dispose()
        // DisposeAll took the texture and the bridge's count with it.
        expect(first.scene.texture.acquire()).toBeNull()
        const next = scene()
        next.scene.texture.acquire()
        first.scene.texture.release()
        first.scene.texture.release()
        expect(of("ReleaseSceneTexture")).toBe(0)
        expect(of("AcquireSceneTexture")).toBe(2)
        next.scene.texture.release()
        expect(of("ReleaseSceneTexture")).toBe(1)
    })

    it("says once that an older OneJS cannot draw the scene into a texture, lending nothing", () => {
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: bridge(["AcquireSceneTexture", "ReleaseSceneTexture"]) } } }
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { scene: s } = scene()
        expect(s.texture.acquire()).toBeNull()
        expect(s.texture.acquire()).toBeNull()
        s.texture.release()
        expect(warn.mock.calls.filter((c) => String(c[0]).includes("scene.texture needs a newer OneJS"))).toHaveLength(1)
        expect(calls.some((c) => c[0] === "ReleaseSceneTexture")).toBe(false)
    })
})

describe("scene.depth", () => {
    it("is a lent texture of its own, asking for nothing until read", () => {
        const { scene: s } = scene()
        expect(isLentTexture(s.depth)).toBe(true)
        expect(s.depth).toBe(s.depth)
        expect(s.depth).not.toBe(s.texture)
        expect(Object.isFrozen(s.depth)).toBe(true)
        expect(of("AcquireSceneDepth")).toBe(0)
    })

    it("lends the bridge's depth and counts its readers apart from the texture's", () => {
        const { scene: s } = scene()
        expect(s.depth.acquire()).toBe(DEPTH)
        expect(s.texture.acquire()).toBe(TEXTURE)
        s.depth.release()
        s.depth.release()
        expect(of("ReleaseSceneDepth")).toBe(1)
        expect(of("ReleaseSceneTexture")).toBe(0)
    })

    it("lends nothing once its scene is gone", () => {
        const first = scene()
        first.scene.depth.acquire()
        first.dispose()
        expect(first.scene.depth.acquire()).toBeNull()
        first.scene.depth.release()
        expect(of("ReleaseSceneDepth")).toBe(0)
    })

    it("says once that an older OneJS cannot draw the depth, while scene.texture still works", () => {
        ;(globalThis as any).CS = { OneJS: { Models: { ModelBridge: bridge(["AcquireSceneDepth", "ReleaseSceneDepth"]) } } }
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const { scene: s } = scene()
        expect(s.depth.acquire()).toBeNull()
        expect(s.depth.acquire()).toBeNull()
        s.depth.release()
        expect(warn.mock.calls.filter((c) => String(c[0]).includes("scene.depth needs a newer OneJS"))).toHaveLength(1)
        expect(s.texture.acquire()).toBe(TEXTURE)
    })
})
