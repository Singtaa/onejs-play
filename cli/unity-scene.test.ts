import { afterAll, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { editorOpen, hasPrefab, instanceId, placePrefab, withPrefab } from "./unity-scene.mjs"

/**
 * Unity 6000.5.2f1's own output, saved from a batchmode run: a new default
 * scene (before.unity), and the same scene after PrefabUtility placed a prefab
 * named Probe in it (after.unity). What add writes is held to Unity's bytes.
 */
const FIXTURES = path.join(import.meta.dirname, "fixtures", "unity-scene")
const BEFORE = fs.readFileSync(path.join(FIXTURES, "before.unity"), "utf8")
const AFTER = fs.readFileSync(path.join(FIXTURES, "after.unity"), "utf8")
const PROBE = { guid: "14a57e46f2558e8a69d70908513ecab4", name: "Probe", id: "1471937870" }

const crlf = (text: string) => text.replaceAll("\n", "\r\n")
const instances = (text: string) => text.split("\n").filter((l) => l.startsWith("--- !u!1001 &")).length

describe("a prefab placed in a scene's text", () => {
    it("is what Unity writes when it places one", () => {
        expect(withPrefab(BEFORE, PROBE)).toBe(AFTER)
    })

    it("keeps a scene's CRLF line ends", () => {
        expect(withPrefab(crlf(BEFORE), PROBE)).toBe(crlf(AFTER))
    })

    it("goes at the end of a scene with no SceneRoots, as before Unity 2023", () => {
        const old = BEFORE.slice(0, BEFORE.indexOf("--- !u!1660057539"))
        const placed = withPrefab(old, PROBE)
        expect(placed.startsWith(old)).toBe(true)
        expect(placed.slice(old.length)).toBe(AFTER.slice(BEFORE.indexOf("--- !u!1660057539"), AFTER.indexOf("--- !u!1660057539")))
    })

    it("is seen once it is there", () => {
        expect(hasPrefab(BEFORE, PROBE.guid)).toBe(false)
        expect(hasPrefab(AFTER, PROBE.guid)).toBe(true)
        expect(hasPrefab(crlf(AFTER), PROBE.guid)).toBe(true)
    })

    it("gets a fileID no object in the scene already has, the same one each time", () => {
        const id = instanceId(BEFORE, "Assets/Scenes/Main.unity|" + PROBE.guid)
        expect(id).toMatch(/^[1-9][0-9]{8,9}$/)
        expect(instanceId(BEFORE, "Assets/Scenes/Main.unity|" + PROBE.guid)).toBe(id)
        // A scene already using that number, as an object or a reference.
        for (const taken of [`--- !u!1 &${id}\nGameObject:\n`, `  m_Father: {fileID: ${id}}\n`]) {
            const other = instanceId(BEFORE + taken, "Assets/Scenes/Main.unity|" + PROBE.guid)
            expect(other).not.toBe(id)
            expect(BEFORE + taken).not.toContain(other)
        }
    })
})

describe("placePrefab in a Unity project", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ojplay-scene-"))
    afterAll(() => fs.rmSync(temp, { recursive: true, force: true }))
    let n = 0

    const SETTINGS = (scenes: string) => `%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1045 &1\nEditorBuildSettings:\n  m_ObjectHideFlags: 0\n  serializedVersion: 2\n  m_Scenes:${scenes}\n  m_configObjects: {}\n`
    const PREFAB = "Assets/HUD/HUD.prefab"
    const PREFAB_GUID = "0123456789abcdef0123456789abcdef"

    /** A project with the prefab and its .meta, and `files` beside them. */
    function project(files: Record<string, string>): string {
        const root = path.join(temp, `P${n++}`)
        for (const [file, text] of Object.entries({
            "ProjectSettings/ProjectVersion.txt": "m_EditorVersion: 6000.5.2f1\n",
            [PREFAB]: "%YAML 1.1\n",
            [`${PREFAB}.meta`]: `fileFormatVersion: 2\nguid: ${PREFAB_GUID}\nPrefabImporter:\n`,
            ...files,
        })) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
            fs.writeFileSync(path.join(root, file), text)
        }
        return root
    }
    const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), "utf8")
    const tree = (root: string) => {
        const out: Record<string, string> = {}
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const at = path.join(dir, e.name)
                if (e.isDirectory()) walk(at)
                else out[path.relative(root, at)] = fs.readFileSync(at, "utf8")
            }
        }
        walk(root)
        return out
    }

    it("writes nothing while an editor has the project open", () => {
        const root = project({
            "ProjectSettings/EditorBuildSettings.asset": SETTINGS(" []"),
            "Temp/UnityLockfile": "",
        })
        expect(editorOpen(root)).toBe(true)
        const was = tree(root)
        expect(placePrefab(root, PREFAB, "HUD")).toBeNull()
        expect(tree(root)).toEqual(was)
    })

    it("makes Assets/Scenes/Main.unity with a camera when the build list is empty, and lists it", () => {
        const root = project({ "ProjectSettings/EditorBuildSettings.asset": SETTINGS(" []") })
        expect(editorOpen(root)).toBe(false)
        expect(placePrefab(root, PREFAB, "HUD")).toEqual({ scene: "Assets/Scenes/Main.unity", made: true, listed: true, already: false })
        const scene = read(root, "Assets/Scenes/Main.unity")
        expect(scene).toContain("  m_Name: Main Camera\n")
        expect(hasPrefab(scene, PREFAB_GUID)).toBe(true)
        expect(instances(scene)).toBe(1)
        expect(scene).toContain("      value: HUD\n")
        const guid = /^guid: ([0-9a-f]{32})$/m.exec(read(root, "Assets/Scenes/Main.unity.meta"))![1]
        expect(read(root, "ProjectSettings/EditorBuildSettings.asset")).toBe(SETTINGS(`\n  - enabled: 1\n    path: Assets/Scenes/Main.unity\n    guid: ${guid}`))
    })

    it("uses the first enabled build scene that is there, and leaves the list alone", () => {
        const settings = SETTINGS([
            "\n  - enabled: 1\n    path: Assets/Gone.unity\n    guid: 11111111111111111111111111111111",
            "\n  - enabled: 0\n    path: Assets/Off.unity\n    guid: 22222222222222222222222222222222",
            "\n  - enabled: 1\n    path: Assets/Levels/Level 1.unity\n    guid: 33333333333333333333333333333333",
        ].join(""))
        const root = project({
            "ProjectSettings/EditorBuildSettings.asset": settings,
            "Assets/Off.unity": BEFORE,
            "Assets/Levels/Level 1.unity": crlf(BEFORE),
        })
        expect(placePrefab(root, PREFAB, "HUD")).toEqual({ scene: "Assets/Levels/Level 1.unity", made: false, listed: false, already: false })
        const scene = read(root, "Assets/Levels/Level 1.unity")
        expect(scene).toBe(withPrefab(crlf(BEFORE), { guid: PREFAB_GUID, name: "HUD", id: instanceId(crlf(BEFORE), `Assets/Levels/Level 1.unity|${PREFAB_GUID}`) }))
        expect(read(root, "Assets/Off.unity")).toBe(BEFORE)
        expect(read(root, "ProjectSettings/EditorBuildSettings.asset")).toBe(settings)
        expect(fs.existsSync(path.join(root, "Assets/Scenes"))).toBe(false)
    })

    it("places it once, however many times it runs", () => {
        const root = project({ "ProjectSettings/EditorBuildSettings.asset": SETTINGS(" []") })
        placePrefab(root, PREFAB, "HUD")
        const was = tree(root)
        expect(placePrefab(root, PREFAB, "HUD")).toEqual({ scene: "Assets/Scenes/Main.unity", made: false, listed: false, already: true })
        expect(tree(root)).toEqual(was)
        expect(instances(read(root, "Assets/Scenes/Main.unity"))).toBe(1)
    })

    it("puts it in an unlisted Main.unity that is already there, and lists that", () => {
        const root = project({
            "ProjectSettings/EditorBuildSettings.asset": SETTINGS("\n  - enabled: 0\n    path: Assets/Off.unity\n    guid: 22222222222222222222222222222222"),
            "Assets/Off.unity": BEFORE,
            "Assets/Scenes/Main.unity": BEFORE,
            "Assets/Scenes/Main.unity.meta": "fileFormatVersion: 2\nguid: 00733e0ce833d4ee5ab302274313a079\nDefaultImporter:\n",
        })
        expect(placePrefab(root, PREFAB, "HUD")).toEqual({ scene: "Assets/Scenes/Main.unity", made: false, listed: true, already: false })
        expect(instances(read(root, "Assets/Scenes/Main.unity"))).toBe(1)
        expect(read(root, "Assets/Scenes/Main.unity").startsWith(BEFORE.slice(0, BEFORE.indexOf("--- !u!1660057539")))).toBe(true)
        expect(read(root, "ProjectSettings/EditorBuildSettings.asset")).toBe(SETTINGS([
            "\n  - enabled: 0\n    path: Assets/Off.unity\n    guid: 22222222222222222222222222222222",
            "\n  - enabled: 1\n    path: Assets/Scenes/Main.unity\n    guid: 00733e0ce833d4ee5ab302274313a079",
        ].join("")))
    })
})
