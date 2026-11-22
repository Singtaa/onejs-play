import { afterEach, describe, expect, it, vi } from "vitest"
import { placeElements, setElementPlacer } from "../elements"
import { fakeCS } from "../../__tests__/fake-cs"

/** UI Toolkit's style values, enough to read back what one-by-one wrote. */
const ui = () => ({
    StyleTranslate: class { constructor(public translate: any) {} },
    Translate: class { constructor(public x: any, public y: any) {} },
    Length: class { constructor(public value: number) {} },
    StyleRotate: class { constructor(public rotate: any) {} },
    Rotate: class { constructor(public angle: number) {} },
    Angle: { Degrees: (d: number) => d },
})

const element = () => ({ layout: { width: 10, height: 20 }, style: {} as any })

afterEach(() => {
    setElementPlacer(null)
    delete (globalThis as any).CS
})

describe("placeElements", () => {
    // ElementPlacer came with OneJS 3.9.19. Before it, its name reads as a path proxy, so asking whether
    // PlaceMany is a function said yes and the first move threw "Type not found" (Tachi 32b68430).
    it("places one element at a time on a OneJS from before ElementPlacer", () => {
        ;(globalThis as any).CS = fakeCS({ "UnityEngine.UIElements": ui() })
        const e = element()
        placeElements([{ element: e, at: [100, 50], degrees: 30 }])
        expect(e.style.translate.translate.x.value).toBe(95)
        expect(e.style.translate.translate.y.value).toBe(40)
        expect(e.style.rotate.rotate.angle).toBe(30)
    })

    it("places every element in one PlaceMany where OneJS has ElementPlacer", () => {
        const PlaceMany = vi.fn()
        ;(globalThis as any).CS = fakeCS({ "UnityEngine.UIElements": ui(), "OneJS.ElementPlacer": { Count: 0, Register: () => 4, PlaceMany } })
        const a = element(), b = element()
        placeElements([{ element: a, at: [1, 2], degrees: null }, { element: b, at: [3, 4], degrees: 90 }])
        expect(PlaceMany).toHaveBeenCalledOnce()
        expect(Array.from(PlaceMany.mock.calls[0]![0] as Float32Array)).toEqual([4, 1, 2, 0, 4, 3, 4, 90])
        expect(a.style).toEqual({})
    })
})
