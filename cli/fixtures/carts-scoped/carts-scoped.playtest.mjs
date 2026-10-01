// Every way a used cart loads its own art reaches its own files, and the
// using cart's file of the same name stays the using cart's (docs/carts.md
// §3 in PlaySite, step 4). Each loader reports what arrived; a wrong size
// means a name reached the runtime without the used cart's scope.
import fs from "node:fs"
import path from "node:path"

const USED = path.join(import.meta.dirname, ".oj/carts/@test/art@1.0.0")
const WANT = {
    "useTexture": 8,
    "loadTexture": 8,
    "useFlipbook": "32 wide, cells 0.25",
    "audio.load": "ok",
    "fetch(assetUrl)": fs.statSync(path.join(USED, "glow.png")).size,
    "Image src={assetUrl}": 8,
    "own useTexture": 16,
    "own loadTexture": 16,
}

export default async function (game) {
    const read = async () => JSON.parse(await game.eval("JSON.stringify(globalThis.__scoped ?? {})"))
    try {
        await game.until(async () => {
            const got = await read()
            return Object.keys(WANT).every((k) => k in got)
        }, { what: "every loader to report", timeoutMs: 20000 })
    } catch (error) {
        throw new Error(`${error.message}; got ${JSON.stringify(await read())}`)
    }
    const got = await read()
    const wrong = Object.entries(WANT).filter(([k, v]) => got[k] !== v)
    if (wrong.length > 0) {
        throw new Error(wrong.map(([k, v]) => `${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(v)}`).join("; "))
    }
}
