// One idea: load a sound once, play it on an event.
//
// useSound loads a file that ships with the cart, and the Sound it hands
// back plays as often as you ask. It is null for the frame or two the file
// takes, and it unloads with the component, which also stops anything still
// ringing. There is one clip here, a single
// plucked A. The other four pads are that same clip played at a different
// pitch, which is why this cart carries 24 KB of audio and not five times
// that.
import { useState } from "react"
import { View, Text, mount, useSound } from "oj"
import "onejs:tailwind"

// Ratios against the note in the file, which is what pitch means here.
const PADS = [
    { name: "A", pitch: 1 },
    { name: "B", pitch: 9 / 8 },
    { name: "D", pitch: 4 / 3 },
    { name: "E", pitch: 3 / 2 },
    { name: "A'", pitch: 2 },
]

function OneNote() {
    const note = useSound("note.wav")
    const [played, setPlayed] = useState(-1)

    const strike = (i: number) => {
        note?.play({ pitch: PADS[i]!.pitch })
        setPlayed(i)
    }

    return (
        <View className="w-full h-full p-8 bg-neutral-900">
            <Text className="text-2xl text-white">One note</Text>
            <Text className="mt-1 mb-6 text-sm text-neutral-400">One clip, five pitches. Tap a pad.</Text>
            <View className="flex-row grow">
                {PADS.map((pad, i) => (
                    <View key={pad.name + String(i)} onPointerDown={() => strike(i)}
                        className={`grow mr-3 rounded-lg items-center justify-end pb-4 ${played === i ? "bg-amber-300" : "bg-neutral-700"}`}>
                        <Text className={played === i ? "text-2xl text-neutral-900" : "text-2xl text-neutral-300"}>{pad.name}</Text>
                    </View>
                ))}
            </View>
        </View>
    )
}
mount(<OneNote />)
