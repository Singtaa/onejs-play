export interface ShowTable { columns: string[], rows: string[][], moreRows: number, moreColumns: number }
export interface ShowNode { label: string, op: string, fields: Array<[string, string]>, inputs: number[] }
export interface ShowGraph { nodes: ShowNode[], more: number }
export interface Shown { text: string, table?: ShowTable, graph?: ShowGraph }
export type ShowBatch = Array<[site: string, shown: Shown]>

export interface ShowHost {
    sink(): ((batch: ShowBatch) => void) | null
    schedule(flush: () => void): void
    log(line: string): void
}

export function snapshot(_values: readonly unknown[]): Shown {
    return { text: "" }
}

export function createShow(_host: ShowHost) {
    return { record(_site: string | undefined, _values: readonly unknown[]) {} }
}

export function show(..._values: unknown[]): void {}
