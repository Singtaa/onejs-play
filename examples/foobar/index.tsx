import { useState } from "react"
import { View, Text, mount, useStage, useFrame } from "oj"
import "onejs:tailwind"

const W = 600, H = 600   // the board, in board units

// A fixed W x H board, scaled to fit the window and centred.
function useBoard() {
    const { width, height } = useStage()
    const scale = Math.min(width / W, height / H)
    const left = (width - W * scale) / 2, top = (height - H * scale) / 2
    return {
        scale,
        style: { position: "absolute", left: (width - W) / 2, top: (height - H) / 2, width: W, height: H, scale } as const,
        toBoard: (p: { x: number; y: number }) => ({ x: (p.x - left) / scale, y: (p.y - top) / scale }),
    }
}

// The board on a full-window matte, the colour the bars around it have always been.
function Board({ children }: { children: React.ReactNode }) {
    const board = useBoard()
    return (
        <View style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", backgroundColor: "#14181d" }}>
            <View style={board.style}>{children}</View>
        </View>
    )
}

/*
 * Foobar: a test bed for the first real asset upload.
 *
 * It runs as it stands, so the game is never broken while you set it up. The
 * commented block below is the part that exercises the shipped asset path.
 *
 * TO USE IT:
 *   1. Open the Assets panel on the left and upload any image. Name it
 *      logo.png. The name is what matters, not the picture.
 *   2. Uncomment the two marked lines below: the `logo` const, and the <Image>
 *      inside the return. Leave the rest alone.
 *   3. Run. The pulsing square is replaced by your image, pulsing the same way.
 *
 * WHAT IT IS ACTUALLY TESTING. assetUrl is the real mechanism, not a stand-in:
 * it is the one function that knows where a game's files live, and on the site
 * it resolves to /assets/<name> on this game's own origin. Uploading fills the
 * shared blob store and writes the row that serving resolves through. So this
 * one image exercises the upload gate, the blob write, the row, and the read
 * path in a single step.
 */

function Foobar() {
    const [t, setT] = useState(0)
    useFrame((dt) => setT((n) => n + dt), [])

    // --- UNCOMMENT THIS LINE once logo.png is uploaded -----------------------
    // const logo = assetUrl("logo.png")
    // -------------------------------------------------------------------------

    // A plain number, deliberately. `rotate` in this stack wants a Rotate
    // struct rather than a bare number, and a fixture whose job is to be
    // unambiguous should not hinge on a style property that might quietly do
    // nothing. Size is a number everywhere and cannot be misread.
    const size = 180 + Math.sin(t * 2) * 40

    return (
        <View className="items-center justify-center bg-neutral-900"
              style={{ width: W, height: H }}>

            {/* --- UNCOMMENT THIS BLOCK too, and delete the placeholder below ---
            <Image src={logo} style={{ width: size, height: size }} />
            ------------------------------------------------------------------ */}

            {/* Placeholder, so the game runs before anything is uploaded. */}
            <View style={{ width: size, height: size, backgroundColor: "#ffd166" }} />

            <Text className="mt-8 text-xl text-neutral-400">
                Foobar
            </Text>
        </View>
    )
}

mount(<Board><Foobar /></Board>)
