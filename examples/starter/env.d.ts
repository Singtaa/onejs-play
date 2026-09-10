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
