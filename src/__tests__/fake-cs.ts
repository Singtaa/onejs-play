/**
 * How a host reads a static member its type lacks. "proxy": every released
 * OneJS, a path proxy whose typeof is "function" and whose call throws
 * "Method not found". "undefined": a OneJS that reads it as undefined
 * (OneJS branch cs-missing-member-undefined), so the call is JS's own
 * TypeError. A name that is no type is a path proxy on both.
 */
export type Host = "proxy" | "undefined"

/** Both hosts, for a guard that must hold on each. */
export const HOSTS: Host[] = ["proxy", "undefined"]

/**
 * A `CS` global that answers as OneJS's bootstrap does, for tests of code that
 * asks whether the host's C# has something. `types` maps a full type name to
 * its static members. Any other name is a path proxy, as a real host's is: its
 * typeof is "function", it carries `__csPathProxy`, and calling it throws what
 * QuickJS throws, "Type not found: <owner>" when the owner is no type and
 * "Method not found: <owner>.<name>" when it is. On the "undefined" host a
 * missing member of a type in `types` reads undefined instead. A fake that
 * leaves a missing member undefined on a "proxy" host models no real host, and
 * a guard tested against one passes while it cannot fire (OneJS
 * QuickJSBootstrap.js.txt, __newCsPathProxy).
 *
 * A copy of onejs-unity's src/test-fake-cs.ts, with `missingMember` for the
 * recording fakes, which answer every name themselves.
 */
export function fakeCS(types: Record<string, Record<string, unknown>>, { host = "proxy" }: { host?: Host } = {}): any {
    const proxy = (path: string[]): any => {
        const name = path.join(".")
        return new Proxy(function () {}, {
            get(_t, prop) {
                if (typeof prop === "symbol") return undefined
                if (prop === "__csPathProxy") return true
                if (prop === "toString") return () => `[CSType ${name}]`
                const members = types[name]
                if (members !== undefined && prop in members) return members[prop]
                // A name that leads on to a type here (a nested type, a namespace under this one) stays a path.
                const next = `${name}.${prop}`
                if (members !== undefined && host === "undefined" && !Object.keys(types).some((t) => t === next || t.startsWith(`${next}.`))) return undefined
                return proxy([...path, prop])
            },
            apply() {
                const owner = path.slice(0, -1).join(".")
                throw new Error(types[owner] === undefined ? `[QuickJS] Type not found: ${owner}` : `[QuickJS] Method not found: ${owner}.${path[path.length - 1]}`)
            },
            construct() {
                throw new Error(`[QuickJS] Type not found for ctor: ${name}`)
            },
        })
    }
    return proxy([])
}

/**
 * What a real host gives for `owner.name` when the type has no such member: on
 * the "proxy" host a path proxy, typeof "function", that throws QuickJS's
 * not-found when called; on the "undefined" host, undefined.
 */
export function missingMember(owner: string, name: string, host: Host = "proxy"): any {
    const type = owner.split(".").reduce((at: any, key) => at[key], fakeCS({ [owner]: {} }, { host }))
    return type[name]
}
