/**
 * Stored files, from a terminal (play.onejs.com's docs/refs-and-assets.md, Part 2).
 *
 * A file of an asset type that is 1 MB or more leaves git: the commit holds
 * Git LFS's three line pointer and the bytes go to the site's store, named by
 * their SHA-256. Nothing about that is the person's to do. `ojplay init` makes
 * ojplay this clone's git filter and pre-push hook, in .git/config,
 * .git/info/attributes and .git/hooks, so nothing is committed for it:
 *
 *   git add     the clean filter writes the pointer and keeps the bytes in
 *               the cache, ~/.onejs-play/store/
 *   git push    the hook sends the cache's bytes for every pointer the push
 *               carries that the store lacks, then git sends the pointers
 *   checkout    the smudge filter puts the real bytes back, from the cache or
 *               the store, so the working folder always holds the real file
 *
 * One long-running filter process per git command (git's filter protocol,
 * version 2), not one node per file.
 *
 * The rule is the site's, copied, as cli/assets.mjs copies its asset rule:
 * PlaySite/src/store/config.mjs and pointer.ts. PlaySite's
 * src/store-rule-parity.test.ts holds the two to the same answers.
 */
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { ASSET_TYPES, isUploadableAsset } from "./assets.mjs"
import { home } from "./local.mjs"
import { addressFromRemote, sidFromRemote, tokenOf } from "./site.mjs"
import { COMMAND, PACKAGE } from "../build/command.mjs"

/** A file of a stored type at least this big leaves git. PlaySite STORE_MIN_BYTES. */
export const STORE_MIN_BYTES = 1024 * 1024

/** Where the store serves a file a cart's own site does not answer for. PlaySite STORE_ORIGIN. */
export const STORE_ORIGIN = "https://store.onejsusercontent.com"

const LFS_TYPE = "application/vnd.git-lfs+json"
const VERSION = "version https://git-lfs.github.com/spec/v1"
const MAX_POINTER_BYTES = 1024
const HOOK_MARK = "# ojplay pre-push: sends stored files before the push"

/** Whether a file at `name` of `size` bytes leaves git. */
export function isStored(name, size) {
    return size >= STORE_MIN_BYTES && isUploadableAsset(name)
}

/** The store's object key for these bytes under this name. PlaySite storeKey. */
export function storeKey(sha256, name) {
    const base = name.slice(name.lastIndexOf("/") + 1)
    const dot = base.lastIndexOf(".")
    return dot <= 0 ? sha256 : sha256 + base.slice(dot).toLowerCase()
}

export function formatPointer({ sha256, size }) {
    return `${VERSION}\noid sha256:${sha256}\nsize ${size}\n`
}

/** The pointer `data` spells, or null when it is a file. PlaySite parsePointer. */
export function parsePointer(data) {
    const length = typeof data === "string" ? data.length : data.byteLength
    if (length === 0 || length > MAX_POINTER_BYTES) return null
    const text = typeof data === "string" ? data : Buffer.from(data).toString("utf8")
    if (!text.startsWith(`${VERSION}\n`) || !text.endsWith("\n")) return null
    let sha256 = null
    let size = null
    let previous = ""
    for (const line of text.slice(VERSION.length + 1, -1).split("\n")) {
        const space = line.indexOf(" ")
        if (space <= 0) return null
        const key = line.slice(0, space)
        const value = line.slice(space + 1)
        if (key <= previous) return null
        previous = key
        if (key === "oid") {
            const m = /^sha256:([0-9a-f]{64})$/.exec(value)
            if (m === null) return null
            sha256 = m[1]
        } else if (key === "size") {
            if (!/^(0|[1-9][0-9]{0,15})$/.test(value)) return null
            size = Number(value)
        } else if (!/^ext-\d+-[a-z0-9]+$/.test(key)) {
            return null
        }
    }
    return sha256 === null || size === null ? null : { sha256, size }
}

const sha256Of = (data) => createHash("sha256").update(data).digest("hex")

export function storeDir() {
    return path.join(home(), "store")
}

export function cached(sha256) {
    return path.join(storeDir(), sha256.slice(0, 2), sha256)
}

/** Writes bytes into the cache whole, under their final name only once they are all there. */
function keep(sha256, data) {
    const file = cached(sha256)
    if (fs.existsSync(file)) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const partial = `${file}.${process.pid}.partial`
    fs.writeFileSync(partial, data)
    fs.renameSync(partial, file)
}

function readCached(sha256, size) {
    try {
        const data = fs.readFileSync(cached(sha256))
        return data.byteLength === size ? data : null
    } catch {
        return null
    }
}

/** What `git add` stores for the file at `name`: its pointer when it leaves git, else the file. */
export function clean(name, data) {
    if (parsePointer(data) !== null || !isStored(name, data.byteLength)) return data
    const sha256 = sha256Of(data)
    keep(sha256, data)
    return Buffer.from(formatPointer({ sha256, size: data.byteLength }))
}

/**
 * What a checkout writes for the file at `name`: the real bytes behind a
 * pointer, from the cache or else the store. A pointer whose bytes cannot be
 * had stays a pointer, with a line saying why, so a clone without a network
 * still checks out.
 */
export async function smudge(name, data, { cwd, say = (line) => process.stderr.write(`[ojplay] ${line}\n`) } = {}) {
    const pointer = parsePointer(data)
    if (pointer === null) return data
    const have = readCached(pointer.sha256, pointer.size)
    if (have !== null) return have
    try {
        const fetched = await fetchStored(cwd, { ...pointer, name })
        keep(pointer.sha256, fetched)
        return fetched
    } catch (error) {
        say(`${name} is left as a pointer: ${error.message}`)
        return data
    }
}

function gitOut(args, cwd) {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    return r.status === 0 ? r.stdout : null
}

/** The cart's LFS endpoint when `url` is one of the site's remotes, else null. */
export function lfsEndpoint(url) {
    if (typeof url !== "string" || (sidFromRemote(url) === null && addressFromRemote(url) === null)) return null
    return `${url.replace(/\/$/, "")}/info/lfs`
}

async function lfsBatch(endpoint, operation, objects, bearer) {
    const response = await fetch(`${endpoint}/objects/batch`, {
        method: "POST",
        headers: {
            accept: LFS_TYPE, "content-type": LFS_TYPE,
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ operation, transfers: ["basic"], objects, hash_algo: "sha256" }),
    })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { throw new Error(`${response.status} from ${new URL(endpoint).host}: ${text.slice(0, 200)}`) }
    if (!response.ok) throw new Error(body.message ?? `${response.status} from ${new URL(endpoint).host}`)
    return body.objects
}

/** One stored file's bytes, through the cart's own remote when it is the site's, checked against their hash. */
export async function fetchStored(cwd, { sha256, size, name }) {
    const remote = gitOut(["remote", "get-url", "origin"], cwd)?.trim()
    const endpoint = lfsEndpoint(remote)
    let href = `${STORE_ORIGIN}/${storeKey(sha256, name)}`
    if (endpoint !== null) {
        const [answer] = await lfsBatch(endpoint, "download", [{ oid: sha256, size, name }], tokenOf(cwd))
        if (answer?.error) throw new Error(answer.error.message)
        href = answer.actions.download.href
    }
    const response = await fetch(href)
    if (!response.ok) throw new Error(`${response.status} from ${new URL(href).host}`)
    const data = Buffer.from(await response.arrayBuffer())
    if (sha256Of(data) !== sha256) throw new Error("the bytes that came back are not the file the pointer names")
    return data
}

// ---------- git's long-running filter protocol, version 2 ----------

const FLUSH = Symbol("flush")
const MAX_PACKET = 65516

/** Reads pkt-lines from a stream: a Buffer per packet, FLUSH for 0000, null at the end. */
function packets(stream) {
    const chunks = []
    let length = 0
    let ended = false
    let wake = null
    stream.on("data", (chunk) => { chunks.push(chunk); length += chunk.length; wake?.() })
    stream.on("end", () => { ended = true; wake?.() })
    const need = async (n) => {
        while (length < n) {
            if (ended) return false
            await new Promise((resolve) => { wake = resolve })
            wake = null
        }
        return true
    }
    const take = (n) => {
        const out = Buffer.allocUnsafe(n)
        let at = 0
        while (at < n) {
            const head = chunks[0]
            const used = Math.min(head.length, n - at)
            head.copy(out, at, 0, used)
            at += used
            if (used === head.length) chunks.shift()
            else chunks[0] = head.subarray(used)
        }
        length -= n
        return out
    }
    return async () => {
        if (!await need(4)) return null
        const size = parseInt(take(4).toString("ascii"), 16)
        if (size === 0) return FLUSH
        if (!await need(size - 4)) return null
        return take(size - 4)
    }
}

function writer(stream) {
    const out = []
    const pkt = (data) => {
        const buf = typeof data === "string" ? Buffer.from(data) : data
        for (let at = 0; at < buf.length; at += MAX_PACKET) {
            const part = buf.subarray(at, at + MAX_PACKET)
            out.push(Buffer.from((part.length + 4).toString(16).padStart(4, "0")), part)
        }
    }
    return {
        text: (line) => pkt(`${line}\n`),
        data: pkt,
        flush: () => out.push(Buffer.from("0000")),
        send: () => new Promise((resolve) => {
            const all = Buffer.concat(out.splice(0))
            if (stream.write(all)) resolve()
            else stream.once("drain", resolve)
        }),
    }
}

async function lines(read) {
    const out = []
    for (;;) {
        const p = await read()
        if (p === null) return null
        if (p === FLUSH) return out
        out.push(p.toString("utf8").replace(/\n$/, ""))
    }
}

/** `ojplay filter-process`, which git starts as this clone's filter.oj.process. */
export async function filterProcess({ input = process.stdin, output = process.stdout, cwd = process.cwd() } = {}) {
    const read = packets(input)
    const w = writer(output)
    const hello = await lines(read)
    if (hello === null || hello[0] !== "git-filter-client" || !hello.includes("version=2")) {
        throw new Error("filter-process is started by git, as filter.oj.process")
    }
    w.text("git-filter-server"); w.text("version=2"); w.flush()
    await w.send()
    const offered = await lines(read)
    for (const capability of ["clean", "smudge"]) {
        if (offered?.includes(`capability=${capability}`)) w.text(`capability=${capability}`)
    }
    w.flush()
    await w.send()

    for (;;) {
        const headers = await lines(read)
        if (headers === null) return 0
        const field = (key) => headers.find((h) => h.startsWith(`${key}=`))?.slice(key.length + 1)
        const parts = []
        for (;;) {
            const p = await read()
            if (p === null) return 0
            if (p === FLUSH) break
            parts.push(p)
        }
        const content = Buffer.concat(parts)
        const name = field("pathname") ?? ""
        try {
            const result = field("command") === "clean" ? clean(name, content) : await smudge(name, content, { cwd })
            w.text("status=success"); w.flush()
            w.data(result); w.flush()
            w.flush()
        } catch (error) {
            process.stderr.write(`[ojplay] ${name}: ${error.message}\n`)
            w.text("status=error"); w.flush()
        }
        await w.send()
    }
}

// ---------- sending a push's stored files ----------

/**
 * The pointers a push carries that the remote may lack, as { sha256, size,
 * name }: every blob reachable from the pushed tips and not from what the
 * remote already has, small enough to be a pointer and parsing as one.
 */
export function pointersToPush(cwd, updates, remoteName) {
    const tips = updates.filter((u) => !/^0+$/.test(u.localSha)).map((u) => u.localSha)
    if (tips.length === 0) return []
    const known = updates.map((u) => u.remoteSha).filter((sha) => !/^0+$/.test(sha) && gitOut(["cat-file", "-e", sha], cwd) !== null)
    const listed = gitOut(["rev-list", "--objects", ...tips, "--not", ...known, `--remotes=${remoteName}`], cwd) ?? ""
    const names = new Map()
    for (const line of listed.split("\n")) {
        const space = line.indexOf(" ")
        if (space > 0 && isUploadableAsset(line.slice(space + 1))) names.set(line.slice(0, space), line.slice(space + 1))
    }
    if (names.size === 0) return []
    const checked = spawnSync("git", ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
        cwd, input: [...names.keys()].join("\n") + "\n", encoding: "utf8",
    }).stdout
    const small = checked.split("\n").map((l) => l.split(" "))
        .filter(([, type, size]) => type === "blob" && Number(size) <= MAX_POINTER_BYTES).map(([oid]) => oid)
    if (small.length === 0) return []
    const out = spawnSync("git", ["cat-file", "--batch"], { cwd, input: small.join("\n") + "\n", maxBuffer: 64 * 1024 * 1024 }).stdout
    const found = new Map()
    let at = 0
    while (at < out.length) {
        const eol = out.indexOf(10, at)
        const [oid, , size] = out.subarray(at, eol).toString("utf8").split(" ")
        const body = out.subarray(eol + 1, eol + 1 + Number(size))
        at = eol + 1 + Number(size) + 1
        const pointer = parsePointer(body)
        const name = names.get(oid)
        if (pointer !== null && name !== undefined) found.set(`${pointer.sha256} ${storeKey(pointer.sha256, name)}`, { ...pointer, name })
    }
    return [...found.values()]
}

const megabytes = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`

/** Sends what the store lacks of `files` through the cart's LFS endpoint, a line each. Answers how many were sent. */
export async function sendStored(cwd, endpoint, files, { bearer, say }) {
    const answers = await lfsBatch(endpoint, "upload", files.map((f) => ({ oid: f.sha256, size: f.size, name: f.name })), bearer)
    const problems = []
    let sent = 0
    for (const answer of answers) {
        const file = files.find((f) => f.sha256 === answer.oid && f.size === answer.size)
        const name = file?.name ?? answer.oid
        if (answer.error) { problems.push(`${name}: ${answer.error.message}`); continue }
        if (!answer.actions?.upload) { say(`assets: ${name} ${megabytes(answer.size)}, already stored`); continue }
        const data = readCached(answer.oid, answer.size) ?? fromWorkingTree(cwd, file)
        if (data === null) {
            problems.push(`${name}: its bytes are not in ${storeDir()} or the working folder. Check out the commit that added it and run ${COMMAND} push again.`)
            continue
        }
        // Credentials go only to the site itself, as git-lfs sends them: a presigned URL carries its own.
        const sameSite = new URL(answer.actions.upload.href).origin === new URL(endpoint).origin
        const put = await fetch(answer.actions.upload.href, {
            method: "PUT",
            headers: { ...answer.actions.upload.header, ...(sameSite && bearer ? { authorization: `Bearer ${bearer}` } : {}) },
            body: data,
        })
        if (!put.ok && put.status !== 412) {
            problems.push(`${name}: the store answered ${put.status}: ${(await put.text()).slice(0, 200)}`)
            continue
        }
        if (answer.actions.verify) {
            const verified = await fetch(answer.actions.verify.href, {
                method: "POST",
                headers: { accept: LFS_TYPE, "content-type": LFS_TYPE, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
                body: JSON.stringify({ oid: answer.oid, size: answer.size }),
            })
            if (!verified.ok) { problems.push(`${name}: ${(await verified.json().catch(() => ({}))).message ?? `verify answered ${verified.status}`}`); continue }
        }
        sent++
        say(`assets: ${name} ${megabytes(answer.size)}, sent`)
    }
    if (problems.length > 0) throw new Error(problems.join("\n"))
    return sent
}

function fromWorkingTree(cwd, file) {
    if (file === undefined) return null
    try {
        const data = fs.readFileSync(path.join(cwd, file.name))
        return sha256Of(data) === file.sha256 ? data : null
    } catch {
        return null
    }
}

/** `ojplay pre-push <remote> <url>`, which git runs with the refs being pushed on stdin. */
export async function prePush(cwd, remoteName, url, stdin, { say = (line) => process.stderr.write(`[ojplay] ${line}\n`) } = {}) {
    const endpoint = lfsEndpoint(url)
    if (endpoint === null) return 0
    const updates = stdin.split("\n").filter((l) => l.trim() !== "").map((l) => {
        const [localRef, localSha, remoteRef, remoteSha] = l.split(" ")
        return { localRef, localSha, remoteRef, remoteSha }
    })
    const files = pointersToPush(cwd, updates, remoteName)
    if (files.length === 0) return 0
    const bearer = tokenOf(cwd)
    if (!bearer) {
        say(`this push carries ${files.length} stored file${files.length === 1 ? "" : "s"}, and sending them needs a login: ${COMMAND} login`)
        return 1
    }
    try {
        await sendStored(cwd, endpoint, files, { bearer, say })
        return 0
    } catch (error) {
        say(`nothing was pushed, because a stored file could not be sent:\n${error.message}`)
        return 1
    }
}

// ---------- setting a clone up ----------

/** How git runs this ojplay: this install's own file, or npx for a copy npx will clear away. */
export function ojCommand() {
    const own = path.join(import.meta.dirname, "oj.mjs")
    if (own.split(path.sep).includes("_npx")) {
        const version = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version
        return `npx --yes ${PACKAGE}@${version}`
    }
    return `node '${own.replace(/'/g, `'\\''`)}'`
}

/** The lines .git/info/attributes needs: every stored type through filter oj. */
export function attributeRules() {
    const exts = Object.keys(ASSET_TYPES).filter((ext) => isUploadableAsset(`x${ext}`))
    return exts.flatMap((ext) => [`*${ext} filter=oj -text`, `*${ext.toUpperCase()} filter=oj -text`]).join("\n") + "\n"
}

/**
 * Makes ojplay this clone's filter and pre-push hook, then puts the real
 * bytes behind any pointer the checkout left. Safe to run twice. Answers one
 * line per thing it did or left alone.
 */
export function setupStore(root) {
    const gitDir = gitOut(["rev-parse", "--absolute-git-dir"], root)?.trim()
    if (!gitDir) return ["stored files: not a git repository yet, so git was not set up for them"]
    const lines = []
    const run = ojCommand()
    spawnSync("git", ["config", "filter.oj.process", `${run} filter-process`], { cwd: root })
    spawnSync("git", ["config", "filter.oj.required", "true"], { cwd: root })

    const attributes = path.join(gitDir, "info", "attributes")
    const have = fs.existsSync(attributes) ? fs.readFileSync(attributes, "utf8") : ""
    const missing = attributeRules().split("\n").filter((rule) => rule !== "" && !have.split("\n").includes(rule))
    if (missing.length > 0) {
        fs.mkdirSync(path.dirname(attributes), { recursive: true })
        fs.writeFileSync(attributes, (have === "" || have.endsWith("\n") ? have : have + "\n") + missing.join("\n") + "\n")
    }

    const hook = path.resolve(root, gitOut(["rev-parse", "--git-path", "hooks/pre-push"], root).trim())
    const script = `#!/bin/sh\n${HOOK_MARK}\nexec ${run} pre-push "$@"\n`
    const existing = fs.existsSync(hook) ? fs.readFileSync(hook, "utf8") : null
    if (existing !== null && !existing.includes(HOOK_MARK)) {
        lines.push(`stored files: left your pre-push hook alone; add this line to it: ${run} pre-push "$@"`)
    } else {
        fs.mkdirSync(path.dirname(hook), { recursive: true })
        fs.writeFileSync(hook, script, { mode: 0o755 })
        fs.chmodSync(hook, 0o755)
    }
    lines.push(`stored files: files of ${megabytes(STORE_MIN_BYTES)} or more leave git; their bytes are kept in ${storeDir()}`)

    const pointers = pointerFiles(root)
    if (pointers.length > 0) {
        for (const name of pointers) fs.rmSync(path.join(root, name))
        spawnSync("git", ["checkout", "--", ...pointers], { cwd: root, stdio: ["ignore", "ignore", "inherit"] })
        const still = pointerFiles(root)
        lines.push(`stored files: ${pointers.length - still.length} of ${pointers.length} fetched${still.length > 0 ? `; still pointers: ${still.join(", ")}` : ""}`)
    }
    const raw = rawStoredFiles(root)
    if (raw.length > 0) {
        lines.push(`stored files: ${raw.join(", ")} ${raw.length === 1 ? "is" : "are"} still in git; the next commit of ${raw.length === 1 ? "it" : "them"} stores ${raw.length === 1 ? "it" : "them"} outside`)
    }
    return lines
}

/** Tracked files of a stored type whose working copy is a pointer. */
function pointerFiles(root) {
    const listed = gitOut(["ls-files", "-z"], root) ?? ""
    return listed.split("\0").filter((name) => {
        if (name === "" || !isUploadableAsset(name)) return false
        try {
            const file = path.join(root, name)
            if (fs.statSync(file).size > MAX_POINTER_BYTES) return false
            // A clone made before these attributes existed checks a pointer out
            // with CRLF under core.autocrlf, as Windows' git does by default.
            return parsePointer(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")) !== null
        } catch {
            return false
        }
    })
}

/** Tracked files committed whole that the rule would store: they leave git the next time they are committed. */
function rawStoredFiles(root) {
    const listed = gitOut(["ls-files", "-s", "-z"], root) ?? ""
    const big = []
    for (const entry of listed.split("\0")) {
        const m = /^\d+ ([0-9a-f]+) \d\t(.+)$/s.exec(entry)
        if (m === null || !isUploadableAsset(m[2])) continue
        const size = Number(gitOut(["cat-file", "-s", m[1]], root))
        if (size >= STORE_MIN_BYTES) big.push(m[2])
    }
    return big
}
