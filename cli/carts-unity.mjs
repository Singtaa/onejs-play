/**
 * `ojp add` in a Unity project (PlaySite docs/carts.md §4, step 6).
 *
 * At the project's root (Assets/ beside ProjectSettings/), the whole cart
 * becomes its own JSRunner: today's Eject in one line. The cart goes in
 * `Assets/<Name>/~`, `init --unity` writes the PanelSettings and the prefab
 * beside it, and npm installs and builds it. Whose cart it is decides the form
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
import { git, mine, siteOrigin, tokenOf } from "./site.mjs"
import { NO_ONEJS, initUnity, npm as runNpm, oneJSOf, unityProjectOf } from "./unity.mjs"

/** Where in a Unity project `root` is: its root, an app's `~`, or somewhere else inside it. */
export function unityPlace(root) {
    if (fs.existsSync(path.join(root, "Assets")) && fs.existsSync(path.join(root, "ProjectSettings"))) return "root"
    if (path.basename(root) === "~" && unityProjectOf(root) !== null) return "app"
    return "inside"
}

/** A folder name made from a cart's name: what Assets shows, safe on every file system. */
export function folderName(name) {
    const cleaned = String(name ?? "").replace(/[\\/:*?"<>|.]/g, "").replace(/\s+/g, " ").trim()
    return cleaned === "" ? "Cart" : cleaned
}

/**
 * `ojp add @handle/name` at a Unity project's root. `npm` runs npm in a
 * folder and answers its exit code; tests pass a stand-in.
 */
export async function addWhole(project, address, { npm = runNpm, say = () => {} } = {}) {
    if (oneJSOf(project) === null) throw new Error(NO_ONEJS)
    const pinned = await pinOf(project, address)
    const value = pinText(pinned.version, pinned.commit)
    const bearer = tokenOf(project)
    const own = bearer ? (await mine(bearer)).carts.find((c) => c.url.toLowerCase().endsWith("/" + pinned.address.toLowerCase())) : undefined

    // The folder is named after the cart, which only its build says for
    // somebody else's; fetched first into a scratch folder in Assets, so a
    // failed fetch leaves Assets as it was.
    const scratch = path.join(project, "Assets", `.ojp-${process.pid}~`)
    let name, app, kept = null
    try {
        if (own !== undefined) {
            name = folderName(own.name)
            app = path.join(project, "Assets", name, "~")
            refuseIfThere(project, app)
            fs.mkdirSync(path.dirname(app), { recursive: true })
            const code = git(["clone", "-q", own.clone, app], { bearer })
            if (code !== 0) throw new Error(`git clone of ${pinned.address} failed (exit ${code}). Check ${COMMAND} login, then run it again.`)
        } else {
            kept = await download(project, pinned.address, value, scratch)
            const manifest = JSON.parse(fs.readFileSync(path.join(scratch, "oj.json"), "utf8"))
            name = folderName(manifest.name)
            app = path.join(project, "Assets", name, "~")
            refuseIfThere(project, app)
            fs.mkdirSync(path.dirname(app), { recursive: true })
            fs.renameSync(scratch, app)
        }
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true })
    }

    const fetched = await fetchUsed(app)
    const made = initUnity(app)
    for (const line of made.lines) say(line)
    const code = npm(app, ["install", "--no-audit", "--no-fund"]) || npm(app, ["run", "build"])
    if (code !== 0) throw new Error(`npm in Assets/${name}/~ failed (exit ${code}); the cart is there. Fix what npm said, then: cd "Assets/${name}/~" && npm install && npm run build`)

    const what = own !== undefined
        ? `Took ${pinned.address}, yours, into Assets/${name}/~ as a clone: push from there and the site builds it.`
        : `Took ${shown(kept)} into Assets/${name}/~, pinned and read only. To change it, fork it on ${siteOrigin()} and add yours.`
    return [
        what + (fetched.length > 0 ? ` It uses ${fetched.join(", ")}, fetched into ~/.oj/carts.` : ""),
        `Next: drag ${made.prefab} into a scene.`,
    ]
}

function refuseIfThere(project, app) {
    const shownPath = path.relative(project, path.dirname(app)).split(path.sep).join("/")
    if (fs.existsSync(path.dirname(app))) {
        throw new Error(`${shownPath} is already there. Move or delete it to take the cart again, or work in it: cd "${shownPath}/~"`)
    }
}

/** What `ojp add` says where it does not run in a Unity project yet. */
export function unityRefusal(place) {
    return place === "app"
        ? `Using a cart as a piece of a OneJS app comes with the next ${PACKAGE} release. To take it whole, run this at the project's root, where Assets and ProjectSettings are.`
        : `Run ${COMMAND} add at the Unity project's root, where Assets and ProjectSettings are: the cart lands whole in Assets/<Name>/~ with a prefab to drag into a scene.`
}
