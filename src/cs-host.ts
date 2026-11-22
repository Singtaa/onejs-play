/**
 * Whether the host's C# has a type, asked the only ways that can answer.
 *
 * A name C# lacks never reads as undefined on a OneJS host: `CS.OneJS.Gone`
 * and a missing member of a real type are path proxies whose typeof is
 * "function", so `found === undefined` and `typeof X.Method === "function"`
 * pass whether X is there or not. What tells is a read of one of the type's
 * static values (a property, a field, or a call that returns one), which is a
 * value on a host that has it and a proxy or a throw on one that does not, and
 * a call, which throws QuickJS's "Type not found" or "Method not found" (on
 * WebGL too, since OneJS 3.4.3).
 *
 * A copy of onejs-unity's src/cs-host.ts (6422972), kept until this package's
 * onejs-unity peer is a release that exports it.
 */

/** Whether `e` is QuickJS saying `type`, or a method of it, is not in this host's C#. */
export function csMissing(e: unknown, type: string): boolean {
    const message = e instanceof Error ? e.message : String(e)
    return message.includes(`[QuickJS] Method not found: ${type}.`) || new RegExp(`\\[QuickJS\\] Type not found: ${type.replace(/\./g, "\\.")}(?![\\w.])`).test(message)
}

/**
 * Whether the host's C# has `type`, by `read`, which reads one of its static
 * values or makes a call that returns one: false with no CS, or when the read
 * gives undefined, a path proxy, or QuickJS's not-found for the type.
 */
export function csHas(type: string, read: () => unknown): boolean {
    if ((globalThis as any).CS === undefined) return false
    let value: unknown
    try {
        value = read()
    } catch (e) {
        if (csMissing(e, type)) return false
        throw e
    }
    return value !== undefined && !(typeof value === "function" && (value as any).__csPathProxy === true)
}
