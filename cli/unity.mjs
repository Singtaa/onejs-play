/**
 * `ojplay init --unity`: a clone turned into a JSRunner project, in place, inside
 * the Unity project it was cloned into.
 *
 * A cart's repository is index.tsx and oj.json. A JSRunner project is a
 * folder holding a PanelSettings (which marks it as the project), the built
 * `app.js.txt` beside it, and a working directory named `~` with the source
 * and whatever builds it. So the clone goes where the working directory goes,
 * `Assets/<Name>/~`, and this writes the rest around it:
 *
 *   inside the clone, JSRunner's own default files, read from the OneJS the
 *   Unity project has installed rather than copied here, so they are always
 *   the ones that OneJS scaffolds and builds with;
 *   beside it, a PanelSettings and a prefab carrying a JSRunner, so dragging
 *   the prefab into a scene is the whole of running it.
 *
 * Everything written inside the clone is added to the repository's
 * info/exclude, so `git status` still shows the cart and nothing else, and a
 * push sends the site the two files it builds from. Unity ignores a folder
 * named `~`, which is what keeps the source and node_modules out of the
 * import. Nothing here overwrites: a file already there is left alone and
 * reported, so running it twice is safe.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import { ignoreLocally, packageName, unignoreLocally, withRules } from "./init.mjs"
import { entryOf, manifestOf, readTree } from "./game.mjs"
import { buildConfig } from "./unity-config.mjs"
import { FORMER_PACKAGE, PACKAGE } from "../build/command.mjs"
import { RESERVED_ASSET_FOLDER } from "./assets.mjs"

/**
 * JSRunner's default files: the OneJS template, and where it lands in the
 * working directory. The same table as `templateMapping` in JSRunner.cs, held
 * to it by the container's test, since a published package cannot read the
 * C# it mirrors.
 */
export const TEMPLATE_MAPPING = [
    ["package.json.txt", "package.json"],
    ["tsconfig.json.txt", "tsconfig.json"],
    ["esbuild.config.mjs.txt", "esbuild.config.mjs"],
    ["index.tsx.txt", "index.tsx"],
    ["global.d.ts.txt", "types/global.d.ts"],
    ["main.uss.txt", "styles/main.uss"],
    ["gitignore.txt", ".gitignore"],
    ["AGENTS.md.txt", "AGENTS.md"],
]

/**
 * What else a JSRunner project grows in its working directory, for info/exclude:
 * the install, JSRunner's record of the defaults it gave (`.onejs/`), the
 * declarations the build writes beside `.sl` and `.module.uss` files, oj's
 * own output folder, and the copies of the cart's files in `assets/`.
 */
const GROWN = ["node_modules", "package-lock.json", ".onejs", ".oj", "*.sl.d.ts", "*.module.uss.d.ts", "/assets/"]

/** The scaffold's paths in the working directory: the cart brings its own entry, so not index.tsx. */
const SCAFFOLD = TEMPLATE_MAPPING.map(([, target]) => target).filter((t) => t !== "index.tsx")

/** What init --unity puts in the clone's info/exclude, and init --from-unity takes back out. */
const IGNORED = [...SCAFFOLD, ...GROWN]

/**
 * The scaffold files init --unity writes into the clone at `root`, as
 * [path, text], from the templates of the OneJS at `onejs`. One function for
 * both directions, so what --from-unity recognises is what --unity writes.
 */
export function scaffoldFiles(root, onejs) {
    const files = readTree(root)
    const entry = entryOf(files, manifestOf(files))
    const templates = path.join(onejs, "Editor", "Templates")
    return TEMPLATE_MAPPING.filter(([, target]) => SCAFFOLD.includes(target)).map(([template, target]) => {
        let text = fs.readFileSync(path.join(templates, template), "utf8")
        if (target === "package.json") text = packageJson(text, packageName(root), manifestOf(files)?.version)
        if (target === "esbuild.config.mjs") text = buildConfig(text, entry)
        // The oj alias, in the build and in tsconfig, follows the package.
        if (target === "esbuild.config.mjs" || target === "tsconfig.json") text = text.replaceAll(`node_modules/${FORMER_PACKAGE}/`, `node_modules/${PACKAGE}/`)
        return [target, text]
    })
}

/** What a Unity project without OneJS is told, by `init --unity` and by `add` before it fetches anything. */
export const NO_ONEJS = "This Unity project does not have OneJS installed yet. Install it from the Package Manager "
    + "(https://github.com/Singtaa/OneJS.git) and open the project once, then run this again."

/** The OneJS package's name, which is how an installed copy is recognised wherever it lives. */
const ONEJS = "com.singtaa.onejs"

/** JSRunner's script GUID, from the OneJS package. */
const JSRUNNER_SCRIPT = "35e89416e424048d08fdc44af24ad1b8"

/** Unity's built-in default runtime theme. The GUID is stable across projects. */
const DEFAULT_THEME = "d134caeb9dc27437193943e2515f3d24"

/** The Unity project `dir` is inside: the nearest folder up with Assets and a ProjectVersion.txt. */
export function unityProjectOf(dir) {
    for (let at = path.resolve(dir); ; at = path.dirname(at)) {
        if (fs.existsSync(path.join(at, "ProjectSettings", "ProjectVersion.txt")) && fs.existsSync(path.join(at, "Assets"))) return at
        if (path.dirname(at) === at) return null
    }
}

/**
 * The installed OneJS package's folder, wherever the project keeps it.
 *
 * From the Package Manager it is under Library/PackageCache (a git URL or the
 * registry), under Packages (embedded), or wherever packages-lock.json points
 * a `file:` dependency; from the Asset Store it is somewhere under Assets. Each
 * is recognised by its package.json's name rather than by where it sits, and
 * only one carrying JSRunner's templates counts.
 */
export function oneJSOf(project) {
    const candidates = []
    const cache = path.join(project, "Library", "PackageCache")
    if (fs.existsSync(cache)) {
        for (const name of fs.readdirSync(cache)) if (name.startsWith(`${ONEJS}@`)) candidates.push(path.join(cache, name))
    }
    try {
        const lock = JSON.parse(fs.readFileSync(path.join(project, "Packages", "packages-lock.json"), "utf8"))
        const version = lock.dependencies?.[ONEJS]?.version
        if (typeof version === "string" && version.startsWith("file:")) {
            candidates.push(path.resolve(project, "Packages", version.slice("file:".length)))
        }
    } catch { /* no lock yet: the editor has not resolved packages, and the walk below may still find it */ }
    const walk = (dir, depth) => {
        if (depth < 0 || !fs.existsSync(dir)) return
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.endsWith("~") || entry.name === "node_modules") continue
            const at = path.join(dir, entry.name)
            candidates.push(at)
            walk(at, depth - 1)
        }
    }
    walk(path.join(project, "Packages"), 0)
    walk(path.join(project, "Assets"), 3)
    return candidates.find((dir) => {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
            return pkg.name === ONEJS && fs.existsSync(path.join(dir, "Editor", "Templates", "package.json.txt"))
        } catch {
            return false
        }
    }) ?? null
}

/** This package's own version: the oj a clone set up by this command should build with. */
const OWN_VERSION = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version

/**
 * The template's package.json, named after the cart, with ojplay at least the
 * version writing it. The installed OneJS's template may pin an older one,
 * without the oj this cart was written against, or name it by its former
 * name, onejs-play (OneJS 3.2.3 to 3.9.2), which then gives way to ojplay.
 * Its version is the cart's own, or none: npm prints `> build` for a package
 * without one, where the template's 1.0.0 said `> lightning@1.0.0 build` for a
 * cart at 1.2.0.
 */
export function packageJson(template, name, version = null) {
    const pkg = JSON.parse(template)
    pkg.name = name
    if (typeof version === "string" && version !== "") pkg.version = version
    else delete pkg.version
    for (const deps of [pkg.dependencies, pkg.devDependencies]) {
        if (deps && FORMER_PACKAGE in deps) {
            delete deps[FORMER_PACKAGE]
            deps[PACKAGE] = ""
        }
        if (deps && PACKAGE in deps) deps[PACKAGE] = `^${OWN_VERSION}`
    }
    // The template carries "//"-prefixed notes for whoever opens it in the
    // editor. They mean nothing here, and npm reads such a key inside a
    // dependencies block as a package name and fails the install outright.
    for (const key of Object.keys(pkg)) if (key.startsWith("//")) delete pkg[key]
    return JSON.stringify(pkg, null, 2) + "\n"
}

/**
 * A GUID that is the same every time for the same asset path, so running this
 * twice, or on a teammate's machine, names the same assets.
 */
export function stableGuid(assetPath) {
    return crypto.createHash("sha256").update(assetPath).digest("hex").slice(0, 32)
}

/**
 * A name as a Unity object name: its letters, digits, underscores and
 * hyphens, so also a folder name with nothing to quote in a terminal.
 * `fallback` when nothing is left of it.
 */
export function objectName(name, fallback = "Cart") {
    const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "")
    return cleaned === "" ? fallback : cleaned
}

/**
 * A .meta file's full text. These are written rather than left for Unity to
 * mint, because the prefab points at the PanelSettings by GUID: left to
 * generate its own, Unity would give the PanelSettings a fresh one and the
 * prefab's reference would dangle.
 */
export const meta = (guid, importer) => `fileFormatVersion: 2\nguid: ${guid}\n${importer}:\n  externalObjects: {}\n${
    importer === "NativeFormatImporter" ? "  mainObjectFileID: 11400000\n" : ""}  userData: \n  assetBundleName: \n  assetBundleVariant: \n`

function panelSettings(name) {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 0}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 19101, guid: 0000000000000000e000000000000000, type: 0}
  m_Name: ${name}
  m_EditorClassIdentifier: UnityEngine.dll::UnityEngine.UIElements.PanelSettings
  themeUss: {fileID: -4733365628477956816, guid: ${DEFAULT_THEME}, type: 3}
  m_ScaleMode: 0
  m_ReferenceResolution: {x: 1920, y: 1080}
  m_Scale: 1
  m_ReferenceDpi: 96
  m_FallbackDpi: 96
`
}

/**
 * A GameObject carrying a JSRunner pointed at the PanelSettings beside it.
 * Only the fields that differ from JSRunner's defaults are written; Unity
 * fills in the rest, so a JSRunner that gains a field needs nothing here.
 */
function prefab(name, panelGuid, cart = null) {
    return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1000000000000000000
GameObject:
  m_ObjectHideFlags: 0
  serializedVersion: 6
  m_Component:
  - component: {fileID: 4000000000000000000}
  - component: {fileID: 114000000000000000}
  m_Layer: 0
  m_Name: ${name}
  m_TagString: Untagged
  m_IsActive: 1
--- !u!4 &4000000000000000000
Transform:
  m_ObjectHideFlags: 0
  m_GameObject: {fileID: 1000000000000000000}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_Children: []
  m_Father: {fileID: 0}
--- !u!114 &114000000000000000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_GameObject: {fileID: 1000000000000000000}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${JSRUNNER_SCRIPT}, type: 3}
  m_Name:
  m_EditorClassIdentifier: OneJS.Runtime::JSRunner
  _panelSettings: {fileID: 11400000, guid: ${panelGuid}, type: 2}
  _defaultThemeStylesheet: {fileID: -4733365628477956816, guid: ${DEFAULT_THEME}, type: 3}
${cart === null ? "" : `  _cart: ${yamlScalar(cart)}\n`}`
}

/**
 * A string as Unity's YAML holds it: bare when it reads back as itself, else
 * double quoted, which YAML reads with JSON's escapes.
 */
export function yamlScalar(text) {
    return /^[A-Za-z0-9_][A-Za-z0-9 _.()-]*$/.test(text) && !text.endsWith(" ") ? text : JSON.stringify(text)
}

/**
 * Whether the installed OneJS runs carts from the project's root: its
 * JSRunner declares the link by name, `string _cart` (Specs/ROOT_CARTS.md
 * §5.3 in the OneJS container). Read from the source the project has, so a
 * project on an older OneJS keeps getting carts in Assets/<Name>/~.
 */
export function runsRootCarts(onejs) {
    try {
        return /\bstring\s+_cart\b/.test(fs.readFileSync(path.join(onejs, "Runtime", "JSRunner.cs"), "utf8"))
    } catch {
        return false
    }
}

/**
 * The Unity half of a cart at the project's root: Assets/<folder>/ with a
 * PanelSettings, which is only panel settings now, and a prefab whose
 * JSRunner names the cart by its oj.json name. Stable GUIDs, as initUnity
 * writes them. Answers the prefab's asset path. Throws when either is there.
 */
export function rootCartRunner(project, folder, cartName) {
    const relative = `Assets/${folder}`
    if (fs.existsSync(path.join(project, relative))) throw new Error(`${relative} is already there. Move or delete it to take the cart again.`)
    const panelPath = `${relative}/PanelSettings.asset`
    const prefabPath = `${relative}/${folder}.prefab`
    const panelGuid = stableGuid(panelPath)
    const files = [
        [panelPath, panelSettings(folder)],
        [`${panelPath}.meta`, meta(panelGuid, "NativeFormatImporter")],
        [prefabPath, prefab(folder, panelGuid, cartName)],
        [`${prefabPath}.meta`, meta(stableGuid(prefabPath), "PrefabImporter")],
    ]
    fs.mkdirSync(path.join(project, relative), { recursive: true })
    for (const [file, text] of files) fs.writeFileSync(path.join(project, file), text)
    return prefabPath
}

/**
 * Writes the JSRunner project around the clone at `root`. Returns one line per
 * file, saying what happened, and the prefab's asset path. Throws with a
 * sentence when the clone is not somewhere a JSRunner project can be.
 */
export function initUnity(root) {
    root = path.resolve(root)
    if (path.basename(root) !== "~") {
        throw new Error(`Clone the cart into a folder named ~ inside Assets, such as Assets/${objectName(path.basename(root))}/~. `
            + "Unity ignores a folder named that, which keeps the source and node_modules out of the import.")
    }
    const project = unityProjectOf(root)
    const folder = path.dirname(root)
    const relative = project === null ? null : path.relative(project, folder).split(path.sep).join("/")
    if (relative === null || !relative.startsWith("Assets/")) {
        throw new Error("This clone is not inside a Unity project's Assets folder. Clone it to Assets/<Name>/~ in the project.")
    }
    const onejs = oneJSOf(project)
    if (onejs === null) throw new Error(NO_ONEJS)

    const lines = []
    const put = (file, shown, text) => {
        if (fs.existsSync(file)) { lines.push(`${shown}: already there, left alone`); return }
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, text)
        lines.push(`${shown}: written`)
    }

    for (const [target, text] of scaffoldFiles(root, onejs)) put(path.join(root, target), target, text)
    // Every scaffold path, whether written now or already there: a file this
    // run left alone is still not the cart's.
    lines.push(ignoreLocally(root, IGNORED.join("\n") + "\n"))

    const name = objectName(path.basename(folder))
    const panelPath = `${relative}/PanelSettings.asset`
    const prefabPath = `${relative}/${name}.prefab`
    const panelGuid = stableGuid(panelPath)
    put(path.join(project, panelPath), panelPath, panelSettings(name))
    put(path.join(project, `${panelPath}.meta`), `${panelPath}.meta`, meta(panelGuid, "NativeFormatImporter"))
    put(path.join(project, prefabPath), prefabPath, prefab(name, panelGuid))
    put(path.join(project, `${prefabPath}.meta`), `${prefabPath}.meta`, meta(stableGuid(prefabPath), "PrefabImporter"))
    const gltf = ensureGltfast(project, root)
    if (gltf !== null) lines.push(gltf)
    return { lines, prefab: prefabPath, onejs, gltf }
}

/**
 * `ojplay init --from-unity`, first half: takes out of a cart what init --unity
 * put in it, once the cart has moved from `Assets/<Name>/~` to the Unity
 * project's root, where it builds with this package and needs none of it
 * (Specs/ROOT_CARTS.md §5.9 in the OneJS container). OneJS's Move to Project
 * Root runs it in the moved folder, after the move.
 *
 * Only what init --unity would write today is removed, compared after line
 * endings: a file somebody changed, or one an older OneJS template wrote, is
 * left and listed, and so is anything in assets/ that is not a copy of the
 * cart's own file. The ojplay range in package.json is not compared, since it
 * names whichever version ran init --unity. The install goes only with the
 * package.json it installed. `.oj/` stays: it holds the carts this one uses
 * and the catalog's cover art.
 *
 * Returns the lines to report and the paths left, relative to the cart.
 */
export function undoUnity(root) {
    root = path.resolve(root)
    const project = unityProjectOf(path.dirname(root))
    if (project === null || fs.realpathSync(project) !== fs.realpathSync(path.dirname(root))) {
        throw new Error("Run this in a cart at a Unity project's root, after it has moved there from Assets/<Name>/~: "
            + "it takes out what init --unity put in the cart there.")
    }
    const onejs = oneJSOf(project)
    if (onejs === null) throw new Error(NO_ONEJS)

    const lines = []
    const left = []
    const remove = (rel) => {
        fs.rmSync(path.join(root, ...rel.split("/")), { recursive: true, force: true })
        removeEmptyParents(root, path.dirname(path.join(root, ...rel.split("/"))))
    }
    for (const [target, written] of scaffoldFiles(root, onejs)) {
        const file = path.join(root, ...target.split("/"))
        if (!fs.existsSync(file)) continue
        if (sameAsWritten(target, fs.readFileSync(file, "utf8"), written)) {
            remove(target)
            lines.push(`${target}: removed`)
        } else {
            left.push(target)
            lines.push(`${target}: changed since init --unity wrote it, left`)
        }
    }
    if (!fs.existsSync(path.join(root, "package.json"))) {
        for (const rel of ["node_modules", "package-lock.json"]) {
            if (fs.existsSync(path.join(root, rel))) { remove(rel); lines.push(`${rel}: removed, with the package.json it installed`) }
        }
    }
    if (fs.existsSync(path.join(root, ".onejs"))) { remove(".onejs"); lines.push(".onejs: removed") }
    const declarations = generatedDeclarations(root)
    for (const rel of declarations) remove(rel)
    if (declarations.length > 0) lines.push(`${declarations.length} generated declaration${declarations.length === 1 ? "" : "s"} (*.sl.d.ts, *.module.uss.d.ts): removed`)
    const assets = undoAssets(root)
    if (assets.removed > 0) lines.push(`assets/: ${assets.removed} cop${assets.removed === 1 ? "y" : "ies"} of the cart's files removed`)
    for (const rel of assets.left) {
        left.push(rel)
        lines.push(`${rel}: not a copy of a file of the cart's, left`)
    }
    const exclude = unignoreLocally(root, IGNORED)
    if (exclude !== null) lines.push(exclude)
    return { lines, left }
}

/**
 * Whether a scaffold file is what init --unity wrote. Line endings aside, and
 * for .gitignore also as ignoreLocally appends to it in a clone that is not a
 * repository. package.json is compared as JSON with the ojplay range set
 * aside.
 */
function sameAsWritten(target, have, written) {
    const lf = (text) => text.replace(/\r\n/g, "\n")
    if (target === "package.json") {
        const ranged = (text) => {
            try {
                const pkg = JSON.parse(text)
                for (const deps of [pkg.dependencies, pkg.devDependencies]) if (deps && PACKAGE in deps) deps[PACKAGE] = "*"
                return JSON.stringify(pkg)
            } catch {
                return null
            }
        }
        const a = ranged(have)
        return a !== null && a === ranged(written)
    }
    if (lf(have) === lf(written)) return true
    return target === ".gitignore" && lf(have) === lf(withRules(written, IGNORED.join("\n") + "\n").text)
}

/** The declarations the OneJS build writes beside .sl and .module.uss files, outside node_modules and dot folders. */
function generatedDeclarations(root) {
    const found = []
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue
            const rel = prefix + entry.name
            if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + "/")
            else if (entry.name.endsWith(".sl.d.ts") || entry.name.endsWith(".module.uss.d.ts")) found.push(rel)
        }
    }
    walk(root, "")
    return found
}

/**
 * assets/ is where the build copied the cart's files for OneJS (assetsPlugin).
 * A file there that is byte for byte the cart's file of the same name is a
 * copy and goes; anything else was put there some other way and stays.
 */
function undoAssets(root) {
    const into = path.join(root, RESERVED_ASSET_FOLDER)
    const result = { removed: 0, left: [] }
    if (!fs.existsSync(into)) return result
    const walk = (dir, prefix) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = prefix + entry.name
            const at = path.join(dir, entry.name)
            if (entry.isDirectory()) { walk(at, rel + "/"); continue }
            const source = path.join(root, ...rel.split("/"))
            if (entry.isFile() && fs.existsSync(source) && fs.readFileSync(source).equals(fs.readFileSync(at))) {
                fs.rmSync(at)
                result.removed++
            } else {
                result.left.push(`${RESERVED_ASSET_FOLDER}/${rel}`)
            }
        }
    }
    walk(into, "")
    removeEmptyFolders(into)
    return result
}

/** Removes `dir` and the folders under it that are empty once their empty folders are gone. */
function removeEmptyFolders(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) removeEmptyFolders(path.join(dir, entry.name))
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

/** Removes empty folders from `dir` up to, and not including, `root`: types/ once global.d.ts has gone. */
function removeEmptyParents(root, dir) {
    for (let at = dir; at !== root && at.startsWith(root + path.sep); at = path.dirname(at)) {
        if (!fs.existsSync(at) || fs.readdirSync(at).length > 0) return
        fs.rmdirSync(at)
    }
}

/** The package a cart's .glb models need in Unity, and the version `ojplay` adds when a project has none. */
export const GLTFAST_PACKAGE = "com.unity.cloud.gltfast"
export const GLTFAST_VERSION = "6.20.0"

/** Whether a cart holds any 3D model, anywhere a build would copy it from. */
function hasModels(root) {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).some((entry) => {
        if (entry.name.startsWith(".") || entry.name === "node_modules") return false
        if (entry.isDirectory()) return walk(path.join(dir, entry.name))
        return entry.isFile() && entry.name.toLowerCase().endsWith(".glb")
    })
    return walk(root)
}

/**
 * Adds glTFast to the project's packages when the cart has models and the
 * project lacks it, so the cart runs on the first open instead of throwing that
 * glTFast is missing. A version the project already names is the project's
 * choice and stays. Returns what it did, as a line, or null.
 */
export function ensureGltfast(project, root) {
    if (!hasModels(root)) return null
    const file = path.join(project, "Packages", "manifest.json")
    if (!fs.existsSync(file)) return null
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"))
    manifest.dependencies ??= {}
    if (GLTFAST_PACKAGE in manifest.dependencies) return null
    manifest.dependencies[GLTFAST_PACKAGE] = GLTFAST_VERSION
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
    return `Added ${GLTFAST_PACKAGE} ${GLTFAST_VERSION} to Packages/manifest.json: this cart has 3D models, and Unity installs it when the project next opens.`
}

/** npm in `root`, output passed through. Returns the exit code. */
export function npm(root, args) {
    const bin = process.platform === "win32" ? "npm.cmd" : "npm"
    const result = spawnSync(bin, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" })
    return result.status ?? 1
}
