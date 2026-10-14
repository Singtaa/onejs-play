/**
 * `ojplay add` in a Unity project (PlaySite docs/carts.md §4, step 6).
 *
 * At the project's root (Assets/ beside ProjectSettings/), the whole cart
 * becomes its own JSRunner: today's Eject in one line. The cart goes in
 * `Assets/<Name>/~`, `init --unity` writes the PanelSettings and the prefab
 * beside it, npm installs and builds it, and the prefab goes in a scene
 * (unity-scene.mjs). Whose cart it is decides the form
 * (Sai, 30 Sep: "go with all four defaults"):
 *
 *   your own cart lands as a git clone you push from, through the stored
 *   login or OJ_TOKEN;
 *   anybody else's lands as its pinned build, read only. To change it, fork
 *   it on the site and add yours.
 *
 * A cart taken whole is worked on; a cart taken as a piece is used. The piece,
 * inside an existing app's `~`, is the other half of §4.
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { COMMAND, PACKAGE } from "../build/command.mjs"
import { download, fetchUsed, pinOf, pinText, shown } from "./carts.mjs"
import { mine, tokenOf } from "./site.mjs"
import { cloneCart, submoduleCart } from "./login.mjs"
import { init } from "./init.mjs"
import { NO_ONEJS, ensureGltfast, initUnity, npm as runNpm, objectName, oneJSOf, rootCartRunner, runsRootCarts, unityProjectOf } from "./unity.mjs"
import { withCartsPlugin } from "./unity-config.mjs"
import { placePrefab } from "./unity-scene.mjs"

const OWN_VERSION = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version

/** Where in a Unity project `root` is: its root, an app's `~`, or somewhere else inside it. */
export function unityPlace(root) {
    if (fs.existsSync(path.join(root, "Assets")) && fs.existsSync(path.join(root, "ProjectSettings"))) return "root"
    if (path.basename(root) === "~" && unityProjectOf(root) !== null) return "app"
    return "inside"
}

/**
 * The folder a cart taken whole lands in, named as its prefab is (init
 * --unity names that after the folder): one name, with nothing to quote in a
 * terminal. The address's name when nothing is left of the cart's.
 */
export function folderName(name, fallback = "Cart") {
    return objectName(String(name ?? ""), objectName(fallback))
}

/**
 * `ojplay add @handle/name` at a Unity project's root. `npm` runs npm in a
 * folder and answers its exit code; tests pass a stand-in.
 */
export async function addWhole(project, address, { npm = runNpm } = {}) {
    const onejs = oneJSOf(project)
    if (onejs === null) throw new Error(NO_ONEJS)
    // A OneJS with cart runners keeps the cart beside Assets; an older one
    // gets it in Assets/<Name>/~, exactly as before.
    if (runsRootCarts(onejs)) return addAtRoot(project, address, { npm })
    const pinned = await pinOf(project, address)
    const value = pinText(pinned.version, pinned.commit)
    const bearer = tokenOf(project)
    const own = bearer ? (await mine(bearer)).carts.find((c) => c.url.toLowerCase().endsWith("/" + pinned.address.toLowerCase())) : undefined

    // The folder is named after the cart, which only its build says for
    // somebody else's; fetched first into a scratch folder in Assets, so a
    // failed fetch leaves Assets as it was.
    const scratch = path.join(project, "Assets", `.ojplay-${process.pid}~`)
    let name, app, kept = null
    try {
        if (own !== undefined) {
            name = folderName(own.name, pinned.address.split("/")[1])
            app = path.join(project, "Assets", name, "~")
            refuseIfThere(project, app)
            fs.mkdirSync(path.dirname(app), { recursive: true })
            const code = cloneCart(own.clone, app, { bearer, quiet: true })
            if (code !== 0) throw new Error(`git clone of ${pinned.address} failed (exit ${code}). Check ${COMMAND} login, then run it again.`)
        } else {
            kept = await download(project, pinned.address, value, scratch)
            const manifest = JSON.parse(fs.readFileSync(path.join(scratch, "oj.json"), "utf8"))
            name = folderName(manifest.name, pinned.address.split("/")[1])
            app = path.join(project, "Assets", name, "~")
            refuseIfThere(project, app)
            fs.mkdirSync(path.dirname(app), { recursive: true })
            fs.renameSync(scratch, app)
        }
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true })
    }

    const fetched = await fetchUsed(app)
    // Quiet: the line below says what happened. `ojplay init --unity` is the
    // one that lists each file it wrote.
    const made = initUnity(app)
    const code = npm(app, ["install", "--no-audit", "--no-fund"]) || npm(app, ["run", "build"])
    if (code !== 0) throw new Error(`npm in Assets/${name}/~ failed (exit ${code}); the cart is there. Fix what npm said, then: cd Assets/${name}/~ && npm install && npm run build`)

    // Somebody else's is read only, which a build says when it is edited
    // (unity-carts.mjs), the moment it matters, rather than here.
    const what = own !== undefined
        ? `Took ${pinned.address}, yours, into Assets/${name}/~ as a clone: push from there and the site builds it.`
        : `Took ${shown(kept)} into Assets/${name}/~.`
    const took = what + (fetched.length > 0 ? ` It uses ${fetched.join(", ")}, fetched into ~/.oj/carts.` : "")
    const said = made.gltf === null ? [took] : [took, made.gltf]

    // Into a scene, unless an editor has the project open (unity-scene.mjs).
    const prefabName = path.basename(made.prefab, ".prefab")
    const placed = placePrefab(project, made.prefab, prefabName)
    if (placed === null) return [...said, `Next: drag ${made.prefab} into a scene.`]
    const where = placed.already ? `${prefabName} is already in ${placed.scene}.`
        : placed.made ? `Made ${placed.scene} with ${prefabName} in it${placed.listed ? ", and added it to the build list" : ""}.`
            : `Put ${prefabName} in ${placed.scene}${placed.listed ? ", and added that to the build list" : ""}.`
    return [...said, where, `Next: open ${placed.scene} and press Play.`]
}

/**
 * `ojplay add` at the root of a Unity project whose OneJS runs carts from
 * there (Specs/ROOT_CARTS.md §5.8 in the OneJS container): the cart lands in
 * `<Name>/` beside Assets, set up as any cart is (ojplay init, npm install),
 * with nothing of Unity's inside it. Your own cart is a submodule when the
 * project is a git repository, else a clone; somebody else's is its pinned
 * build, downloaded, since a submodule pins a commit a force push can remove
 * (Sai, 14 Oct 2026). Unity's half is Assets/<Name>/: a PanelSettings and a
 * prefab whose JSRunner links the cart by its oj.json name. OneJS builds it
 * when the project opens.
 */
async function addAtRoot(project, address, { npm }) {
    const pinned = await pinOf(project, address)
    const value = pinText(pinned.version, pinned.commit)
    const bearer = tokenOf(project)
    const own = bearer ? (await mine(bearer)).carts.find((c) => c.url.toLowerCase().endsWith("/" + pinned.address.toLowerCase())) : undefined
    const inRepository = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: project, encoding: "utf8" }).stdout?.trim() === "true"

    const scratch = path.join(project, `.ojplay-${process.pid}`)
    let name, root, kept = null, how = "clone"
    try {
        if (own !== undefined) {
            name = folderName(own.name, pinned.address.split("/")[1])
            root = path.join(project, name)
            refuseIfAtRoot(project, name)
            how = inRepository ? "submodule" : "clone"
            const code = inRepository ? submoduleCart(own.clone, project, name, { bearer }) : cloneCart(own.clone, root, { bearer, quiet: true })
            if (code !== 0) throw new Error(`git ${inRepository ? "submodule add" : "clone"} of ${pinned.address} failed (exit ${code}). Check ${COMMAND} login, then run it again.`)
        } else {
            kept = await download(project, pinned.address, value, scratch)
            const manifest = JSON.parse(fs.readFileSync(path.join(scratch, "oj.json"), "utf8"))
            name = folderName(manifest.name, pinned.address.split("/")[1])
            root = path.join(project, name)
            refuseIfAtRoot(project, name)
            fs.renameSync(scratch, root)
        }
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true })
    }

    const fetched = await fetchUsed(root)
    init(root)
    raiseOwnVersion(root)
    const code = npm(root, ["install", "--no-audit", "--no-fund"])
    if (code !== 0) throw new Error(`npm install in ${name}/ failed (exit ${code}); the cart is there. Fix what npm said, then: cd ${name} && npm install`)

    const cartName = readName(root) ?? name
    const prefabPath = rootCartRunner(project, name, cartName)
    const gltf = ensureGltfast(project, root)

    const what = own !== undefined
        ? `Took ${pinned.address}, yours, into ${name}/ as a ${how}: push from there and the site builds it.`
        : `Took ${shown(kept)} into ${name}/.`
    const took = what + (fetched.length > 0 ? ` It uses ${fetched.join(", ")}, fetched into ${name}/.oj/carts.` : "")
    const said = gltf === null ? [took] : [took, gltf]
    const prefabName = path.basename(prefabPath, ".prefab")
    const placed = placePrefab(project, prefabPath, prefabName)
    if (placed === null) return [...said, `Next: drag ${prefabPath} into a scene.`]
    const where = placed.already ? `${prefabName} is already in ${placed.scene}.`
        : placed.made ? `Made ${placed.scene} with ${prefabName} in it${placed.listed ? ", and added it to the build list" : ""}.`
            : `Put ${prefabName} in ${placed.scene}${placed.listed ? ", and added that to the build list" : ""}.`
    return [...said, where, `Next: open ${placed.scene} and press Play.`]
}

/** The cart's oj.json name, trimmed, or null: what its runner links by. */
function readName(root) {
    try {
        const name = JSON.parse(fs.readFileSync(path.join(root, "oj.json"), "utf8")).name
        return typeof name === "string" && name.trim() !== "" ? name.trim() : null
    } catch {
        return null
    }
}

/**
 * The cart's ojplay at least this one, which has the build OneJS runs (build
 * --unity): the scaffold's range may predate it.
 */
function raiseOwnVersion(root) {
    const file = path.join(root, "package.json")
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"))
    const deps = [pkg.devDependencies, pkg.dependencies].find((d) => d !== undefined && PACKAGE in d) ?? (pkg.devDependencies ??= {})
    const floor = floorOf(deps[PACKAGE] ?? "")
    if (floor !== null && below(floor, floorOf(OWN_VERSION)) >= 0) return
    deps[PACKAGE] = `^${OWN_VERSION}`
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n")
}

function refuseIfAtRoot(project, name) {
    for (const there of [name, `Assets/${name}`]) {
        if (fs.existsSync(path.join(project, there))) throw new Error(`${there} is already there. Move or delete it to take the cart again, or work in it: cd ${name}`)
    }
}

function refuseIfThere(project, app) {
    const shownPath = path.relative(project, path.dirname(app)).split(path.sep).join("/")
    if (fs.existsSync(path.dirname(app))) {
        throw new Error(`${shownPath} is already there. Move or delete it to take the cart again, or work in it: cd ${shownPath}/~`)
    }
}

/** What `ojplay add` says somewhere in a Unity project that is neither its root nor an app's ~. */
export function unityRefusal() {
    return `Run ${COMMAND} add at the Unity project's root, where Assets and ProjectSettings are, to take a cart whole as its own app; `
        + `or in an app's ~ folder to use it as a piece of that app.`
}

/** The first ojplay with cartsPlugin: an app on an older range is raised to this one's. */
export const CARTS_SINCE = "0.9.1"

/** The lowest version a dependency range names, as numbers, or null for one that names none (a file: link, latest). */
function floorOf(range) {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(range))
    return m === null ? null : m.slice(1).map(Number)
}
const below = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/**
 * A OneJS app's build made ready for used carts: cartsPlugin() in its
 * esbuild.config.mjs, and an ojplay new enough to have it in its
 * package.json, installed. Answers the one line that says so, or null when
 * there was nothing to do: it is said once, the first time.
 */
export function prepareUnityBuild(app, { npm = runNpm } = {}) {
    const changed = []
    const configFile = path.join(app, "esbuild.config.mjs")
    const config = fs.readFileSync(configFile, "utf8")
    const next = withCartsPlugin(config)
    if (next !== config) {
        fs.writeFileSync(configFile, next)
        changed.push("esbuild.config.mjs")
    }
    const pkgFile = path.join(app, "package.json")
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"))
    const deps = [pkg.dependencies, pkg.devDependencies].find((d) => d !== undefined && PACKAGE in d)
    const floor = deps === undefined ? null : floorOf(deps[PACKAGE])
    if (deps === undefined || (floor !== null && below(floor, floorOf(CARTS_SINCE)) < 0)) {
        const into = deps ?? (pkg.dependencies ??= {})
        into[PACKAGE] = `^${OWN_VERSION}`
        fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n")
        changed.push("package.json")
        const code = npm(app, ["install", "--no-audit", "--no-fund"])
        if (code !== 0) throw new Error(`npm install failed (exit ${code}) after setting ${PACKAGE} ^${OWN_VERSION} in package.json. Fix what npm said, then: npm install`)
    }
    return changed.length === 0 ? null : `Set up this app for carts (${changed.join(", ")}).`
}
