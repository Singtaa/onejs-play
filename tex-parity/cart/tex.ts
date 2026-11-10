/**
 * The tex the cart draws with: the container's, or, under `run.mjs
 * --tex-src`, this checkout's src/tex, bundled by run.mjs and evaluated here
 * before any case is made, so an edit is tried without a container build.
 *
 * A dev bundle that fails to evaluate throws here and stops the cart, never
 * falling back to the container's tex: a run that asked for the checkout's
 * tex and quietly drew the container's would compare the wrong library.
 * `TEX_SOURCE` is printed first, and run.mjs fails a --tex-src run whose
 * cart does not name the bundle it built.
 */
import * as oj from "oj"
import { DEV_TEX } from "./devtex.gen"

interface DevTex { tex: typeof oj.tex, TexImage: typeof oj.TexImage, DEV_ID: string }

function load(): DevTex | null {
    if (DEV_TEX === null) return null
    // The bundle is an IIFE assigning `var __devTex`; a Function body keeps
    // that var its own and hands it back, whatever a cart's globalThis is.
    const dev = new Function(`${DEV_TEX}\nreturn __devTex`)() as DevTex | undefined
    if (dev === undefined || typeof dev.tex?.canvas !== "function") throw new Error("[tex-parity] the dev tex bundle evaluated but left no __devTex.tex")
    return dev
}

const dev = load()

export const tex: typeof oj.tex = dev?.tex ?? oj.tex
export const TexImage: typeof oj.TexImage = dev?.TexImage ?? oj.TexImage
export type TexImage = oj.TexImage
/** "container", or "dev <id>" naming the bundle run.mjs built. */
export const TEX_SOURCE = dev === null ? "container" : `dev ${dev.DEV_ID}`
