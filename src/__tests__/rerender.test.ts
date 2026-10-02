import { describe, it, expect, vi, afterEach } from "vitest"
import { createElement, type ReactElement } from "react"

/**
 * The container's rerender: the mounted cart rendered again, its state kept.
 *
 * What a host calls after swapping something a render reads. The Play editor
 * swaps a `.sl` program into a running preview (the Ghost Hunt dry run, 1 Oct
 * 2026); a ShaderProgram picks a new program up when it renders, and one on an
 * element nothing is re-rendering would otherwise keep drawing the old one.
 * Same root, same component type, a fresh element: React keeps the state and
 * renders every child again.
 */
const rendered: Array<{ element: ReactElement; root: unknown }> = []
vi.mock("onejs-react", async (original) => ({
    ...(await original<object>()),
    render: (element: ReactElement, root: unknown) => { rendered.push({ element, root }) },
}))

const { createRuntime } = await import("../runtime")
const { mount } = await import("../mount")
const { setInputBackend } = await import("onejs-unity/input")

function Cart(_: { n: number }) { return null }
const cartIn = (presented: ReactElement) => (presented.props as { children: ReactElement }).children

afterEach(() => { rendered.length = 0; setInputBackend(null) })

describe("the container's rerender", () => {
    it("renders the mounted cart again into the same root, as a fresh element of the same type", () => {
        const runtime = createRuntime({ root: { fake: "root" }, version: "1.0.0" })
        const cart = createElement(Cart, { n: 1 })
        mount(cart, { theme: false })
        runtime.rerender()
        expect(rendered).toHaveLength(2)
        expect(rendered[1]!.root).toBe(rendered[0]!.root)
        const again = cartIn(rendered[1]!.element)
        expect(again.type).toBe(Cart)
        expect(again.props).toEqual({ n: 1 })
        expect(again).not.toBe(cart)
        runtime.dispose()
    })

    it("does nothing before a mount or after the runtime is gone", () => {
        const runtime = createRuntime({ root: { fake: "root" }, version: "1.0.0" })
        runtime.rerender()
        expect(rendered).toHaveLength(0)
        mount(createElement(Cart, { n: 2 }), { theme: false })
        runtime.dispose()
        runtime.rerender()
        expect(rendered).toHaveLength(1)
    })
})
