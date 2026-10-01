/**
 * `ojplay add` at a Unity project's root puts the cart's prefab in a scene, so
 * the next step is pressing Play rather than finding the prefab and dragging
 * it in (Tachi, 1 Oct: an agent has no headless way to drag).
 *
 * The scene is chosen as OneJS's ProjectSetup.Initialize chooses one: the
 * first enabled build scene that is there, else Assets/Scenes/Main.unity, made
 * if it is not there and listed in the build settings if it is not listed, so
 * a player build includes it.
 *
 * Only while no editor has the project open. An open editor holds the scene in
 * memory and writes it back over anything written under it, so then nothing
 * here touches a file and add says to drag the prefab in. Temp/UnityLockfile
 * is the editor's own mark that it has the project; Unity deletes the Temp
 * folder when it quits, and one left by a crash only costs the drag line.
 *
 * The scene text is written as Unity writes it, which unity-scene.test.ts
 * holds to Unity 6000.5's own bytes for the same placement.
 */
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { meta, stableGuid } from "./unity.mjs"

/** The scene made when there is none to use. */
export const MAIN_SCENE = "Assets/Scenes/Main.unity"

/** The YAML header every Unity text asset starts with. */
const HEADER = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n"

/** The marker line of a scene's SceneRoots block (Unity 2023 and later). */
const ROOTS = "--- !u!1660057539 &"

/**
 * A new scene: Unity's default Main Camera and the roots list. The scene-wide
 * settings blocks are left out and Unity fills in their defaults on load; they
 * are the part of a scene that changes between versions. Without a camera the
 * Game view says "No cameras rendering" behind the panel.
 */
const NEW_SCENE = `${HEADER}--- !u!1 &1281278647
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 1281278650}
  - component: {fileID: 1281278649}
  - component: {fileID: 1281278648}
  m_Layer: 0
  m_Name: Main Camera
  m_TagString: MainCamera
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!81 &1281278648
AudioListener:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1281278647}
  m_Enabled: 1
--- !u!20 &1281278649
Camera:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1281278647}
  m_Enabled: 1
  serializedVersion: 2
  m_ClearFlags: 1
  m_BackGroundColor: {r: 0.19215687, g: 0.3019608, b: 0.4745098, a: 0}
  m_projectionMatrixMode: 1
  m_GateFitMode: 2
  m_FOVAxisMode: 0
  m_Iso: 200
  m_ShutterSpeed: 0.005
  m_Aperture: 16
  m_FocusDistance: 10
  m_FocalLength: 50
  m_BladeCount: 5
  m_Curvature: {x: 2, y: 11}
  m_BarrelClipping: 0.25
  m_Anamorphism: 0
  m_SensorSize: {x: 36, y: 24}
  m_LensShift: {x: 0, y: 0}
  m_NormalizedViewPortRect:
    serializedVersion: 2
    x: 0
    y: 0
    width: 1
    height: 1
  near clip plane: 0.3
  far clip plane: 1000
  field of view: 60
  orthographic: 0
  orthographic size: 5
  m_Depth: -1
  m_CullingMask:
    serializedVersion: 2
    m_Bits: 4294967295
  m_RenderingPath: -1
  m_TargetTexture: {fileID: 0}
  m_TargetDisplay: 0
  m_TargetEye: 3
  m_HDR: 1
  m_AllowMSAA: 1
  m_AllowDynamicResolution: 0
  m_ForceIntoRT: 0
  m_OcclusionCulling: 1
  m_StereoConvergence: 10
  m_StereoSeparation: 0.022
--- !u!4 &1281278650
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 1281278647}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 1, z: -10}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_ConstrainProportionsScale: 0
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
${ROOTS}9223372036854775807
SceneRoots:
  m_ObjectHideFlags: 0
  m_Roots:
  - {fileID: 1281278650}
`

/** The build settings Unity writes, for a project that has none yet. */
const NEW_SETTINGS = `${HEADER}--- !u!1045 &1\nEditorBuildSettings:\n  m_ObjectHideFlags: 0\n  serializedVersion: 2\n  m_Scenes: []\n  m_configObjects: {}\n`

/** Whether an editor has the project open. */
export function editorOpen(project) {
    return fs.existsSync(path.join(project, "Temp", "UnityLockfile"))
}

const source = (guid) => `  m_SourcePrefab: {fileID: 100100000, guid: ${guid}, type: 3}`

/** Whether the scene's text already has an instance of the prefab with this GUID. */
export function hasPrefab(text, guid) {
    return text.includes(source(guid))
}

/**
 * A fileID for a new object in the scene: no number in the scene's text
 * contains it, and the same `seed` against the same text gives the same one.
 */
export function instanceId(text, seed) {
    for (let i = 0; ; i++) {
        const hash = crypto.createHash("sha256").update(`${seed}|${i}`).digest()
        const id = String(1000000000 + (hash.readUInt32BE(0) % 1000000000))
        if (!text.includes(id)) return id
    }
}

/** The PrefabInstance block Unity writes for a prefab placed at the origin, unparented. */
function instanceBlock({ guid, name, id }) {
    const mod = (target, property, value) => `    - target: {fileID: ${target}, guid: ${guid}, type: 3}
      propertyPath: ${property}
      value: ${value}
      objectReference: {fileID: 0}
`
    // The prefab's own GameObject and Transform, as unity.mjs writes them.
    const go = "1000000000000000000", transform = "4000000000000000000"
    return `--- !u!1001 &${id}
PrefabInstance:
  m_ObjectHideFlags: 0
  serializedVersion: 2
  m_Modification:
    serializedVersion: 3
    m_TransformParent: {fileID: 0}
    m_Modifications:
${mod(go, "m_Name", name)}${[
        ["m_LocalPosition.x", 0], ["m_LocalPosition.y", 0], ["m_LocalPosition.z", 0],
        ["m_LocalRotation.w", 1], ["m_LocalRotation.x", 0], ["m_LocalRotation.y", 0], ["m_LocalRotation.z", 0],
        ["m_LocalEulerAnglesHint.x", 0], ["m_LocalEulerAnglesHint.y", 0], ["m_LocalEulerAnglesHint.z", 0],
    ].map(([p, v]) => mod(transform, p, v)).join("")}    m_RemovedComponents: []
    m_RemovedGameObjects: []
    m_AddedGameObjects: []
    m_AddedComponents: []
${source(guid)}
`
}

/**
 * A scene's text with an instance of the prefab added, as a root, keeping the
 * scene's line ends. Unchanged when the prefab is already there.
 */
export function withPrefab(text, { guid, name, id }) {
    if (hasPrefab(text, guid)) return text
    const eol = text.includes("\r\n") ? "\r\n" : "\n"
    let s = text.replaceAll("\r\n", "\n")
    if (!s.endsWith("\n")) s += "\n"
    const block = instanceBlock({ guid, name, id })
    const at = s.indexOf(`\n${ROOTS}`)
    if (at < 0) {
        // Before Unity 2023 a scene has no roots list, and an object is a
        // root because nothing parents it.
        s += block
    } else {
        s = s.slice(0, at + 1) + block + s.slice(at + 1)
        s = withListItem(s, s.indexOf(ROOTS, at), "  m_Roots:", `  - {fileID: ${id}}`)
    }
    return s.replaceAll("\n", eol)
}

/**
 * `text` with `item` appended to the YAML list under the line `key` (the
 * first after `from`), turning an empty `key []` into a list.
 */
function withListItem(text, from, key, item) {
    const lines = text.slice(from).split("\n")
    const k = lines.findIndex((l) => l === key || l === `${key} []`)
    if (k < 0) throw new Error(`no ${key.trim()} list`)
    if (lines[k] === `${key} []`) {
        lines[k] = key
    }
    let end = k + 1
    while (end < lines.length && (lines[end].startsWith("  - ") || lines[end].startsWith("    "))) end++
    lines.splice(end, 0, item)
    return text.slice(0, from) + lines.join("\n")
}

/** The build list's entries, in order. */
function buildScenes(settings) {
    return [...settings.replaceAll("\r\n", "\n").matchAll(/^ {2}- enabled: (\d+)\n {4}path: (.*)\n {4}guid: ([0-9a-f]*)$/gm)]
        .map((m) => ({ enabled: m[1] !== "0", path: m[2] }))
}

const guidOf = (metaFile) => /^guid: ([0-9a-f]{32})\s*$/m.exec(fs.readFileSync(metaFile, "utf8"))?.[1] ?? null

/**
 * Puts the prefab at `prefabPath` (an asset path) in the project's scene.
 * Returns the scene's asset path and what was done: `made` the scene,
 * `listed` it in the build settings, or found the prefab `already` there.
 * Null, and nothing written, while an editor has the project open.
 */
export function placePrefab(project, prefabPath, name) {
    if (editorOpen(project)) return null
    const guid = guidOf(path.join(project, `${prefabPath}.meta`))
    if (guid === null) throw new Error(`${prefabPath}.meta has no guid`)

    const settingsFile = path.join(project, "ProjectSettings", "EditorBuildSettings.asset")
    const settings = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, "utf8") : null
    const listed = settings === null ? [] : buildScenes(settings)
    const first = listed.find((s) => s.enabled && fs.existsSync(path.join(project, s.path)))
    const scene = first?.path ?? MAIN_SCENE
    const file = path.join(project, scene)
    const made = !fs.existsSync(file)
    const list = !listed.some((s) => s.path === scene)

    const text = made ? NEW_SCENE : fs.readFileSync(file, "utf8")
    const already = hasPrefab(text, guid)
    if (made) {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        if (!fs.existsSync(`${file}.meta`)) fs.writeFileSync(`${file}.meta`, meta(stableGuid(scene), "DefaultImporter"))
    }
    if (!already) fs.writeFileSync(file, withPrefab(text, { guid, name, id: instanceId(text, `${scene}|${guid}`) }))
    if (list) {
        const sceneGuid = fs.existsSync(`${file}.meta`) ? guidOf(`${file}.meta`) : null
        const base = settings ?? NEW_SETTINGS
        const eol = base.includes("\r\n") ? "\r\n" : "\n"
        const item = `  - enabled: 1\n    path: ${scene}\n    guid: ${sceneGuid ?? "00000000000000000000000000000000"}`
        fs.writeFileSync(settingsFile, withListItem(base.replaceAll("\r\n", "\n"), 0, "  m_Scenes:", item).replaceAll("\n", eol))
    }
    return { scene, made, listed: list, already }
}
