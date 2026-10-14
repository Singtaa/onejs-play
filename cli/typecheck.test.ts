import { describe, it, expect, afterEach } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { init } from "./init.mjs"
import { typecheck } from "./game.mjs"
import { CART_COMPILER_OPTIONS } from "../build/cart-types.mjs"

/**
 * ojplay typecheck checks a cart by the Play editor's rules. It used the
 * scaffold's strict, DOM-typed tsconfig, so the Ghost Hunt code that was clean
 * in the editor failed locally and agents added types to quiet it.
 */
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

function cart(source: string, { old = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oj-typecheck-"))
    dirs.push(root)
    if (old) {
        // A clone set up before the rules were shared: strict, with the DOM.
        fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
            compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM"], strict: true, noEmit: true, jsx: "react-jsx", skipLibCheck: true, types: ["react"] },
            include: ["**/*"], exclude: ["node_modules"],
        }))
    } else {
        init(root)
    }
    fs.symlinkSync(path.resolve(import.meta.dirname, "../node_modules"), path.join(root, "node_modules"), "junction")
    fs.writeFileSync(path.join(root, "index.tsx"), source)
    return root
}

// What a learner writes in the editor and the editor accepts.
const LOOSE = [
    "import { useRef } from \"react\"",
    "export function Box() {",
    "    const ref = useRef(null)",
    "    const move = (x) => { ref.current.style.left = x }",
    "    setTimeout(() => move(3), 10)",
    "    console.log(ref)",
    "    return null",
    "}",
].join("\n")
const DOM = "document.title = \"x\"\nexport {}\n"

describe("ojplay typecheck", () => {
    it("writes the editor's rules into a new clone's tsconfig", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "oj-init-"))
        dirs.push(root)
        init(root)
        const options = JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8")).compilerOptions
        expect(options.strict).toBe(CART_COMPILER_OPTIONS.strict)
        expect(options.lib).toEqual(CART_COMPILER_OPTIONS.lib)
        expect(options.target).toBe(CART_COMPILER_OPTIONS.target)
        expect(fs.readFileSync(path.join(root, ".oj", "host.d.ts"), "utf8")).toMatch(/declare const console/)
    })

    it("passes what the editor passes", () => {
        expect(typecheck(cart(LOOSE), { quiet: true })).toBe(0)
    }, 60_000)

    it("fails what the editor fails: there is no DOM in a cart", () => {
        expect(typecheck(cart(DOM), { quiet: true })).not.toBe(0)
    }, 60_000)

    it("leaves a OneJS app in a Unity project to its own globals and tsconfig", () => {
        const root = cart("console.log(1)\nexport {}\n", { old: true })
        fs.mkdirSync(path.join(root, "types"))
        fs.writeFileSync(path.join(root, "types", "global.d.ts"), "declare const console: { log(...a: unknown[]): void }\n")
        expect(typecheck(root, { quiet: true })).toBe(0)
        expect(fs.existsSync(path.join(root, ".oj", "host.d.ts"))).toBe(false)
    }, 60_000)

    it("checks an older clone by the editor's rules too, its own tsconfig notwithstanding", () => {
        expect(typecheck(cart(LOOSE, { old: true }), { quiet: true })).toBe(0)
        expect(typecheck(cart(DOM, { old: true }), { quiet: true })).not.toBe(0)
    }, 60_000)
})
