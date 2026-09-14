// One idea: every change to state is a named action, handled in one place.
//
// Nothing in this file changes a score. It dispatches an action and the
// reducer in tally.ts decides what that means, which is what makes the rules
// testable on their own and undo three words long.
import { useReducer } from "react"
import { View, Text, Button, mount } from "oj"
import { reduce, start } from "./tally"
import "onejs:tailwind"

const PLAYERS = ["Ash", "Bo", "Cass"]

function Tally() {
    const [state, dispatch] = useReducer(reduce, PLAYERS.length, start)

    return (
        <View className="w-full h-full p-8 bg-neutral-900">
            <Text className="text-2xl text-white">Tally</Text>
            <Text className="mt-1 mb-6 text-sm text-neutral-400">
                {state.log.length === 0 ? "Nothing has happened yet." : `${state.log.length} points so far.`}
            </Text>

            {PLAYERS.map((name, who) => (
                <View key={name} className="flex-row items-center mb-3">
                    <Text className="w-24 text-lg text-neutral-200">{name}</Text>
                    <Text className="w-16 text-2xl text-amber-300">{String(state.scores[who])}</Text>
                    <Button text="Score" onClick={() => dispatch({ type: "score", who })} />
                </View>
            ))}

            <View className="flex-row mt-6">
                <Button text="Undo" onClick={() => dispatch({ type: "undo" })} style={{ marginRight: 8 }} />
                <Button text="Reset" onClick={() => dispatch({ type: "reset" })} />
            </View>
        </View>
    )
}
mount(<Tally />)
