// The used cart: art loaded every way a cart loads its own files, each
// reporting what arrived. Its glow.png is 8 wide and sheet.png 32; the using
// cart's glow.png is 16 wide and it has no sheet.png at all.
import { useEffect, useRef } from "react"
import { View, Image, assetUrl, loadTexture, useTexture, useFlipbook, audio } from "oj"

export function report(what: string, value: unknown) {
    const g = globalThis as any
    g.__scoped = { ...(g.__scoped ?? {}), [what]: value }
}

export function Art() {
    const glow = useTexture("glow.png")
    const flip = useRef<any>(null)
    const img = useRef<any>(null)
    useFlipbook(flip, "sheet.png")
    useEffect(() => { if (glow !== null) report("useTexture", glow.width) }, [glow])
    useEffect(() => {
        loadTexture("./glow.png").then((t: any) => report("loadTexture", t.width), () => report("loadTexture", "failed"))
        audio.load("assets/zap.wav").then(() => report("audio.load", "ok"), () => report("audio.load", "failed"))
        fetch(assetUrl("glow.png")).then((r) => r.arrayBuffer()).then((b) => report("fetch(assetUrl)", b.byteLength), () => report("fetch(assetUrl)", "failed"))
        const poll = setInterval(() => {
            const sheet = flip.current?.image
            const uv = flip.current?.uv
            if (sheet !== undefined && sheet !== null && uv !== undefined && uv !== null && uv.width < 1) {
                report("useFlipbook", `${sheet.width} wide, cells ${uv.width}`)
            }
            const shown = img.current?.image
            if (shown !== undefined && shown !== null) report("Image src={assetUrl}", shown.width)
        }, 100)
        return () => clearInterval(poll)
    }, [])
    return (
        <View className="flex-row">
            <Image ref={flip} style={{ width: 32, height: 32 }} />
            <Image ref={img} src={assetUrl("glow.png")} style={{ width: 32, height: 32 }} />
        </View>
    )
}
