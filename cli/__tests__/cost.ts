/** The GPU process's cores over a run, from the cost line oj test says at its close (cpuCost in chrome.mjs), or null without one. */
export function gpuCores(output: string): number | null {
    const m = /\[ojplay\] chrome's CPU over its [\d.]+ s[^:\n]*: .*?\bGPU [\d.]+ s \(([\d.]+) cores\)/.exec(output)
    return m ? Number(m[1]) : null
}
