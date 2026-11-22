/** `p`, an existing path, by its long real name (never Windows' 8.3 form). */
export function longPath(p: string): string
/** The system's temp folder by its long real name. */
export function tempRoot(): string
/** A new folder in the temp folder, named `prefix` and six random characters. */
export function makeTemp(prefix: string): string
