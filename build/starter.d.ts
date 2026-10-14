/** Whether a file in the starter's folder belongs to a new cart. */
export declare function isStarterFile(name: string): boolean
/** A starter file's text with LF line endings. */
export declare function starterText(text: string): string
/** The starter's files with `name` as oj.json's name. */
export declare function starterWithName<T extends { name: string, text: string }>(files: T[], name: string): T[]
