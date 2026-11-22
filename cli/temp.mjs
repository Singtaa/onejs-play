/**
 * Temp folders by their long, real names. Every temp path in this package comes
 * from here, and cli/temp.test.ts fails on any other os.tmpdir().
 *
 * Windows can hand out a temp folder by its 8.3 name (C:\Users\RUNNER~1\...),
 * and the ~ reaches a file URL as %7E, which vitest's loader cannot load: a
 * script written there and imported failed on windows-latest twice, in
 * bake.test.ts (3ef60bd) and run.test.ts (766dfe8). The long name loads
 * everywhere. On macOS the same call resolves /var to /private/var.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

/** `p`, an existing path, by its long real name. */
export function longPath(p) {
    return fs.realpathSync.native(p)
}

/** The system's temp folder by its long real name. */
export function tempRoot() {
    return longPath(os.tmpdir())
}

/** A new folder in the temp folder, named `prefix` and six random characters. */
export function makeTemp(prefix) {
    return fs.mkdtempSync(path.join(tempRoot(), prefix))
}
