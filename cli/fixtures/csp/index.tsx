// Three fetches the game origin's policy rules on: a blob address the page
// made (allowed, as a model made in code needs), a data: address and another
// origin (both refused). Each answer is written down for csp.playtest.mjs.
import { useEffect, useState } from "react"
import { Text, View, mount } from "oj"

type Answers = Record<string, "ok" | "refused">
const web = globalThis as unknown as {
    fetch(url: string): Promise<{ text(): Promise<string> }>
    URL: { createObjectURL(blob: unknown): string }
    Blob: new (parts: unknown[]) => unknown
    __csp?: Answers
}

async function tryFetch(url: string): Promise<"ok" | "refused"> {
    try {
        await (await web.fetch(url)).text()
        return "ok"
    } catch {
        return "refused"
    }
}

function Csp() {
    const [answers, setAnswers] = useState<Answers | null>(null)
    useEffect(() => {
        void (async () => {
            const out: Answers = {
                blob: await tryFetch(web.URL.createObjectURL(new web.Blob(["made here"]))),
                data: await tryFetch("data:,elsewhere"),
                elsewhere: await tryFetch("https://example.com/"),
            }
            web.__csp = out
            setAnswers(out)
        })()
    }, [])
    return (
        <View style={{ padding: 16 }}>
            <Text style={{ color: "#ffffff" }}>{answers === null ? "asking" : Object.entries(answers).map(([k, v]) => `${k} ${v}`).join(", ")}</Text>
        </View>
    )
}

mount(<Csp />)
