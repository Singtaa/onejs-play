#!/usr/bin/env node
/**
 * oj: a OneJS Play game from the terminal.
 *
 *   oj build            bundle the game the way the site does; errors as file:line:col
 *   oj typecheck        tsc --noEmit against the same oj the site builds with
 *   oj run              build, then run the game in the real container in a local Chrome
 *   oj test <script>    run, then drive the game from a script that reads, clicks and asserts
 *   oj status           what the site is running: head, live, and why they differ
 *   oj push             git push origin main with OJ_TOKEN, then fail if the tip did not build
 *   oj new <name>       create a game on the site and clone it here
 *   oj runtime          fetch the container the site serves into the local cache
 *
 * Every command reads the game in the current folder, or --root <dir>.
 */
import fs from "node:fs"
import path from "node:path"
import { build, typecheck } from "./game.mjs"
import { create, folderFor, git, sidOf, siteOrigin, status, token, version } from "./site.mjs"
import { ensureRuntime, runtimeDir } from "./local.mjs"
import { start, stop, watch, runScript } from "./run.mjs"

const HELP = `usage: oj <command> [options]

  build                 bundle the game as the site does, to .oj/bundle.js (--out <file>)
  typecheck             tsc --noEmit
  run                   run the game in the site's container in a local Chrome
                          --headed        a window you can watch, kept open until Ctrl-C
                          --watch         rebuild and swap the game in on every change
                          --for <s>       headless: seconds to run before the screenshot (default 5)
                          --shot <file>   where the screenshot goes (default .oj/run.png)
                          --window <w,h>  browser size in CSS pixels (default: the stage)
  test <script.mjs>     run, then call the script's default export with the game
                          --headed, --window as above
  status                head, live and buildError for this game (--sid <id>)
  push                  git push origin main with OJ_TOKEN; exits 1 if the tip failed to build
  new <name>            create a game on the site with OJ_TOKEN and clone it into ./<name>
  runtime               fetch the container into ~/.onejs-play (--runtime <version>)

  --root <dir>          the game folder (default: the current folder)
  --runtime <version>   run against a specific container version
  --site <origin>       the site (default ${siteOrigin()}; also OJ_SITE)

OJ_TOKEN  a personal access token from ${siteOrigin()}/manage, for push, new and private games
OJ_CHROME the browser binary, when it is not in the usual place
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

const say = (line) => console.error(`[oj] ${line}`)

async function main() {
    const { command, args, flags } = parse(process.argv.slice(2))
    if (flags.site) process.env.OJ_SITE = String(flags.site)
    const root = path.resolve(flags.root ? String(flags.root) : ".")
    const size = flags.window ? String(flags.window).split(",").map(Number) : undefined

    switch (command) {
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
            // on every frame until a gesture, and the proxy's probing is noise.
            const seen = new Set()
            const print = (line) => {
                if (seen.has(line.text) || /Property not found/.test(line.text)) return
                seen.add(line.text)
                console.log(`[browser:${line.level}] ${line.text}`)
            }
            for (const line of game.browser.console) print(line)
            game.browser.listeners.add(print)
            try {
                const ms = await game.ready()
                say(`game started in ${ms} ms`)
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
            const script = args[0]
            if (!script) throw new Error("oj test <script.mjs>")
            const game = await start(root, { headless: flags.headed !== true, window: size, runtime: flags.runtime && String(flags.runtime), say })
            try {
                const ms = await game.ready()
                say(`game started in ${ms} ms`)
                await runScript(script, game)
                if (game.errors.length > 0) {
                    say(`${game.errors.length} console error(s):`)
                    for (const e of game.errors.slice(0, 10)) console.error("  " + e)
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
        case "status": {
            const sid = flags.sid ? String(flags.sid) : sidOf(root)
            const s = await status(sid, { bearer: process.env.OJ_TOKEN })
            console.log(JSON.stringify(s, null, 2))
            return 0
        }
        case "push": {
            const sid = flags.sid ? String(flags.sid) : sidOf(root)
            const bearer = token()
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
            if (!name) throw new Error("oj new <name>")
            const bearer = token()
            const made = await create(name, bearer)
            const dir = folderFor(name)
            say(`created ${made.sid} at ${siteOrigin()}${made.url}`)
            const code = git(["clone", made.clone, dir], { bearer })
            if (code !== 0) return code
            say(`cloned into ${dir}`)
            return 0
        }
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
            return command === undefined ? 1 : 0
        default:
            throw new Error(`unknown command ${command}\n\n${HELP}`)
    }
}

main().then((code) => process.exit(code), (error) => {
    console.error(error.lines ? error.lines.join("\n") : `[oj] ${error.message}`)
    process.exit(1)
})
