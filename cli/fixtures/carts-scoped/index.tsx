// A cart using a cart (PlaySite docs/carts.md §3, step 4): the used cart's
// art loads from its own files, every way the docs show, while this cart's
// glow.png (16 wide, the used cart's is 8) stays this cart's. What each
// loader got lands in globalThis.__scoped for carts-scoped.playtest.mjs.
import { useEffect } from "react"
import { View, mount, useTexture, loadTexture } from "oj"
import { Art, report } from "@test/art"

function Own() {
    const glow = useTexture("glow.png")
    useEffect(() => { if (glow !== null) report("own useTexture", glow.width) }, [glow])
    useEffect(() => { loadTexture("glow.png").then((t: any) => report("own loadTexture", t.width)) }, [])
    return null
}

mount(
    <View className="w-full h-full bg-neutral-900 p-4">
        <Own />
        <Art />
    </View>,
)
