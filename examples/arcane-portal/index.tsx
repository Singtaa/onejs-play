// A shader written in Magerie, running in a game unchanged.
//
// arcane-portal.sl came out of Magerie's editor as it is: this folder adds no
// line to it. It declares two uniforms, and the game drives both. `glow` has a
// hex default, which makes it a colour: the game hands it the swatch as
// written, in sRGB like CSS, and the shader converts it where it reads it.
// `speed` is a plain float that scales how fast the portal turns.
import { useState } from "react"
import { View, Text, Slider, ShaderProgram, Color, mount, useStage } from "oj"
import portal from "./arcane-portal.sl"
import "onejs:tailwind"

// The first is the .sl file's own default, so the game opens on the picture
// Magerie rendered.
const SWATCHES = ["#36c8ff", "#b46bff", "#ff4fa3", "#ff9a2e", "#6bff8a"]

function ArcanePortal() {
    const stage = useStage()
    const [hex, setHex] = useState(SWATCHES[0])
    const [speed, setSpeed] = useState(1)
    const glow = Color.FromHex(hex)

    // Square, and as large as the controls leave room for.
    const side = Math.max(160, Math.min(stage.width - 64, stage.height - 220))

    return (
        <View className="w-full h-full py-8 px-4 items-center justify-center bg-neutral-950">
            <ShaderProgram program={portal}
                uniforms={{ glow: [glow.r, glow.g, glow.b, glow.a], speed }}
                style={{ width: side, height: side }} />

            <View className="flex-row items-center mt-6" style={{ width: "100%", maxWidth: 420 }}>
                <Text className="w-20 text-sm text-neutral-400">glow</Text>
                {SWATCHES.map((s) => (
                    <View key={s} onClick={() => setHex(s)}
                        className="w-8 h-8 mr-3 rounded-full"
                        style={{ backgroundColor: s, borderWidth: 2, borderColor: s === hex ? "#ffffff" : "#00000000" }} />
                ))}
            </View>

            <View className="flex-row items-center mt-4" style={{ width: "100%", maxWidth: 420 }}>
                <Text className="w-20 text-sm text-neutral-400">speed</Text>
                <Slider value={speed} lowValue={0} highValue={3}
                    onChange={(e: { value: number }) => setSpeed(e.value)}
                    style={{ flexGrow: 1 }} />
                {/* The readout is as wide as its widest value and right-aligned,
                    so its right edge never moves as the digits change, and
                    ml-3 keeps it the swatches' 12px from the track. */}
                <Text className="w-7 ml-3 text-sm text-right text-neutral-300">{speed.toFixed(2)}</Text>
            </View>
        </View>
    )
}
mount(<ArcanePortal />)
