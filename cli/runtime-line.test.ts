import { waitsFor } from "./runtime-line.mjs"

describe("waitsFor: the runtime line a cart needs", () => {
    it("names a line the live runtime is older than", () => {
        expect(waitsFor({ runtime: "1.2" }, "1.1.2")).toBe("1.2")
        expect(waitsFor({ runtime: "1.2.0" }, "1.1.9")).toBe("1.2")
        expect(waitsFor({ runtime: "2.0" }, "1.9.0")).toBe("2.0")
    })

    it("is null when the live runtime is on the line or past it, so the cart runs", () => {
        expect(waitsFor({ runtime: "1.2" }, "1.2.0")).toBeNull()
        expect(waitsFor({ runtime: "1.2" }, "1.3.1")).toBeNull()
        expect(waitsFor({ runtime: "1.0.0" }, "1.1.2")).toBeNull()
        expect(waitsFor({ runtime: "1.9" }, "2.0.0")).toBeNull()
    })

    it("is null for a cart that names no runtime", () => {
        expect(waitsFor({}, "1.1.2")).toBeNull()
    })

    it("refuses a runtime that is not a line, so a typo cannot read as runs anywhere", () => {
        expect(() => waitsFor({ runtime: "next" }, "1.1.2")).toThrow(/oldest runtime line/)
        expect(() => waitsFor({ runtime: "1" }, "1.1.2")).toThrow(/oldest runtime line/)
        expect(() => waitsFor({ runtime: "1.2" }, "1.1")).toThrow(/not a version/)
    })
})
