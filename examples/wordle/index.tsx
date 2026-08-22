/**
 * Wordle, written against oj exactly as a published game would be.
 *
 * The rules live in game.ts with no oj in them at all, so they unit test on
 * their own; this file is the part that renders and reads input.
 *
 * Worth noting what is NOT here: no CS.*, no build config, no root plumbing.
 * The container supplies oj, mount() knows where to render, and physical keys
 * arrive through the same input API a native OneJS project uses.
 */

import { useState, useMemo } from "react"
import { View, Text, mount, useFrame, input, random } from "oj"
import "onejs:tailwind"
import styles from "./wordle.module.uss"
import { ANSWERS, isAcceptedGuess } from "./words"
import {
    scoreGuess, keyboardStates, statusOf, rejectionReason,
    WORD_LENGTH, MAX_GUESSES, type LetterState,
} from "./game"

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"]
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

/** One word a day, the same for everyone, without a server telling us which. */
function wordOfTheDay(): string {
    const today = new Date().toISOString().slice(0, 10)
    return random(`wordle-${today}`).pick(ANSWERS)
}

function Tile({ letter, state, filled }: { letter: string; state?: LetterState; filled: boolean }) {
    const tone = state ? styles[state] : filled ? styles.tileFilled : styles.tileEmpty
    return (
        <View className={`${styles.tile} ${tone}`}>
            <Text className="text-2xl font-bold text-white">{letter}</Text>
        </View>
    )
}

function Row({ guess, answer, draft, revealed }: {
    guess?: string
    answer: string
    draft?: string
    revealed: boolean
}) {
    const word = guess ?? draft ?? ""
    const states = revealed && guess ? scoreGuess(guess, answer) : undefined
    return (
        <View className="flex-row">
            {Array.from({ length: WORD_LENGTH }, (_, i) => (
                <Tile key={i} letter={word[i] ?? ""} state={states?.[i]} filled={i < word.length} />
            ))}
        </View>
    )
}

/** Key tints, kept separate from the tile ones. See wordle.module.uss. */
const KEY_TONE: Record<LetterState, string> = {
    correct: styles.keyCorrect,
    present: styles.keyPresent,
    absent: styles.keyAbsent,
}

function Key({ label, state, wide, onPress }: {
    label: string
    state?: LetterState
    wide?: boolean
    onPress: () => void
}) {
    // A letter already proven absent cannot help, so the key goes dark and
    // stops responding rather than letting a player spend a guess on it.
    const dead = state === "absent"
    const tone = state ? KEY_TONE[state] : ""
    return (
        <View
            className={`${styles.key} ${wide ? styles.keyWide : styles.keyNarrow} ${tone}`}
            onClick={dead ? undefined : onPress}
        >
            <Text className={`text-xs font-bold ${dead ? styles.keyLabelAbsent : "text-white"}`}>{label}</Text>
        </View>
    )
}

function Wordle() {
    const answer = useMemo(wordOfTheDay, [])
    const [guesses, setGuesses] = useState<string[]>([])
    const [draft, setDraft] = useState("")
    const [message, setMessage] = useState("")

    const status = statusOf(guesses, answer)
    const keys = useMemo(() => keyboardStates(guesses, answer), [guesses, answer])

    const type = (letter: string) => {
        if (status !== "playing" || draft.length >= WORD_LENGTH) return
        setMessage("")
        setDraft(draft + letter)
    }

    const backspace = () => {
        if (status !== "playing") return
        setMessage("")
        setDraft(draft.slice(0, -1))
    }

    const submit = () => {
        if (status !== "playing") return
        const reason = rejectionReason(draft, isAcceptedGuess)
        if (reason !== null) {
            setMessage(reason)
            return
        }
        const next = [...guesses, draft.toUpperCase()]
        setGuesses(next)
        setDraft("")
        const after = statusOf(next, answer)
        if (after === "won") setMessage("Got it")
        else if (after === "lost") setMessage(answer)
    }

    // Physical keys, polled once a frame. Same API a native OneJS project uses;
    // in the container it is fed by browser events through the input backend.
    useFrame(() => {
        if (input.keyboard.wasKeyPressed("Enter")) submit()
        else if (input.keyboard.wasKeyPressed("Backspace")) backspace()
        else {
            for (const letter of LETTERS) {
                if (input.keyboard.wasKeyPressed(letter)) {
                    type(letter)
                    break
                }
            }
        }
    }, [draft, guesses, status])

    return (
        <View className="flex-1 items-center bg-neutral-900 py-6">
            <Text className="text-3xl font-bold text-white mb-1">WORDLE</Text>
            <Text className="text-xs text-neutral-500 mb-4">{`built with oj  ${guesses.length}/${MAX_GUESSES}`}</Text>

            <View className="mb-3">
                {Array.from({ length: MAX_GUESSES }, (_, row) => (
                    <Row
                        key={row}
                        guess={guesses[row]}
                        draft={row === guesses.length ? draft : undefined}
                        answer={answer}
                        revealed={row < guesses.length}
                    />
                ))}
            </View>

            <View className="h-6 mb-3">
                <Text className="text-sm font-bold text-white">{message}</Text>
            </View>

            <View className="items-center">
                {KEY_ROWS.map((row, i) => (
                    <View key={i} className="flex-row">
                        {i === 2 && <Key label="ENTER" wide onPress={submit} />}
                        {[...row].map((letter) => (
                            <Key key={letter} label={letter} state={keys[letter]} onPress={() => type(letter)} />
                        ))}
                        {i === 2 && <Key label="DEL" wide onPress={backspace} />}
                    </View>
                ))}
            </View>
        </View>
    )
}

mount(<Wordle />)

export function onPlay() {}
export function onStop() {}
