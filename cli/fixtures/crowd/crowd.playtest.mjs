// What a crowd nobody sees costs, on a real container: 400 skinned people behind the camera,
// each looping a clip, timed by what Unity's main thread spends in a frame (which a screen's
// refresh does not round up, and which drawing nothing keeps the graphics card out of).
//
// Three readings in one run: an empty scene, the unseen crowd, and the same crowd with every mesh
// made to update off screen again, which is what each did before runtime 1.9 (glTFast's default:
// deformed on the CPU and uploaded every frame). The crowd must cost at most a quarter of what it
// costs made to update, over the empty scene. The third reading is also the proof that this run
// could tell: if making them update costs under a millisecond, nothing was compared. Throws, so
// the run exits non-zero, on either, or on a reading that was not taken.
export const PEOPLE = 400
export const SHARE = 0.25
export const TELLS_MS = 1

const SETUP = { seen: 0, clips: "play", move: false, shadows: false }

async function read(game, what, warmMs, ms) {
    await game.wait(warmMs)
    await game.eval("JSON.stringify(globalThis.crowd.frames())")
    await game.wait(ms)
    const f = JSON.parse(await game.eval("JSON.stringify(globalThis.crowd.frames())"))
    if (!(f.mainCount >= 10) || !(f.main >= 0)) throw new Error(`crowd: ${what} read ${f.mainCount} frames of main thread time (${f.main}): nothing was measured`)
    console.log(`MAIN ${what}: ${f.main.toFixed(3)} ms over ${f.mainCount} frames (frame to frame ${f.mean.toFixed(2)} ms)`)
    return f.main
}

// A move is kept in JS and sent when the frame ends, so a place read back from Unity in the frame
// that moved it has to be sent first: one person, moved 3 m aside in a frame callback, whose screen
// point and pick are asked for before that callback returns.
async function readBack(game, set) {
    await set(1, 1)
    await game.wait(500)
    await game.eval("globalThis.crowd.askReadBack()")
    await game.until(async () => (await game.eval("globalThis.crowd.readBack !== null")) === true, { what: "the frame that moves and reads back", timeoutMs: 10000 })
    const r = JSON.parse(await game.eval("JSON.stringify(globalThis.crowd.readBack)"))
    console.log(`READ BACK ${JSON.stringify(r)}`)
    if (r.before === null || r.after === null) throw new Error("crowd: the person was not on screen, so nothing was read back")
    const shift = Math.abs(r.after.x - r.before.x)
    if (!(shift >= 40)) throw new Error(`crowd: a person moved 3 m aside read back ${shift.toFixed(1)} px from where it was in the same frame (at least 40): screenPoint saw the old place`)
    if (!r.pickedAfter) throw new Error("crowd: a pick at the place a person was moved to in the same frame did not find it")
    if (r.pickedBefore) throw new Error("crowd: a pick at the place a person was moved from in the same frame still found it")
}

// A part, a joint and a borrowed clip, asked of the container itself: person.parts.glb has four
// parts, twenty joints and no clips but the ten it takes from person.glb, and a hat put 0.25 m
// over a head 1.53 m up, then taken off, is left 1.78 m up and 6 m ahead at the size it had.
async function seams(game) {
    const s = JSON.parse(await game.eval("JSON.stringify(globalThis.crowd.seams())"))
    console.log(`SEAMS ${JSON.stringify(s)}`)
    const near = (a, b) => Math.abs(a - b) <= 0.02
    if (s.parts.join() !== "trunk,legs,arms,head" || s.own.join() !== "person") throw new Error(`crowd: the models' parts read ${s.parts} and ${s.own}, not trunk, legs, arms, head and person`)
    if (s.joints !== 20) throw new Error(`crowd: the four-part person lists ${s.joints} joints, not 20`)
    if (s.clips !== 10) throw new Error(`crowd: the four-part person, which has no clips, plays ${s.clips} of person.glb's ten`)
    if (!near(s.on[0], 0) || !near(s.on[1], 0.25) || !near(s.on[2], 0)) throw new Error(`crowd: a hat put 0.25 m over a head reads ${s.on} from the head`)
    if (!near(s.off[0], 0) || !near(s.off[1], 1.78) || !near(s.off[2], 6)) throw new Error(`crowd: a hat taken off a head 1.53 m up and 6 m ahead was left at ${s.off}, not 0, 1.78, 6`)
    if (!near(s.scale, 0.25)) throw new Error(`crowd: a hat a quarter the size came off its head at ${s.scale}`)
}

export default async function (game) {
    await game.until(async () => (await game.eval("typeof globalThis.crowd")) === "object", { what: "the crowd cart", timeoutMs: 30000 })
    const set = async (count, seen = 0) => {
        const made = Number(await game.eval(`globalThis.crowd.set(${JSON.stringify({ ...SETUP, count, seen })})`))
        if (made !== count) throw new Error(`crowd: asked for ${count} people and ${made} were made`)
    }
    await seams(game)
    await readBack(game, set)
    await set(0)
    const empty = await read(game, "empty", 500, 1500)
    await set(PEOPLE)
    const unseen = await read(game, `${PEOPLE} unseen`, 1500, 2000)
    const changed = Number(await game.eval("globalThis.crowd.updateOffscreen()"))
    if (changed !== PEOPLE) throw new Error(`crowd: ${changed} of ${PEOPLE} meshes were made to update off screen: the comparison is not the one meant`)
    const updating = await read(game, `${PEOPLE} unseen, made to update`, 1500, 2000)

    const cost = unseen - empty, most = updating - empty
    console.log(`COST unseen ${cost.toFixed(3)} ms, made to update ${most.toFixed(3)} ms, share ${(cost / most).toFixed(3)}`)
    if (!(most >= TELLS_MS)) throw new Error(`crowd: making ${PEOPLE} meshes update off screen cost ${most.toFixed(3)} ms a frame, under ${TELLS_MS}: this run cannot tell an unseen crowd that is skinned from one that is not`)
    if (!(cost <= most * SHARE)) throw new Error(`crowd: ${PEOPLE} unseen people cost ${cost.toFixed(3)} ms a frame, ${(cost / most * 100).toFixed(0)}% of the ${most.toFixed(3)} ms they cost when made to update off screen (at most ${SHARE * 100}%): an actor nobody sees is being skinned or sampled again`)
}
