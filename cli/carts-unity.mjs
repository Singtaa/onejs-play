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
import { COMMAND, PACKAGE } from "../build/command.mjs"
import { download, fetchUsed, pinOf, pinText, shown } from "./carts.mjs"
import { git, mine, tokenOf } from "./site.mjs"
import { NO_ONEJS, initUnity, npm as runNpm, objectName, oneJSOf, unityProjectOf } from "./unity.mjs"
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
    if (oneJSOf(project) === null) throw new Error(NO_ONEJS)
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
            const code = git(["clone", "-q", own.clone, app], { bearer })
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

    // Into a scene, unless an editor has the project open (unity-scene.mjs).
    const prefabName = path.basename(made.prefab, ".prefab")
    const placed = placePrefab(project, made.prefab, prefabName)
    if (placed === null) return [took, `Next: drag ${made.prefab} into a scene.`]
    const where = placed.already ? `${prefabName} is already in ${placed.scene}.`
        : placed.made ? `Made ${placed.scene} with ${prefabName} in it${placed.listed ? ", and added it to the build list" : ""}.`
            : `Put ${prefabName} in ${placed.scene}${placed.listed ? ", and added that to the build list" : ""}.`
    return [took, where, `Next: open ${placed.scene} and press Play.`]
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
