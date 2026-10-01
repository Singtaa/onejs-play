#!/usr/bin/env node
/**
 * ojplay: an OJPlay cart from the terminal.
 *
 *   ojplay add <address>    use another cart in this one; in an empty folder, start a cart that uses it
 *   ojplay update           move the carts this one uses to their newest versions
 *   ojplay remove <address> stop using a cart
 *   ojplay init             the local tooling files a clone needs (package.json, tsconfig, types), gitignored
 *   ojplay build            bundle the cart the way the site does; errors as file:line:col
 *   ojplay typecheck        tsc --noEmit against the same oj the site builds with
 *   ojplay run              build, then run the cart in the real container in a local Chrome
 *   ojplay test <script>    run, then drive the cart from a script that reads, clicks and asserts
 *   ojplay status           what the site is running: head, live, and why they differ
 *   ojplay list             every cart on the account, private ones included
 *   ojplay push             git push origin main with OJ_TOKEN, then fail if the tip did not build
 *   ojplay new <name>       create a cart on the site and clone it here
 *   ojplay login            print a link; once the person presses Allow, this machine can push
 *   ojplay logout           forget that login, here and on the site
 *   ojplay runtime          fetch the container the site serves into the local cache
 *
 * Every command reads the cart in the current folder, or --root <dir>.
 */
import fs from "node:fs"
import path from "node:path"
import { build, typecheck } from "./game.mjs"
import { create, folderFor, git, mine, sidOf, siteOrigin, status, token, tokenOf, version } from "./site.mjs"
import { login, logout } from "./login.mjs"
import { ensureRuntime, runtimeDir } from "./local.mjs"
import { start, stop, watch, runScript } from "./run.mjs"
import { describeRowProblems } from "./rows.mjs"
import { init } from "./init.mjs"
import { initUnity, npm } from "./unity.mjs"
import { add, fetchUsed, placeOf, remove, syncTypes, update } from "./carts.mjs"
import { handOff, updateNotice } from "./global.mjs"
import { BIN, COMMAND, PACKAGE } from "../build/command.mjs"

const OWN_VERSION = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version

const HELP = `usage: ${COMMAND} <command> [options]

  add <@handle/name>    use another cart in this one: oj.json gets its newest version, and its
                          source and art are fetched into .oj/carts. In an empty folder, starts
                          a cart there that uses it. With no address, fetches what oj.json lists
  update [@handle/name] move the carts this one uses to their newest version in the same major
                          (--major: their newest of all)
  remove <@handle/name> stop using a cart, and say which files still import it

  init                  write package.json, tsconfig.json and env.d.ts and ignore them (.gitignore,
                          or .git/info/exclude in a clone); run npm install after
                          --unity         in a clone at Assets/<Name>/~ of a Unity project with OneJS:
                                          make it a JSRunner project, install and build it
  build                 bundle the cart as the site does, to .oj/bundle.js (--out <file>)
  typecheck             tsc --noEmit
  run                   run the cart in the site's container in a local Chrome; exits 1 on a
                          console error
                          --headed        a window you can watch, kept open until Ctrl-C
                          --watch         rebuild and swap the cart in on every change
                          --for <s>       headless: seconds to run before the screenshot (default 5)
                          --shot <file>   where the screenshot goes (default .oj/run.png)
                          --window <w,h>  browser size in CSS pixels (default 960,540)
  test [script.mjs]     run, then call the script's default export with the cart (with no
                          script, let it run --for seconds, default 2); fails on a console error,
                          an asset the site would not serve, or a row whose controls are out of
                          line or crowded
                          --headed, --window, --for as above
  status                head, live and buildError for this cart (--sid <id>)
  list                  every cart on the account, private ones included (--json)
  login                 print a ${siteOrigin()} link; once the person presses Allow there,
                          this machine can create, edit and push (--no-wait prints and exits,
                          then login --wait <code> collects; --name names the device)
  logout                forget the login, here and on the site
  push                  git push origin main; exits 1 if the tip failed to build
  new <name>            create a cart on the site and clone it into ./<name>
  runtime               fetch the container into ~/.onejs-play (--runtime <version>)

  --root <dir>          the cart folder (default: the current folder)
  --runtime <version>   run against a specific container version
  --site <origin>       the site (default ${siteOrigin()}; also OJ_SITE)

OJ_TOKEN  an access token from ${siteOrigin()}/manage/tokens, used instead of ${COMMAND} login's
OJ_CHROME the browser binary, when it is not in the usual place

Inside a cart with its own ${PACKAGE} in node_modules, ${BIN} runs that copy, so the version matches the cart.
${BIN} ${OWN_VERSION}
`

function parse(argv) {
    const flags = {}
    const positional = []
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a.startsWith("--")) {
            const key = a.slice(2)
            const next = argv[i + 1]
            if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++ } else flags[key] = true
        } else positional.push(a)
    }
    return { command: positional[0], args: positional.slice(1), flags }
}

const say = (line) => console.error(`[${BIN}] ${line}`)

async function main() {
    const { command, args, flags } = parse(process.argv.slice(2))
    if (flags.site) process.env.OJ_SITE = String(flags.site)
    const root = path.resolve(flags.root ? String(flags.root) : ".")
    const size = flags.window ? String(flags.window).split(",").map(Number) : undefined

    // What oj.json uses and .oj/carts lacks (a fresh clone, or an edit by
    // hand), fetched before anything builds it.
    if (["build", "typecheck", "run", "test"].includes(command) && placeOf(root) === "cart") {
        const fetched = await fetchUsed(root)
        if (fetched.length > 0) {
            say(`fetched ${fetched.join(", ")} into .oj/carts`)
            syncTypes(root)
        }
    }

    switch (command) {
        case "init": {
            if (flags.unity) {
                const made = initUnity(root)
                say(`OneJS templates from ${made.onejs}`)
                for (const line of made.lines) say(line)
                const code = npm(root, ["install", "--no-audit", "--no-fund"]) || npm(root, ["run", "build"])
                if (code !== 0) return code
                say(`now drag ${made.prefab} into a scene`)
                return 0
            }
            for (const line of init(root)) say(line)
            syncTypes(root)
            say(`now: npm install, then ${COMMAND} run`)
            return 0
        }
        case "add": {
            for (const line of await add(root, args[0], { say })) say(line)
            return 0
        }
        case "update": {
            const only = args[0] ?? (typeof flags.major === "string" ? flags.major : undefined)
            for (const line of await update(root, only, { major: flags.major !== undefined })) say(line)
            return 0
        }
        case "remove": {
            for (const line of await remove(root, args[0])) say(line)
            return 0
        }
        case "build": {
            const built = await build(root)
            const out = path.resolve(root, flags.out ? String(flags.out) : ".oj/bundle.js")
            fs.mkdirSync(path.dirname(out), { recursive: true })
            fs.writeFileSync(out, built.code)
            for (const w of built.warnings) say(`warning: ${w}`)
            const shown = out.startsWith(root + path.sep) ? path.relative(root, out) : out
            say(`${built.entry} -> ${shown} (${(built.code.length / 1024).toFixed(1)} KB, ${built.files.length} files)`)
            return 0
        }
        case "typecheck":
            return typecheck(root)
        case "run": {
            const headed = flags.headed === true
            const game = await start(root, { headless: !headed, window: size, runtime: flags.runtime && String(flags.runtime), say })
            // Each distinct line once: Unity repeats its AudioContext warning
            // on every frame until a gesture.
            const seen = new Set()
            const print = (line) => {
                if (seen.has(line.text)) return
                seen.add(line.text)
                console.log(`[browser:${line.level}] ${line.text}`)
            }
            for (const line of game.browser.console) print(line)
            game.browser.listeners.add(print)
            try {
                const ms = await game.ready()
                say(`cart started in ${ms} ms`)
                const unwatch = flags.watch ? watch(root, game, say) : () => {}
                if (headed || flags.watch) {
                    say("running; Ctrl-C to stop")
                    await new Promise((resolve) => { process.on("SIGINT", resolve); process.on("SIGTERM", resolve) })
                    unwatch()
                } else {
                    const seconds = Number(flags.for ?? 5)
                    await game.wait(seconds * 1000)
                    const shot = await game.shot(path.resolve(root, flags.shot ? String(flags.shot) : ".oj/run.png"))
                    say(`screenshot ${path.relative(root, shot)}`)
                    const text = await game.read()
                    if (text.length > 0) say(`on screen: ${JSON.stringify(text.slice(0, 12))}`)
                }
                if (game.errors.length > 0) {
                    say(`${game.errors.length} console error(s):`)
                    for (const e of game.errors.slice(0, 10)) console.error("  " + e)
                    return 1
                }
                return 0
            } finally {
                stop(game)
            }
        }
        case "test": {
            // No script is a smoke test: the cart starts, runs a moment, and
            // passes the same checks. It is what every example gets that has
            // no playtest of its own.
            const script = args[0]
            // A signal (Ctrl-C, or a harness giving up on a run) ends the run
            // through the same cleanup as a finish. The browser sits in its
            // own process group on Mac and Linux, so an oj that simply died
            // would leave it running.
            let signalled = null
            const interrupted = new Promise((resolve) => {
                const on = (signal) => { signalled = signal; resolve() }
                process.once("SIGINT", on)
                process.once("SIGTERM", on)
            })
            const game = await start(root, { headless: flags.headed !== true, window: size, runtime: flags.runtime && String(flags.runtime), say })
            try {
                const play = (async () => {
                    const ms = await game.ready()
                    say(`cart started in ${ms} ms`)
                    if (script) await runScript(script, game)
                    else await game.wait(Number(flags.for ?? 2) * 1000)
                })()
                // Once the browser is closed under it, the script fails; that
                // failure is not the news.
                play.catch(() => {})
                if (signalled === null) await Promise.race([play, interrupted])
                if (signalled !== null) {
                    say(`interrupted by ${signalled}`)
                    return 1
                }
                if (game.errors.length > 0) {
                    say(`${game.errors.length} console error(s):`)
                    for (const e of game.errors.slice(0, 10)) console.error("  " + e)
                    return 1
                }
                // Checked for every game, as console errors are: a control out
                // of line with its row, or a value pressed against a track,
                // reads as a bug, and no script of a game's own would think to
                // look.
                const rows = await game.rowProblems()
                if (rows.length > 0) {
                    say(`${rows.length} row problem(s):`)
                    for (const line of describeRowProblems(rows)) console.error("  " + line)
                    return 1
                }
                say("passed")
                return 0
            } catch (error) {
                say(`failed: ${error.message}`)
                try { say(`screenshot ${path.relative(root, await game.shot(path.resolve(root, ".oj/failed.png")))}`) } catch { /* the page may be gone */ }
                return 1
            } finally {
                stop(game)
            }
        }
        case "list": {
            const { handle, carts } = await mine(token(root))
            if (flags.json === true) {
                console.log(JSON.stringify({ handle, carts }, null, 2))
                return 0
            }
            const hidden = carts.filter((s) => !s.public).length
            say(`${handle} has ${carts.length} cart${carts.length === 1 ? "" : "s"}, ${hidden} private`)
            for (const g of carts) console.log(`${g.sid}  ${g.public ? "public " : "private"}  ${g.name}  ${g.url}`)
            return 0
        }
        case "status": {
            const sid = flags.sid ? String(flags.sid) : sidOf(root)
            const s = await status(sid, { bearer: tokenOf(root) })
            console.log(JSON.stringify(s, null, 2))
            return 0
        }
        case "push": {
            const sid = flags.sid ? String(flags.sid) : sidOf(root)
            const bearer = token(root)
            const code = git(["push", "origin", "main"], { cwd: root, bearer })
            if (code !== 0) return code
            const s = await status(sid, { bearer })
            if (s.buildError !== null && s.head !== s.live) {
                say(`the tip did not build; ${s.live ? "still running " + s.live.slice(0, 7) : "nothing is running"}`)
                console.error(s.buildError)
                return 1
            }
            say(`live: ${s.live?.slice(0, 7)} at ${s.url}`)
            return 0
        }
        case "new": {
            const name = args.join(" ").trim()
            if (!name) throw new Error(`${COMMAND} new <name>`)
            const bearer = token(root)
            const made = await create(name, bearer)
            const dir = folderFor(name)
            say(`created ${made.sid} at ${siteOrigin()}${made.url}`)
            const code = git(["clone", made.clone, dir], { bearer })
            if (code !== 0) return code
            say(`cloned into ${dir}`)
            return 0
        }
        case "login":
            return login(root, {
                name: typeof flags.name === "string" ? flags.name : undefined,
                wait: flags["no-wait"] !== true,
                resume: flags.wait !== undefined,
                code: typeof flags.wait === "string" ? flags.wait : undefined,
            })
        case "logout":
            return logout(root)
        case "runtime": {
            const v = flags.runtime ? String(flags.runtime) : (await version()).runtime
            await ensureRuntime(siteOrigin(), v, say)
            say(`runtime ${v} in ${runtimeDir(v)}`)
            return 0
        }
        case undefined:
        case "help":
        case "--help":
            process.stdout.write(HELP)
            return command === undefined && flags.help !== true && flags.h !== true ? 1 : 0
        default:
            throw new Error(`unknown command ${command}\n\n${HELP}`)
    }
}

const rootArg = process.argv.indexOf("--root")
const startRoot = path.resolve(rootArg === -1 ? "." : process.argv[rootArg + 1] ?? ".")
// The global copy, typed bare at a terminal: the daily update line, and the
// hand-off to the cart's own copy. Neither for npx or a package.json script,
// which already run the copy they mean, nor for an agent reading the output.
const global = process.env.npm_command === undefined && process.env.OJPLAY_HANDED_OFF !== "1"
if (global && process.stderr.isTTY && !process.env.CI && process.env.OJPLAY_NO_UPDATE_CHECK === undefined) {
    const notice = updateNotice(OWN_VERSION)
    process.on("exit", notice.tell)
}
if (!global || !await handOff(startRoot)) main().then((code) => process.exit(code), (error) => {
    console.error(error.lines ? error.lines.join("\n") : `[${BIN}] ${error.message}`)
    process.exit(1)
})
