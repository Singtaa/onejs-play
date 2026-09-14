// One idea: a uniform is the wire between JavaScript and every pixel.
//
// ripple.sl is parsed and encoded by the build, so this import is a small
// object of numbers rather than a compiler. The slider sets `spread`, the one
// uniform the file declares, and the GPU reads it on every pixel of the next
// frame. Misspell it and the .sl.d.ts beside the file makes that a type error
// here rather than a console warning nobody is watching.
import { useState } from "react"
import { View, Text, Slider, ShaderProgram, mount } from "oj"
import ripple from "./ripple.sl"
import "onejs:tailwind"

function FirstShader() {
    const [spread, setSpread] = useState(0.4)

    return (
        <View className="w-full h-full p-8 items-center bg-neutral-900">
            <ShaderProgram program={ripple} uniforms={{ spread }}
                style={{ width: 420, height: 420, borderRadius: 16 }} />

            <View className="flex-row items-center w-96 mt-6">
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
