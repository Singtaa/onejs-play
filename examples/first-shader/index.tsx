// One idea: a uniform is the wire between JavaScript and every pixel.
//
// ripple.sl is parsed and encoded by the build, so this import is a small
// object of numbers rather than a compiler. The slider sets `spread`, the one
// uniform the file declares, and the GPU reads it on every pixel of the next
// frame. Misspell it and the .sl.d.ts beside the file makes that a type error
// here rather than a console warning nobody is watching.
import { useState } from "react"
import { View, Text, Slider, ShaderProgram, mount, useStage } from "oj"
import ripple from "./ripple.sl"
import "onejs:tailwind"

function FirstShader() {
    const stage = useStage()
    const [spread, setSpread] = useState(0.4)

    // The shader is square, so it takes whichever side leaves room for the
    // controls: the full width on a phone, the height on a wide monitor. No
    // stage in oj.json means these two numbers are the window.
    const side = Math.max(160, Math.min(stage.width - 64, stage.height - 220))

    return (
        <View className="w-full h-full py-8 px-4 items-center justify-center bg-neutral-900">
            <ShaderProgram program={ripple} uniforms={{ spread }}
                style={{ width: side, height: side, borderRadius: 16 }} />

            {/* maxWidth as a style, not max-w-md: OneJS's Tailwind generates
                max-w-{spacing} and max-w-{percentage} and not the named size
                scale, so max-w-md compiles to nothing and the row spans the
                whole window on a monitor. */}
            <View className="flex-row items-center mt-6" style={{ width: "100%", maxWidth: 420 }}>
                <Text className="w-20 text-sm text-neutral-400">spread</Text>
                <Slider value={spread} lowValue={0} highValue={1}
                    onChange={(e: { value: number }) => setSpread(e.value)}
                    style={{ flexGrow: 1 }} />
                <Text className="w-12 text-sm text-neutral-300">{spread.toFixed(2)}</Text>
            </View>

            <Text className="mt-5 text-sm text-neutral-500">
                ripple.sl is twelve lines. The slider writes one of them.
            </Text>
        </View>
    )
}
mount(<FirstShader />)
