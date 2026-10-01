// Every key a script presses reaches the game as its own press, in order.
//
// A frame only knows WHICH keys went down since the last one, not in what
// order, so two presses that land in one frame come out in whatever order the
// game's loop checks them. Wordie checks letters alphabetically: typing CRANE
// the moment the cart started put all five in the container's first, long
// frame and submitted ACENR, which read as "Enter never submits" (#3).
//
// So this presses straight after start, the way that went wrong, and requires
// each press to be seen alone and in sequence.
const LETTERS = "crane"
const NAMED = [
    ["Enter", "Enter"], ["Backspace", "Backspace"], ["Escape", "Escape"], ["Tab", "Tab"], ["Space", "Space"],
    ["ArrowLeft", "LeftArrow"], ["ArrowUp", "UpArrow"], ["ArrowRight", "RightArrow"], ["ArrowDown", "DownArrow"],
    ["Delete", "Delete"], ["Home", "Home"], ["End", "End"], ["PageUp", "PageUp"], ["PageDown", "PageDown"],
    ["Digit1", "Digit1"],
]

export default async function (game) {
    await game.type(LETTERS)
    for (const [code] of NAMED) await game.press(code)
    await game.wait(200)

    const expected = [...LETTERS.toUpperCase(), ...NAMED.map(([, name]) => name)]
    const log = JSON.parse(await game.eval("JSON.stringify(globalThis.__keyLog ?? null)"))
    if (!Array.isArray(log)) throw new Error("the cart never published __keyLog")
    const names = log.map((entry) => entry.split(":")[1])
    const frames = log.map((entry) => Number(entry.split(":")[0]))
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
        throw new Error(`keys arrived as ${JSON.stringify(log)}; expected ${JSON.stringify(expected)}, one per frame`)
    }
    for (let i = 1; i < frames.length; i++) {
        if (frames[i] <= frames[i - 1]) throw new Error(`${names[i - 1]} and ${names[i]} landed in one frame: ${JSON.stringify(log)}`)
    }
}
