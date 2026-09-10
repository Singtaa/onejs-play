export interface ContainerBootOptions {
    /** URL prefix of the container's files, no trailing slash. */
    runtime: string
    /** What `__ojPlay.load` is handed beside the source. */
    manifest: object
    /** JS declaring `function bundle()`, resolving to the game's source text. */
    bundle: string
    /** JS declaring `function report(type, payload)`: "ready" with `ms`, or "error" with `message`. */
    report: string
}

/** The boot script both the sandbox document and `oj run` inline. */
export function containerBoot(options: ContainerBootOptions): string
