/** The GPU process's cores over a run, from the cost line oj test says at its close (cpuCost in chrome.mjs), or null without one. */
export function gpuCores(output: string): number | null {
    const m = /\[ojplay\] chrome's CPU over its [\d.]+ s[^:\n]*: .*?\bGPU [\d.]+ s \(([\d.]+) cores\)/.exec(output)
    return m ? Number(m[1]) : null
}

/** How late the sweep's own timers may fire during a run before the run counts as starved. */
export const STARVED_S = 2

/**
 * Why a run drawing in software counts as starved, or null. A run whose
 * machine fired the sweep's timers more than STARVED_S late fails by that
 * name: before oj test put the GPU process below normal priority, windows-latest's
 * timers fired up to 12.4 s late, and runs failed as "did not answer in 30s"
 * or as a close that hung, which named the symptom (CI 45008885747, 22 Nov).
 */
export function starved(lateS: number, output: string): string | null {
    if (lateS <= STARVED_S) return null
    const drawing = /\[ojplay\] (drawing (?:below normal|at its own) priority[^\n]*)/.exec(output)?.[1]?.trim() ?? "it never said what its drawing was given"
    const cores = gpuCores(output)
    return `starved: the sweep's timers fired ${lateS.toFixed(1)} s late while it drew in software (${drawing}; ${cores === null ? "GPU cores not said" : `GPU ${cores.toFixed(2)} cores`})`
}
