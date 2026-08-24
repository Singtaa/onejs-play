import { useState, useMemo } from "react"
import { View, Text, mount, useFrame, input, random } from "oj"
import "onejs:tailwind"
import styles from "./wordie.module.uss"
import { ANSWERS, isAcceptedGuess } from "./words"
import {
    scoreGuess, keyboardStates, statusOf, rejectionReason,
    WORD_LENGTH, MAX_GUESSES, type LetterState,
} from "./game"

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"]
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

// UTC, so the day turns over at the same moment for everyone.
function wordOfTheDay(): string {
    const today = new Date().toISOString().slice(0, 10)
    return random(`wordie-${today}`).pick(ANSWERS)
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

function Wordie() {
    const answer = useMemo(wordOfTheDay, [])
    const [guesses, setGuesses] = useState<string[]>([])
    const [draft, setDraft] = useState("")
    const [message, setMessage] = useState("")

    const status = statusOf(guesses, answer)
    const keys = useMemo(() => keyboardStates(guesses, answer), [guesses, answer])

    const type = (letter: string) => {
        if (status !== "playing") return
        setMessage("")
        setDraft((d) => (d.length >= WORD_LENGTH ? d : d + letter))
    }

    const backspace = () => {
        if (status !== "playing") return
        setMessage("")
        setDraft((d) => d.slice(0, -1))
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

    useFrame(() => {
        if (input.keyboard.wasKeyPressed("Enter")) submit()
        else if (input.keyboard.wasKeyPressed("Backspace")) backspace()
        else {
            for (const letter of LETTERS) {
                if (input.keyboard.wasKeyPressed(letter)) type(letter)
            }
        }
    }, [draft, guesses, status])

    return (
        <View className="flex-1 items-center bg-neutral-900 py-6">
            <Text className="text-3xl font-bold text-white mb-1">WORDIE</Text>
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

            {/* Fixed height, so the board does not jump when a message appears. */}
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

mount(<Wordie />)
