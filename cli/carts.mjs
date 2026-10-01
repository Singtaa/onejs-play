/**
 * Carts inside carts, from a terminal (PlaySite docs/carts.md §3, step 5):
 * `add`, `update` and `remove`, and fetching what oj.json uses into
 * `.oj/carts/<key>/`, where the build and `ojplay run` read it.
 *
 * Every command says what changed in a line or two and names the next step
 * (Sai, 1 Oct: "simple for new users... absolute best DX"). None needs an
 * account for a public cart; a stored login or OJ_TOKEN reaches the
 * account's own private ones.
 */
import fs from "node:fs"
import path from "node:path"
import { cartKey, cartLabel, cartPins } from "../build/game.mjs"
import { COMMAND } from "../build/command.mjs"
import { siteOrigin, tokenOf } from "./site.mjs"
import { ignoreLocally } from "./init.mjs"
import { UNITY_NEXT, addWhole, prepareUnityBuild, unityPlace, unityRefusal } from "./carts-unity.mjs"
import { unityProjectOf } from "./unity.mjs"

const ADDRESS = /^@[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/
/** What a fetched cart's folder carries beside its files: where it came from. A cart's own names never start with a dot. */
const KEPT = ".oj-kept.json"
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export const cartsDir = (root) => path.join(root, ".oj", "carts")
const dirOf = (root, key) => path.join(cartsDir(root), ...key.split("/"))
const addressOf = (key) => key.slice(0, key.lastIndexOf("@"))
export const pinText = (version, commit) => version ?? "#" + commit.slice(0, 12)
const day = (at) => { const d = new Date(at * 1000); return `${d.getDate()} ${MONTHS[d.getMonth()]}` }
const time = (at) => { const d = new Date(at * 1000); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` }

// ---------- the site ----------

async function site(method, route, root, body) {
    const bearer = tokenOf(root)
    let response
    try {
        response = await fetch(siteOrigin() + route, {
            method,
            headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        })
    } catch (error) {
        throw new Error(`Could not reach ${siteOrigin()} (${error.cause?.code ?? error.message}). Check the connection and run it again.`, { cause: error })
    }
    return response
}

async function answer(response) {
    const text = await response.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* not JSON */ }
    if (!response.ok) throw new Error(body?.error ?? `${response.status} from ${siteOrigin()}`)
    return body
}

/** What to write for `address`: its newest version, or its running build. Records the use on the site. */
export async function pinOf(root, address, within = null, major = false) {
    const route = `/api/carts/${address.toLowerCase()}/pin`
    return answer(await site("POST", route, root, within === null ? {} : { within, major }))
}

/**
 * A kept build into `.oj/carts/<key>/` (or `final`): its source, its art, and
 * where it came from. Written whole under a temporary name first, so an
 * interrupted fetch leaves nothing that looks complete.
 */
export async function download(root, address, pin, final = dirOf(root, cartKey(address, pin))) {
    const at = `/api/carts/${address}/kept/${pin.replace(/^#/, "")}`
    const kept = await answer(await site("GET", at, root))
    const key = cartKey(address, pin)
    const temporary = `${final}.partial`
    fs.rmSync(temporary, { recursive: true, force: true })
    for (const file of kept.files) put(temporary, file.name, file.text)
    for (const name of Object.keys(kept.assets)) {
        const response = await site("GET", `${at}/files/${name.split("/").map(encodeURIComponent).join("/")}`, root)
        if (!response.ok) throw new Error(`${cartLabel(key)}: ${name} would not download (${response.status}). Run it again.`)
        put(temporary, name, new Uint8Array(await response.arrayBuffer()))
    }
    put(temporary, KEPT, JSON.stringify({ address: kept.address, version: kept.version, commit: kept.commit, builtAt: kept.builtAt }) + "\n")
    fs.rmSync(final, { recursive: true, force: true })
    fs.renameSync(temporary, final)
    return kept
}

/**
 * A used cart as these commands name it: `@singtaa/lightning 1.2.0`, or for
 * a # pin the day its build was made, `@koma/rain (1 Oct)`, which is what the
 * editor shows too. Twelve hex digits say nothing to a person.
 */
export const shown = (kept) => kept.version !== null ? `${kept.address} ${kept.version}` : `${kept.address} (${day(kept.builtAt)})`

function put(dir, name, data) {
    const file = path.join(dir, ...name.split("/"))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data)
}

// ---------- oj.json and what is on disk ----------

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
        return null
    }
}

const manifestOf = (root) => readJson(path.join(root, "oj.json"))
const writeManifest = (root, manifest) => fs.writeFileSync(path.join(root, "oj.json"), JSON.stringify(manifest, null, 4) + "\n")
/** A fetched cart's own oj.json and where it came from. */
const fetchedOf = (root, key) => ({ own: readJson(path.join(dirOf(root, key), "oj.json")) ?? {}, kept: readJson(path.join(dirOf(root, key), KEPT)) })

/** A OneJS app's working folder in a Unity project, which uses carts through its oj.json. */
const isUnityApp = (root) => path.basename(root) === "~" && unityProjectOf(root) !== null && fs.existsSync(path.join(root, "oj.json"))

/** What `root` is: a cart, a Unity project, or a folder with neither. */
export function placeOf(root) {
    const manifest = manifestOf(root)
    if (manifest !== null && typeof manifest.entry === "string") return "cart"
    if (fs.existsSync(path.join(root, "Assets")) && fs.existsSync(path.join(root, "ProjectSettings"))) return "unity"
    if (root.split(path.sep).includes("Assets")) return "unity"
    return manifest !== null || fs.existsSync(path.join(root, "index.tsx")) ? "other" : "empty"
}

/**
 * Fetches every cart oj.json uses, and the carts those use, that is not in
 * `.oj/carts/` yet. Answers the labels it fetched.
 */
export async function fetchUsed(root, manifest = manifestOf(root) ?? {}) {
    const fetched = []
    const seen = new Set()
    const visit = async (deps) => {
        for (const [address, pin] of cartPins(deps).pins) {
            const key = cartKey(address, pin)
            if (seen.has(key)) continue
            seen.add(key)
            if (!fs.existsSync(dirOf(root, key))) {
                try {
                    fetched.push(shown(await download(root, address.toLowerCase(), pin)))
                } catch (error) {
                    const reason = error.message.replace(/ Check the connection and run it again\.$/, "").replace(/\.$/, "")
                    throw new Error(`${cartLabel(key)} is not in .oj/carts and could not be fetched: ${reason}. Connect and run it again, or: ${COMMAND} add`, { cause: error })
                }
            }
            await visit(fetchedOf(root, key).own.dependencies)
        }
    }
    await visit(manifest.dependencies)
    return fetched
}

/** The keys oj.json reaches, directly or through a used cart, as far as `.oj/carts/` knows. */
function reached(root, manifest) {
    const keys = new Map()
    const visit = (deps, direct) => {
        for (const [address, pin] of cartPins(deps).pins) {
            const key = cartKey(address, pin)
            if (keys.has(key)) continue
            keys.set(key, direct)
            visit(fetchedOf(root, key).own.dependencies, false)
        }
    }
    visit(manifest.dependencies, true)
    return keys
}

/** Removes every fetched cart nothing reaches any more. */
function prune(root, manifest) {
    const keep = reached(root, manifest)
    if (!fs.existsSync(cartsDir(root))) return
    for (const handle of fs.readdirSync(cartsDir(root))) {
        const handleDir = path.join(cartsDir(root), handle)
        if (!fs.statSync(handleDir).isDirectory()) continue
        for (const named of fs.readdirSync(handleDir)) {
            if (!keep.has(`${handle}/${named}`)) fs.rmSync(path.join(handleDir, named), { recursive: true, force: true })
        }
        if (fs.readdirSync(handleDir).length === 0) fs.rmSync(handleDir, { recursive: true, force: true })
    }
}

/**
 * Points the local tsconfig at the fetched carts, so `ojplay typecheck` and an
 * editor resolve `@singtaa/lightning` to the source the build compiles. Only
 * the tsconfig `ojplay init` wrote (it maps "oj"); a cart's own is left alone.
 * The cart's own uses win where two versions of one cart are in the tree.
 */
export function syncTypes(root, manifest = manifestOf(root) ?? {}) {
    const file = path.join(root, "tsconfig.json")
    const config = readJson(file)
    const paths = config?.compilerOptions?.paths
    if (paths === undefined || !("oj" in paths)) return
    for (const name of Object.keys(paths)) if (name.startsWith("@")) delete paths[name]
    const keys = [...reached(root, manifest)].sort((a, b) => Number(a[1]) - Number(b[1]))
    for (const [key] of keys) {
        const { own } = fetchedOf(root, key)
        const main = typeof own.exports === "string" ? own.exports : typeof own.entry === "string" ? own.entry : "index.tsx"
        const rel = `./.oj/carts/${key}`
        paths[addressOf(key)] = [`${rel}/${main}`]
        paths[`${addressOf(key)}/*`] = [`${rel}/*`]
    }
    config.exclude = [...new Set([...(config.exclude ?? []), ".oj"])]
    fs.writeFileSync(file, JSON.stringify(config, null, 4) + "\n")
}

/** "It exports Bolt and Glow: import { Bolt, Glow } from ..." or how a whole cart runs. */
function howToUse(root, key) {
    const { own } = fetchedOf(root, key)
    const address = addressOf(key)
    if (typeof own.exports !== "string") return `It is a whole cart: import "${address}" runs it.`
    const names = exportedNames(root, key, own.exports)
    if (names.length === 0) return `Import it: import ... from "${address}"`
    return `It exports ${names.join(", ")}: import { ${names.join(", ")} } from "${address}"`
}

/** A name that reads as a component, `Bolt` or `HealthBar`, not a constant such as `COLORS`. */
const isComponent = (name) => /^[A-Z](?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]*$/.test(name)

/** The names a file exports, read from its text: enough to say how to import them. */
function exportedNames(root, key, exportsFile) {
    let text = ""
    for (const candidate of [exportsFile, `${exportsFile}.tsx`, `${exportsFile}.ts`]) {
        try { text = fs.readFileSync(path.join(dirOf(root, key), candidate), "utf8"); break } catch { /* next */ }
    }
    const names = new Set()
    for (const m of text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
    for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(",")) {
            const name = part.trim().split(/\s+as\s+/).pop()?.trim()
            if (name && name !== "default" && !name.startsWith("type ")) names.add(name)
        }
    }
    return [...names]
}

// ---------- the commands ----------

/**
 * `ojplay add @handle/name`: in a cart, adds it to oj.json at its newest version
 * (or its running build) and fetches it; in a folder that is neither a cart
 * nor a Unity project, starts a cart there that uses it (Tachi, 1 Oct). With
 * no address, fetches what oj.json already lists. Answers the lines to print.
 */
export async function add(root, address, options = {}) {
    let place = placeOf(root)
    // In a Unity project: at its root the whole cart lands as its own app;
    // in an app's ~ (a OneJS app, or a cart taken earlier) it is used as a
    // piece, through oj.json the way a cart uses one.
    const unity = place === "unity" ? unityPlace(root) : unityProjectOf(root) !== null && path.basename(root) === "~" ? "app" : null
    if (unity === "root" && address !== undefined && ADDRESS.test(address)) return addWhole(root, address, options)
    if (unity === "root" && address !== undefined) throw new Error(`"${address}" is not a cart's address. One looks like @singtaa/lightning: @, the handle, a slash, the name.`)
    if (unity !== null && unity !== "app") throw new Error(unityRefusal(unity))
    if (unity === "app") {
        if (!fs.existsSync(path.join(root, "esbuild.config.mjs"))) throw new Error(`This ~ has no esbuild.config.mjs, so it is not a OneJS app yet. Initialize it from its JSRunner in Unity first, then run this again.`)
        place = "cart"
    }
    if (address === undefined) {
        if (place !== "cart") throw new Error(`This folder is not a cart (no oj.json with an entry). Start one that uses a cart: ${COMMAND} add @handle/name`)
        const fetched = await fetchUsed(root)
        syncTypes(root)
        if (unity === "app") prepareUnityBuild(root, options)
        return [
            fetched.length === 0 ? "Everything oj.json uses is already in .oj/carts." : `Fetched ${fetched.join(", ")} into .oj/carts.`,
            `Next: ${unity === "app" ? UNITY_NEXT : `${COMMAND} run`}`,
        ]
    }
    if (!ADDRESS.test(address)) {
        throw new Error(`"${address}" is not a cart's address. One looks like @singtaa/lightning: @, the handle, a slash, the name.`)
    }
    if (place === "other") {
        throw new Error(`This folder has ${fs.existsSync(path.join(root, "oj.json")) ? "an oj.json with no entry" : "an index.tsx but no oj.json"}, so it is not a cart. Start one in an empty folder: mkdir my-cart && cd my-cart && ${COMMAND} add ${address}`)
    }

    const pinned = await pinOf(root, address)
    const value = pinText(pinned.version, pinned.commit)
    const key = cartKey(pinned.address, value)

    if (place === "empty") {
        // Fetched first: what the new cart says it uses has to be readable,
        // and its controls and runtime come from the cart it runs.
        const kept = await download(root, pinned.address, value)
        const { own } = fetchedOf(root, key)
        const name = path.basename(root).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim() || "My Cart"
        writeManifest(root, {
            schema: 1,
            runtime: typeof own.runtime === "string" ? own.runtime : "1.0.0",
            name,
            entry: "index.tsx",
            controls: Array.isArray(own.controls) ? own.controls : ["pointer", "touch"],
            dependencies: { [pinned.address]: value },
        })
        fs.writeFileSync(path.join(root, "index.tsx"), starterFor(root, key))
        ignoreLocally(root, "# What oj fetches and writes on this machine.\n.oj\n")
        await fetchUsed(root)
        const names = typeof own.exports === "string" ? exportedNames(root, key, own.exports) : null
        const components = names?.filter(isComponent) ?? []
        return [
            names === null ? `Started a cart here that runs ${shown(kept)}: index.tsx imports it, oj.json lists it.`
                : components.length > 0 ? `Started a cart here that uses ${shown(kept)}: index.tsx shows ${components.join(", ")}.`
                : `Started a cart here that uses ${shown(kept)}: index.tsx imports ${names.length > 0 ? names.join(", ") : "it"}.`,
            `Next: ${COMMAND} run`,
        ]
    }

    const manifest = manifestOf(root) ?? {}
    const deps = typeof manifest.dependencies === "object" && manifest.dependencies !== null && !Array.isArray(manifest.dependencies) ? manifest.dependencies : {}
    const listed = Object.keys(deps).find((a) => a.toLowerCase() === pinned.address.toLowerCase())
    const before = listed === undefined ? undefined : deps[listed]
    if (listed !== undefined) delete deps[listed]
    deps[pinned.address] = value
    manifest.dependencies = deps
    writeManifest(root, manifest)
    await fetchUsed(root, manifest)
    prune(root, manifest)
    syncTypes(root, manifest)
    const what = before === value
        ? `${shown(pinned)} is already in oj.json, at its newest.`
        : before === undefined
            ? `Added ${shown(pinned)} to oj.json.`
            : `${pinned.address} ${before} → ${value.replace(/^#/, "#")} in oj.json.`
    if (unity === "app") prepareUnityBuild(root, options)
    return [`${what} ${howToUse(root, key)}`, `Next: ${unity === "app" ? UNITY_NEXT : `${COMMAND} run`}`]
}

/** The index.tsx a new cart starts with: the bare import of a whole cart, or the import of a piece. */
function starterFor(root, key) {
    const address = addressOf(key)
    const { own } = fetchedOf(root, key)
    if (typeof own.exports !== "string") {
        return `// ${address} is a whole cart: importing it runs it.\nimport "${address}"\n`
    }
    const names = exportedNames(root, key, own.exports)
    const components = names.filter(isComponent)
    return [
        `import { View, mount } from "oj"`,
        names.length > 0 ? `import { ${names.join(", ")} } from "${address}"` : `import "${address}"`,
        ``,
        `function Main() {`,
        components.length === 0 ? `    return <View style={{ width: "100%", height: "100%" }} />`
            : [`    return (`, `        <View style={{ width: "100%", height: "100%" }}>`, ...components.map((n) => `            <${n} />`), `        </View>`, `    )`].join("\n"),
        `}`,
        ``,
        `mount(<Main />)`,
        ``,
    ].join("\n")
}

/**
 * `ojplay update [@handle/name] [--major]`: each version to the newest in its
 * major (all majors with --major), each commit pin to the cart's running
 * build. Prints what moved, as `@singtaa/lightning 1.2.0 → 1.3.0`, and a
 * commit pin as days, `@koma/rain updated (30 Sep → 1 Oct)`.
 */
export async function update(root, only, { major = false } = {}) {
    if (placeOf(root) !== "cart" && !isUnityApp(root)) throw new Error(`This folder is not a cart (no oj.json with an entry). ${COMMAND} update runs in one.`)
    const manifest = manifestOf(root)
    const { pins } = cartPins(manifest.dependencies)
    const chosen = only === undefined ? pins : pins.filter(([address]) => address.toLowerCase() === only.toLowerCase())
    if (only !== undefined && chosen.length === 0) throw new Error(notListed(only, pins))
    if (chosen.length === 0) return [`oj.json uses no carts. Add one: ${COMMAND} add @handle/name`]
    await fetchUsed(root, manifest)
    const lines = []
    for (const [address, pin] of chosen) {
        const before = fetchedOf(root, cartKey(address, pin)).kept
        const pinned = await pinOf(root, address, pin.startsWith("#") ? null : pin, major)
        const value = pinText(pinned.version, pinned.commit)
        if (value === pin) {
            lines.push(`${address} ${pin} is the newest${pin.startsWith("#") || major ? "" : ` ${pin.split(".")[0]}.x; --major looks further`}.`)
            continue
        }
        delete manifest.dependencies[address]
        manifest.dependencies[pinned.address] = value
        if (pin.startsWith("#") && !value.startsWith("#")) lines.push(`${pinned.address} ${pin} → ${value}: it has versions now.`)
        else if (value.startsWith("#")) {
            const was = before?.builtAt ?? null, now = pinned.builtAt
            const sameDay = was !== null && day(was) === day(now)
            lines.push(`${pinned.address} updated (${was === null ? pin : day(was) + (sameDay ? " " + time(was) : "")} → ${day(now)}${sameDay ? " " + time(now) : ""}).`)
        } else lines.push(`${pinned.address} ${pin} → ${value}.`)
    }
    writeManifest(root, manifest)
    await fetchUsed(root, manifest)
    prune(root, manifest)
    syncTypes(root, manifest)
    return [...lines, `Next: ${COMMAND} run`]
}

/** `ojplay remove @handle/name`: out of oj.json and .oj/carts, naming the files that still import it. */
export async function remove(root, address) {
    if (placeOf(root) !== "cart" && !isUnityApp(root)) throw new Error(`This folder is not a cart (no oj.json with an entry). ${COMMAND} remove runs in one.`)
    if (address === undefined) throw new Error(`Which one? ${COMMAND} remove @handle/name`)
    const manifest = manifestOf(root)
    const deps = manifest.dependencies ?? {}
    const listed = Object.keys(deps).find((a) => a.toLowerCase() === address.toLowerCase())
    if (listed === undefined) throw new Error(notListed(address, cartPins(deps).pins))
    delete deps[listed]
    if (Object.keys(deps).length === 0) delete manifest.dependencies
    writeManifest(root, manifest)
    prune(root, manifest)
    syncTypes(root, manifest)
    const importers = sourceFiles(root).filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8")
        return new RegExp(`(from|import)\\s*["']${listed.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(/[^"']*)?["']`, "i").test(text)
    })
    return importers.length === 0
        ? [`Removed ${listed.toLowerCase()} from oj.json.`, `Next: ${COMMAND} run`]
        : [`Removed ${listed.toLowerCase()} from oj.json. ${importers.join(", ")} still ${importers.length === 1 ? "imports" : "import"} it.`, `Next: take ${importers.length === 1 ? "that import" : "those imports"} out, then ${COMMAND} run`]
}

function notListed(address, pins) {
    return pins.length === 0
        ? `${address} is not in oj.json, which uses no carts.`
        : `${address} is not in oj.json. It uses ${pins.map(([a]) => a.toLowerCase()).join(", ")}.`
}

/** The cart's own source files, relative, outside .oj, node_modules and dot folders. */
function sourceFiles(root, dir = "") {
    const out = []
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue
        const rel = dir === "" ? entry.name : `${dir}/${entry.name}`
        if (entry.isDirectory()) out.push(...sourceFiles(root, rel))
        else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(rel)
    }
    return out
}
