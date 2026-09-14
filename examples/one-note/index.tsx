// One idea: load a sound once, play it on an event.
//
// audio.load resolves a file that ships with the sketch, and the Sound it
// hands back plays as often as you ask. There is one clip here, a single
// plucked A. The other four pads are that same clip played at a different
// pitch, which is why this sketch carries 24 KB of audio and not five times
// that.
import { useEffect, useRef, useState } from "react"
import { View, Text, mount, audio, type Sound } from "oj"
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
    const note = useRef<Sound | null>(null)
    const [played, setPlayed] = useState(-1)

    useEffect(() => {
        let live = true
        audio.load("note.wav").then((sound) => {
            if (live) note.current = sound
            else sound.unload()
        })
        // The sketch can be closed mid-ring, and a voice outlives the view.
        return () => { live = false; audio.stopAll() }
    }, [])

    const strike = (i: number) => {
        note.current?.play({ pitch: PADS[i]!.pitch })
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
