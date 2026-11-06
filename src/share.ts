/**
 * Sharing a link and copying text, from the press that asked for it.
 *
 *     <Button text="Invite" onClick={async () => {
 *         const said = await share({ url: room.inviteUrl, title: "Join me" }, { fallback: "copy" })
 *         setNote(said === "copied" ? "Link copied" : "")
 *     }} />
 *
 * A browser opens its share sheet and writes the clipboard only for a page the
 * player has just pressed: it grants the press a short window (user
 * activation) and refuses outside it. A cart sees a press in the frame after
 * the browser delivered it, never inside the browser's own event, so the call
 * has to go to the browser in that frame with nothing awaited first. That is
 * enough: measured on 6 Nov (PlaySite/docs/engine-findings.md, "A cart cannot
 * share or copy"), Safari 26.5 on macOS let a frame write the clipboard 16,
 * 100 and 500 ms after a click and refused it at 1.1 s and 3 s, though
 * `navigator.userActivation.isActive` still read true; Chrome keeps the
 * window open 5 s. So a copy in the press's frame works at any playable frame
 * rate, and fails after a stall of about a second.
 *
 * A call with no press in its frame answers "refused" without asking the
 * browser, said once on the console. Chrome would have allowed it for five
 * seconds and a phone's Safari would not, so the rule a cart learns on a
 * desktop is the one that holds on a phone.
 *
 * Where the press counts: the container's input (input.ts `activated`) and
 * the DOM events that grant activation (adapter.ts). Outside a browser there
 * is no such rule and no share sheet: an ejected cart copies through Unity's
 * clipboard (standalone.ts) and its share answers "refused", or "copied" with
 * the fallback.
 */

export interface ShareData {
    url?: string
    title?: string
    text?: string
}

export interface ShareOptions {
    /** Copy the link (or the text, with no link) where there is no share sheet, or the browser refused it. */
    fallback?: "copy"
}

export type ShareResult = "shared" | "cancelled" | "refused" | "copied"
export type CopyResult = "copied" | "refused"

/** What the place a cart runs in can do. Installed by the host: the DOM adapter, or standalone.ts. */
export interface ShareBrowser {
    /** The share sheet, or null where there is none. */
    share: ((data: ShareData) => Promise<unknown>) | null
    /** Whether the sheet takes this data, where the browser can say. */
    canShare?: ((data: ShareData) => boolean) | null
    /** Writing text to the clipboard, or null where it cannot. */
    copy: ((text: string) => Promise<unknown>) | null
}

let browser: ShareBrowser | null = null
let pressed: (() => boolean) | null = null
let warned = false

/** Called by the host. Carts have no reason to touch this. */
export function setShareBrowser(next: ShareBrowser | null): void {
    browser = next
}

/** Called by the runtime: whether the frame running now saw a press. Null where no rule applies. */
export function setPressCheck(next: (() => boolean) | null): void {
    pressed = next
}

function hadPress(): boolean {
    if (pressed === null || pressed()) return true
    if (!warned) {
        warned = true
        console.warn("[oj] share() and copy() answer only in the frame of a press (a click, a tap, a key) or its onClick; this call had none, so it was refused without asking the browser.")
    }
    return false
}

/** The browser's call, made now, with its rejection read as a result rather than thrown. */
function attempt(run: () => Promise<unknown>): Promise<{ ok: true } | { ok: false, name: string }> {
    try {
        return run().then(() => ({ ok: true as const }), (error: any) => ({ ok: false as const, name: String(error?.name ?? "Error") }))
    } catch (error: any) {
        return Promise.resolve({ ok: false as const, name: String(error?.name ?? "Error") })
    }
}

/** Writes `text` to the clipboard. Call it in the frame of a press. */
export function copy(text: string): Promise<CopyResult> {
    if (!hadPress()) return Promise.resolve("refused")
    return copyNow(String(text))
}

function copyNow(text: string): Promise<CopyResult> {
    const write = browser?.copy
    if (!write) return Promise.resolve("refused")
    return attempt(() => write(text)).then((r) => (r.ok ? "copied" : "refused"))
}

/**
 * Opens the share sheet with `data`. "shared" once the player picked where,
 * "cancelled" when they closed it, "refused" where there is no sheet or the
 * browser said no. With `{ fallback: "copy" }`, no sheet or a refusal copies
 * the link instead (the text, with no link) and can answer "copied".
 */
export function share(data: ShareData, options: ShareOptions = {}): Promise<ShareResult> {
    if (!hadPress()) return Promise.resolve("refused")
    const clean: ShareData = {}
    for (const key of ["url", "title", "text"] as const) if (typeof data?.[key] === "string" && data[key] !== "") clean[key] = data[key]
    const orCopy = (): Promise<ShareResult> => {
        const fallbackText = clean.url ?? clean.text
        return options.fallback === "copy" && fallbackText !== undefined ? copyNow(fallbackText) : Promise.resolve("refused")
    }
    const open = browser?.share
    if (!open || (browser?.canShare && !browser.canShare(clean))) return orCopy()
    return attempt(() => open(clean)).then((r) => {
        if (r.ok) return "shared"
        // The player closed the sheet: an answer, not a reason to copy behind their back.
        if (r.name === "AbortError") return "cancelled"
        return orCopy()
    })
}
