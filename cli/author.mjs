/**
 * Who a cart's commits say made them.
 *
 * Git signs a commit with whatever identity the machine has, which for most
 * people is their real name and personal email. A cart's history goes public
 * with the cart, and `git clone` hands every address in it to anyone. On
 * 26 Oct 2026 four of six agent commits in a measurement went out under the
 * machine's personal email, and two public carts on the site already carried
 * one (Specs/AGENT_GIT_VS_OJPLAY.md in the OneJS container).
 *
 * So a cart's repository gets its own author: the account's handle, at a
 * no-reply address on the site's domain. It is written to that repository's
 * config, never the global one, and only when the folder is the repository
 * itself: a cart folder inside a Unity project's repository would otherwise
 * change the author of the whole project.
 */
import { spawnSync } from "node:child_process"
import { mine, siteOrigin } from "./site.mjs"
import { COMMAND } from "../build/command.mjs"

const noreplyDomain = (origin) => `users.noreply.${new URL(origin).hostname}`

/** The no-reply author for `handle` on the site at `origin`: the handle as written, the address in lowercase. */
export function noreplyAuthor(handle, origin = siteOrigin()) {
    return { name: handle, email: `${handle.toLowerCase()}@${noreplyDomain(origin)}` }
}

const gitIn = (dir, ...args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" })

/** True when `dir` is the top of a git repository, not a repository's subfolder or no repository at all. */
export function ownsRepository(dir) {
    const prefix = gitIn(dir, "rev-parse", "--show-prefix")
    return prefix.status === 0 && prefix.stdout.trim() === ""
}

/**
 * Makes `author` the author and committer of the repository at `dir`. Answers
 * the line to say.
 *
 * An address the site's no-reply domain gave out before (a handle since
 * renamed) is replaced. Any other address in the repository's own config was
 * put there by a person, so it is left alone.
 */
export function setAuthor(dir, author, origin = siteOrigin()) {
    const current = gitIn(dir, "config", "--local", "--get", "user.email").stdout.trim()
    if (current !== "" && !current.endsWith(`@${noreplyDomain(origin)}`)) {
        return `git: this repository commits as ${current}, set in it by hand, so that was left alone`
    }
    gitIn(dir, "config", "--local", "user.name", author.name)
    gitIn(dir, "config", "--local", "user.email", author.email)
    return `git: commits here are by ${author.name} <${author.email}>, not this machine's git identity`
}

/**
 * Sets the author of the cart repository at `dir` from the account `bearer`
 * belongs to, and answers the lines to say. With no account to ask, or when
 * the site cannot answer, nothing is set and the line says how to set it
 * later. A folder that is not a repository of its own answers nothing.
 */
export async function authorLines(dir, bearer, { account = mine, origin = siteOrigin() } = {}) {
    if (!ownsRepository(dir)) return []
    const later = `${COMMAND} login, then ${COMMAND} init here, makes them your handle's no-reply address`
    if (!bearer) return [`git: commits here use this machine's git identity, which a public cart shows to anyone; ${later}`]
    let handle
    try {
        handle = (await account(bearer)).handle
    } catch (error) {
        return [`git: the site could not say who you are (${error.message}), so commits here use this machine's git identity; ${later}`]
    }
    return [setAuthor(dir, noreplyAuthor(handle, origin), origin)]
}
