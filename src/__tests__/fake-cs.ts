/**
 * A `CS` global that answers as OneJS's bootstrap does, for tests of code that
 * asks whether the host's C# has something. `types` maps a full type name to
 * its static members. Any other name is a path proxy, as a real host's is: its
 * typeof is "function", it carries `__csPathProxy`, and calling it throws what
 * QuickJS throws, "Type not found: <owner>" when the owner is no type and
 * "Method not found: <owner>.<name>" when it is. A fake that leaves a missing
 * member undefined instead models no real host, and a guard tested against one
 * passes while it cannot fire (OneJS QuickJSBootstrap.js.txt, __newCsPathProxy).
 *
 * A copy of onejs-unity's src/test-fake-cs.ts (6422972), with `missingMember`
 * for the recording fakes, which answer every name themselves.
 */
export function fakeCS(types: Record<string, Record<string, unknown>>): any {
    const proxy = (path: string[]): any => {
        const name = path.join(".")
        return new Proxy(function () {}, {
            get(_t, prop) {
                if (typeof prop === "symbol") return undefined
                if (prop === "__csPathProxy") return true
                if (prop === "toString") return () => `[CSType ${name}]`
                const members = types[name]
                if (members !== undefined && prop in members) return members[prop]
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
 * What a real host gives for `owner.name` when the type has no such member: a
 * path proxy, typeof "function", that throws QuickJS's not-found when called.
 */
export function missingMember(owner: string, name: string): any {
    const type = owner.split(".").reduce((at: any, key) => at[key], fakeCS({ [owner]: {} }))
    return type[name]
}
