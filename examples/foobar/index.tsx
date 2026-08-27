import { useState } from "react"
import { View, Text, Image, mount, useFrame, assetUrl } from "oj"
import "onejs:tailwind"

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

const STAGE = 600

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
              style={{ width: STAGE, height: STAGE }}>

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

mount(<Foobar />)
