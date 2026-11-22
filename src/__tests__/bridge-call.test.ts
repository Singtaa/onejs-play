import { describe, expect, it } from "vitest"
import { bridgeCall, bridgeHas } from "../bridge-call"
import { fakeCS, HOSTS, type Host } from "./fake-cs"

const bridgeOf = (members: Record<string, unknown>, host: Host = "proxy") => fakeCS({ "OneJS.Models.ModelBridge": members }, { host }).OneJS.Models.ModelBridge

describe("bridgeCall", () => {
    it.each(HOSTS)("calls a method the host has, and takes the older way for one it lacks, asking it once, where a missing static reads as a %s", (host) => {
        let asked = 0
        const b = bridgeOf({ Here: () => "here" }, host)
        expect(bridgeCall(b, "Here", () => b.Here(), () => "older")).toBe("here")
        const gone = () => { asked++; return b.Gone() }
        expect(bridgeCall(b, "Gone", gone, () => "older")).toBe("older")
        expect(bridgeCall(b, "Gone", gone, () => "older")).toBe("older")
        // A host that reads Gone as undefined is answered by typeof, before any call.
        expect(asked).toBe(host === "proxy" ? 1 : 0)
    })

    it("throws what the method itself throws, and what another type's miss throws", () => {
        const b = bridgeOf({ Breaks: () => { throw new Error("[QuickJS] the bake ran out of memory") } })
        expect(() => bridgeCall(b, "Breaks", () => b.Breaks(), () => "older")).toThrow("ran out of memory")
        const other = fakeCS({}).OneJS.Elsewhere
        expect(() => bridgeCall(b, "Breaks", () => other.Missing(), () => "older")).toThrow("Type not found: OneJS.Elsewhere")
    })

    it("takes the older way for a member that reads as undefined, without calling it", () => {
        expect(bridgeCall({}, "Gone", () => { throw new Error("called") }, () => "older")).toBe("older")
    })
})

describe("bridgeHas", () => {
    it("answers once a bridge and method, whichever way", () => {
        let asked = 0
        const b = bridgeOf({ Here: () => { asked++ } })
        expect(bridgeHas(b, "Here", () => b.Here())).toBe(true)
        expect(bridgeHas(b, "Here", () => b.Here())).toBe(true)
        expect(bridgeHas(b, "Gone", () => { asked++; return b.Gone() })).toBe(false)
        expect(bridgeHas(b, "Gone", () => { asked++; return b.Gone() })).toBe(false)
        expect(asked).toBe(2)
    })
})
