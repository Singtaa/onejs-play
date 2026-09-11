// What the site's build resolves that TypeScript alone cannot. The site never
// reads this file; it is here so `npm run typecheck` passes in a clone.

// Tailwind classes, generated at build time from the class names in the tree.
declare module "onejs:tailwind"

// A .module.uss import is an object of scoped class names; a plain .uss import
// is the stylesheet's text, for compileStyleSheet().
declare module "*.module.uss" {
    const classes: Record<string, string>
    export default classes
}
declare module "*.uss" {
    const text: string
    export default text
}

// A .sl shader program, parsed and encoded by the build. The default export is
// the program; `source` is the file's own text, dropped from the bundle unless
// something imports it. The Play editor supplies a tighter declaration per file,
// carrying the uniform names the file declares, so a misspelled one is an error
// where it is written.
declare module "*.sl" {
    const program: import("oj").EncodedProgram
    export default program
    export const source: string
}
