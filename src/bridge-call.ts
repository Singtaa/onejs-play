/**
 * Calls on OneJS's ModelBridge that an older OneJS lacks, made so the older
 * one gets what it can do instead of an error.
 */

import { csMissing } from "./cs-host"

/** The methods each ModelBridge has said it lacks, so an older host is asked once. */
const lackedBy = new WeakMap<object, Set<string>>()

/**
 * `call()`, which calls ModelBridge's `method`, or `older()` on a OneJS whose ModelBridge lacks it.
 * Every released OneJS reads a missing method as a path proxy, so `typeof` says "function" there and
 * only the call's "Method not found" tells (cs-host.ts); a OneJS that reads a missing static as
 * undefined is the other shape, which `typeof` answers before any call. Make one call of `method`
 * in `call`, and nothing else on b.
 */
export function bridgeCall<T>(b: any, method: string, call: () => T, older: () => T): T {
    if (typeof b[method] !== "function" || lackedBy.get(b)?.has(method) === true) return older()
    try {
        return call()
    } catch (e) {
        if (!csMissing(e, "OneJS.Models.ModelBridge", method)) throw e
        let lacked = lackedBy.get(b)
        if (lacked === undefined) lackedBy.set(b, lacked = new Set())
        lacked.add(method)
        return older()
    }
}

/** What each ModelBridge has answered bridgeHas, so a host is asked once a method. */
const hasBy = new WeakMap<object, Map<string, boolean>>()

/**
 * Whether ModelBridge has `method`, by `ask`, one call of it that changes nothing: an empty
 * array, or an id that names nothing. For a choice made before anything is sent.
 */
export function bridgeHas(b: any, method: string, ask: () => unknown): boolean {
    let known = hasBy.get(b)
    if (known === undefined) hasBy.set(b, known = new Map())
    let has = known.get(method)
    if (has === undefined) known.set(method, has = bridgeCall(b, method, () => { ask(); return true }, () => false))
    return has
}
