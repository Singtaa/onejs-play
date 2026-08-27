import { useRef } from "react"
import { View, Text, mount, useFrame, useStage, batchedVisualContent } from "oj"

/**
 * This file is the game's card: the short clip that stands in for it wherever
 * it is shown. Name a file cover.tsx, put it beside your game, and this is
 * what gets recorded when you publish.
 *
 * Delete it and nothing breaks. Your index.tsx gets filmed instead, exactly as
 * a player sees it in a card-shaped window.
 */

/** Six seconds is the default take. Change it with cover.seconds in oj.json. */
const PERIOD = 6
const DOTS = 5

function Cover() {
    // You are handed the card as your stage, the same way a game is handed a
    // window. There is no aspect ratio to think about and no size to declare:
    // read the stage and draw in fractions of it.
    const stage = useStage()
    const view = useRef<any>(null)
    const clock = useRef(0)

    useFrame((dt) => {
        clock.current += dt
        view.current?.MarkDirtyRepaint()
    }, [])

    // Show something your game does not. A card is closer to a poster than to a
    // screenshot: one idea, read at a glance, at the size of a thumbnail.
    const size = Math.min(stage.width, stage.height)
    return (
        <View ref={view}
            style={{ width: "100%", height: "100%", backgroundColor: "#0b0b12",
                     alignItems: "center", justifyContent: "center" }}
            onGenerateVisualContent={batchedVisualContent((p) => {
                // Build everything out of t % PERIOD and the clip joins up: the
                // last frame lands where the first one started. A card repeats
                // forever, so a loop that does not close is the thing viewers
                // notice first.
                const turn = (clock.current % PERIOD) / PERIOD * Math.PI * 2
                const cx = stage.width / 2
                const cy = stage.height / 2
                for (let i = 0; i < DOTS; i++) {
                    const a = turn + i * Math.PI * 2 / DOTS
                    p.fillColor(1, 0.72, 0.28, 1 - i * 0.14)
                    p.beginPath()
                    p.arc(cx + Math.cos(a) * size * 0.26,
                          cy + Math.sin(a) * size * 0.26,
                          size * 0.045, 0, Math.PI * 2)
                    p.fill()
                }
            })}>
            <Text style={{ color: "#e8e8ef", fontSize: Math.round(size * 0.075) }}>Cover Story</Text>
        </View>
    )
}

mount(<Cover />)

/*
 * Keep something moving the whole way through, and do not fade out at the end.
 * A clip that finishes dark shows the join on every repeat, and the recorder
 * refuses one that ends on black rather than publishing a card that blinks.
 *
 * If you would rather hand over a finished file than have one recorded, drop it
 * beside your game and it wins:
 *
 *     cover.mp4 or cover.webm   a video you made yourself, used as is
 *     cover.gif                 same, animated
 *     cover.tsx                 this file, recorded when you publish
 *     cover.png or cover.jpg    a still, used as is
 *     index.tsx                 your game itself, filmed, if you provide none
 *
 * That is the whole of it. Publish, and the card looks after itself.
 */
