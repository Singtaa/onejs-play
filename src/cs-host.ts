/**
 * Whether the host's C# has a type, asked the only ways that can answer.
 *
 * A type C# lacks never reads as undefined on a OneJS host: `CS.OneJS.Gone` is
 * a path proxy whose typeof is "function", and calling into it throws QuickJS's
 * "Type not found". A missing static member of a real type reads one of two
 * ways. Every released OneJS reads it as a path proxy too, so `typeof
 * X.Method === "function"` passes whether the method is there or not, and its
 * call throws "Method not found" (on WebGL too, since OneJS 3.4.3). A OneJS
 * that reads it as undefined (OneJS branch cs-missing-member-undefined) makes
 * its call JS's own TypeError, which names nothing, so a guard says which
 * member it called. What tells on every host is a read of one of the type's
 * static values (a property, a field, or a call that returns one), which is a
 * value on a host that has it and a proxy, undefined or a throw on one that
 * does not.
 *
 * A copy of onejs-unity's src/cs-host.ts (6422972), kept until this package's
 * onejs-unity peer is a release that exports it.
 */

/**
 * Whether `e` is the host saying `type`, or a method of it, is not in its C#:
 * QuickJS's "Type not found" or "Method not found", or, given the `member`
 * that was called, the TypeError of calling it where it reads undefined.
 */
export function csMissing(e: unknown, type: string, member?: string): boolean {
    const message = e instanceof Error ? e.message : String(e)
    if (message.includes(`[QuickJS] Method not found: ${type}.`) || new RegExp(`\\[QuickJS\\] Type not found: ${type.replace(/\./g, "\\.")}(?![\\w.])`).test(message)) return true
    // By name, not instanceof: a cart's TypeError can come from another realm on WebGL.
    return member !== undefined && (e as { name?: unknown } | null)?.name === "TypeError" && staticOf(type, member) === undefined
}

/** `CS.<type>.<member>` as the host reads it. */
function staticOf(type: string, member: string): unknown {
    let at: any = (globalThis as any).CS
    for (const key of type.split(".")) {
        if (at === undefined || at === null) return undefined
        at = at[key]
    }
    return at === undefined || at === null ? undefined : at[member]
}

/**
 * Whether the host's C# has `type`, by `read`, which reads one of its static
 * values or makes a call that returns one: false with no CS, or when the read
 * gives undefined, a path proxy, or the host's not-found for the type. A read
 * that calls a method names it as `member`, as csMissing takes it.
 */
export function csHas(type: string, read: () => unknown, member?: string): boolean {
    if ((globalThis as any).CS === undefined) return false
    let value: unknown
    try {
        value = read()
    } catch (e) {
        if (csMissing(e, type, member)) return false
        throw e
    }
    return value !== undefined && !(typeof value === "function" && (value as any).__csPathProxy === true)
}
