// A flipbook from a sheet and its sidecar, the way files.md shows it. The
// sidecar says four cells at 8 fps, so the cell on show changes every eighth
// of a second; flipbook.playtest.mjs watches it change.
import { useRef } from "react"
import { View, Image, mount, useFlipbook } from "oj"

function Sheet() {
    const ref = useRef<any>(null)
    useFlipbook(ref, "sheet.png")
    ;(globalThis as any).__flip = ref
    return <Image ref={ref} style={{ width: 64, height: 64 }} />
}

mount(<View className="w-full h-full bg-neutral-900 p-4"><Sheet /></View>)
