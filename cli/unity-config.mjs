/**
 * What `ojplay init --unity` and `ojplay add` write into OneJS's
 * esbuild.config.mjs: text in, text out.
 *
 * Its own module because the container's scaffold gate runs it against every
 * OneJS template in CI, where nothing is installed. onejs-unity is only a peer
 * of this package, and the plugins themselves (unity-assets.mjs,
 * unity-carts.mjs) reach the build pipeline, which imports onejs-unity's
 * esbuild plugins; a module that imports them cannot be loaded there. So this
 * one imports nothing but the package's own names. unity-config.test.ts pins
 * that, and unity-assets.mjs hands both functions out as `ojplay/unity` did.
 */
import { PACKAGE } from "../build/command.mjs"

/**
 * An app's esbuild.config.mjs with `cartsPlugin()` in it: the import beside
 * assetsPlugin's (or on its own), and the call first in the plugins list.
 * Unchanged when it is there already.
 */
export function withCartsPlugin(text) {
    if (/\bcartsPlugin\(\)/.test(text)) return text
    const plugins = /^([ \t]*)plugins:\s*\[[ \t]*\r?\n/m.exec(text)
    if (plugins === null) throw new Error(`This app's esbuild.config.mjs has no plugins list to add the carts step to. Add cartsPlugin() from "${PACKAGE}/unity" to it by hand.`)
    const indent = plugins[1] + "    "
    const at = plugins.index + plugins[0].length
    text = text.slice(0, at) + `${indent}// The carts oj.json uses, resolved and scoped as on the site\n${indent}cartsPlugin(),\n` + text.slice(at)
    const assets = new RegExp(`^import \\{ assetsPlugin \\} from "${PACKAGE.replace("/", "\\/")}\\/unity"`, "m")
    return assets.test(text)
        ? text.replace(assets, `import { assetsPlugin, cartsPlugin } from "${PACKAGE}/unity"`)
        : `import { cartsPlugin } from "${PACKAGE}/unity"\n${text}`
}

/**
 * The template's build, pointed at the cart's entry, with the plugin that
 * copies the cart's files into assets/ (assetsPlugin, above).
 *
 * The template names index.tsx, which is every cart's entry unless its
 * oj.json says otherwise: as `entry: "index.tsx"` in OneJS's oneJSConfig
 * preset, or `entryPoints: ["index.tsx"]` in the older full config. A template
 * whose entry matches neither is left naming index.tsx, which is right for
 * nearly every cart.
 * One with no plugins list is refused instead: the cart would build and run
 * without its files, and nothing would say why. The container's scaffold gate
 * runs this against OneJS's real template, so a reshaped one fails there first.
 */
export function buildConfig(template, entry) {
    let text = entry === "index.tsx" ? template
        : template
            .replace(/\bentry:\s*"index\.tsx"/, `entry: "${entry}"`)
            .replace(/entryPoints:\s*\[\s*"index\.tsx"\s*\]/, `entryPoints: ["${entry}"]`)
    const plugins = /^([ \t]*)plugins:\s*\[[ \t]*\r?\n/m.exec(text)
    if (plugins === null) {
        throw new Error("OneJS's esbuild.config.mjs template has no plugins list for the step that copies the cart's files into assets/. "
            + `Update ${PACKAGE} (npx ${PACKAGE}@latest init --unity), or report it if this is the latest.`)
    }
    const indent = plugins[1] + "    "
    const at = plugins.index + plugins[0].length
    text = text.slice(0, at)
        + `${indent}// The cart's files, copied into assets/ where OneJS looks for them\n${indent}assetsPlugin(),\n`
        + text.slice(at)
    // The carts oj.json uses, resolved and scoped the way the site does it.
    return withCartsPlugin(`import { assetsPlugin } from "${PACKAGE}/unity"\n${text}`)
}
