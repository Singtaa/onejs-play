/**
 * `ojp init --unity`: a clone turned into a JSRunner project, in place, inside
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
import { ignoreLocally, packageName } from "./init.mjs"
import { entryOf, manifestOf, readTree } from "./game.mjs"
import { buildConfig } from "./unity-assets.mjs"
import { FORMER_PACKAGE, PACKAGE } from "../build/command.mjs"

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
 * The template's package.json, named after the cart, with ojp at least the
 * version writing it. The installed OneJS's template may pin an older one,
 * without the oj this cart was written against, or name it by its former
 * name, onejs-play (OneJS 3.2.3 to 3.9.2), which then gives way to ojp.
 */
export function packageJson(template, name) {
    const pkg = JSON.parse(template)
    pkg.name = name
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

/** A folder name as a Unity object name: the letters, digits, spaces, underscores and hyphens of it. */
function objectName(folder) {
    const cleaned = folder.replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "")
    return cleaned === "" ? "Cart" : cleaned
}

/**
 * A .meta file's full text. These are written rather than left for Unity to
 * mint, because the prefab points at the PanelSettings by GUID: left to
 * generate its own, Unity would give the PanelSettings a fresh one and the
 * prefab's reference would dangle.
 */
const meta = (guid, importer) => `fileFormatVersion: 2\nguid: ${guid}\n${importer}:\n  externalObjects: {}\n${
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
function prefab(name, panelGuid) {
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
`
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

    const files = readTree(root)
    const entry = entryOf(files, manifestOf(files))
    const templates = path.join(onejs, "Editor", "Templates")
    for (const [template, target] of TEMPLATE_MAPPING) {
        // The cart brings its own entry. JSRunner's index.tsx would only be
        // a second one beside it.
        if (target === "index.tsx") continue
        let text = fs.readFileSync(path.join(templates, template), "utf8")
        if (target === "package.json") text = packageJson(text, packageName(root))
        if (target === "esbuild.config.mjs") text = buildConfig(text, entry)
        // The oj alias, in the build and in tsconfig, follows the package.
        if (target === "esbuild.config.mjs" || target === "tsconfig.json") text = text.replaceAll(`node_modules/${FORMER_PACKAGE}/`, `node_modules/${PACKAGE}/`)
        put(path.join(root, target), target, text)
    }
    // Every scaffold path, whether written now or already there: a file this
    // run left alone is still not the cart's.
    const scaffold = TEMPLATE_MAPPING.map(([, target]) => target).filter((t) => t !== "index.tsx")
    lines.push(ignoreLocally(root, [...scaffold, ...GROWN].join("\n") + "\n"))

    const name = objectName(path.basename(folder))
    const panelPath = `${relative}/PanelSettings.asset`
    const prefabPath = `${relative}/${name}.prefab`
    const panelGuid = stableGuid(panelPath)
    put(path.join(project, panelPath), panelPath, panelSettings(name))
    put(path.join(project, `${panelPath}.meta`), `${panelPath}.meta`, meta(panelGuid, "NativeFormatImporter"))
    put(path.join(project, prefabPath), prefabPath, prefab(name, panelGuid))
    put(path.join(project, `${prefabPath}.meta`), `${prefabPath}.meta`, meta(stableGuid(prefabPath), "PrefabImporter"))
    return { lines, prefab: prefabPath, onejs }
}

/** npm in `root`, output passed through. Returns the exit code. */
export function npm(root, args) {
    const bin = process.platform === "win32" ? "npm.cmd" : "npm"
    const result = spawnSync(bin, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" })
    return result.status ?? 1
}
