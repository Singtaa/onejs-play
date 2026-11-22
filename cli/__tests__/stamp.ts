/**
 * Puts the seconds since `began` in front of each line of a stream's text, as
 * `[12.3 s] `, so a run's output says where its time went: on 22 Nov a Windows
 * sweep printed occlusion's "[ojplay] passed" and then cut it off at 180 s,
 * and nothing in the log said whether it passed at 175 s or never exited.
 * Text arrives in chunks that can split a line, so one stamper per stream
 * stamps only where a line begins.
 */
export function stamper(began: number, now: () => number = Date.now): (text: string) => string {
    let atLineStart = true
    return (text) => {
        let out = ""
        for (const piece of text.split(/(?<=\n)/)) {
            if (piece === "") continue
            if (atLineStart) out += `[${((now() - began) / 1000).toFixed(1)} s] `
            out += piece
            atLineStart = piece.endsWith("\n")
        }
        return out
    }
}
