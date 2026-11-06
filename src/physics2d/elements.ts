/**
 * How a 2D world moves the elements its bodies carry.
 *
 * An element is placed so its centre is on its body's centre and it turns
 * with the body: `translate` from where layout put it (absolute, at its
 * parent's top left, which the world takes as its origin) and `rotate`, both
 * applied at draw time, so no body moves the layout. A slot, like 3D's actor
 * placer, so a world never needs Unity: a room script has no elements, and a
 * test hands in its own.
 *
 * In a container every element moves in one crossing: OneJS's ElementPlacer
 * keeps each element under a number, and `PlaceMany` takes every number,
 * centre and angle in one array. A OneJS without it gets two style writes an
 * element.
 */

import type { RefObject } from "react"
import type { Vec2 } from "./world"

declare const CS: any

/** A UI element, or a ref to one, as `ref={...}` hands it to a component. */
export type ElementActor = object | RefObject<unknown>

export interface ElementPlacement {
    element: object
    /** Its centre, in stage pixels. */
    at: Vec2
    /** Degrees, clockwise; null leaves it unturned. */
    degrees: number | null
}

/** The element a ref points at now, or the element itself. Null until a ref is filled. */
export function resolveElement(actor: ElementActor): object | null {
    if ("current" in actor) return (actor as RefObject<unknown>).current as object | null
    return actor
}

const ids = new WeakMap<object, number>()

function batched(list: readonly ElementPlacement[]): void {
    const bridge = CS.OneJS.ElementPlacer
    const data = new Float32Array(list.length * 4)
    let n = 0
    for (const { element, at, degrees } of list) {
        let id = ids.get(element)
        if (id === undefined) {
            id = bridge.Register(element) as number
            ids.set(element, id)
        }
        data[n++] = id
        data[n++] = at[0]
        data[n++] = at[1]
        data[n++] = degrees ?? 0
    }
    bridge.PlaceMany(data)
}

function oneByOne(list: readonly ElementPlacement[]): void {
    const U = CS.UnityEngine.UIElements
    for (const { element, at, degrees } of list) {
        const e = element as any
        const w = e.layout?.width ?? 0, h = e.layout?.height ?? 0
        e.style.translate = new U.StyleTranslate(new U.Translate(new U.Length(at[0] - (w || 0) / 2), new U.Length(at[1] - (h || 0) / 2)))
        if (degrees !== null) e.style.rotate = new U.StyleRotate(new U.Rotate(U.Angle.Degrees(degrees)))
    }
}

let placer: ((list: readonly ElementPlacement[]) => void) | null = null

export function placeElements(list: readonly ElementPlacement[]): void {
    if (list.length === 0) return
    if (placer === null) {
        let hasBatch = false
        try { hasBatch = typeof CS !== "undefined" && typeof CS.OneJS.ElementPlacer.PlaceMany === "function" } catch { hasBatch = false }
        placer = hasBatch ? batched : oneByOne
    }
    placer(list)
}

/** Replaces how elements are moved: a test, or a host with its own way. */
export function setElementPlacer(next: ((list: readonly ElementPlacement[]) => void) | null): void {
    placer = next
}
