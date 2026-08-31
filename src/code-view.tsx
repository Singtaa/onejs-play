import { View, Text } from "onejs-react"
import { tokenize, CODE_THEME, type CodeTheme, type Token } from "./code"

/**
 * A block of highlighted code.
 *
 * UI Toolkit has no rich text runs to colour, so a line is a row of Text
 * elements, one per token. That is the only way to get two colours on one
 * line, and it is why this exists as a component rather than a string helper.
 *
 * Indentation is padding rather than spaces, because UI Toolkit collapses
 * leading whitespace in a Text and every line would otherwise start flush
 * left, which is exactly the nesting a code panel is there to show.
 */
export interface CodeProps {
    /** The snippet, as one string or as lines. */
    source: string | readonly string[]
    fontSize?: number
    /** Pixels per leading space. Roughly half the font size reads right. */
    indent?: number
    theme?: Partial<CodeTheme>
    style?: Record<string, unknown>
}

export function Code({ source, fontSize = 12.5, indent, theme, style }: CodeProps) {
    const colors: CodeTheme = theme ? { ...CODE_THEME, ...theme } : CODE_THEME
    const step = indent ?? Math.round(fontSize * 0.5)
    const lines = tokenize(source)

    return (
        <View style={style}>
            {lines.map((tokens: Token[], i: number) => {
                // The leading run is measured from the tokens rather than the
                // source, so the caller can pass either shape.
                const first = tokens[0]
                const lead = first !== undefined && first.text.startsWith(" ")
                    ? first.text.length - first.text.trimStart().length
                    : 0
                const body = lead > 0
                    ? [{ ...first!, text: first!.text.slice(lead) }, ...tokens.slice(1)]
                    : tokens
                return (
                    <View key={i} style={{ flexDirection: "row", paddingLeft: lead * step }}>
                        {body.length === 0
                            // An empty line still has to take a line's height.
                            ? <Text style={{ fontSize, color: colors.plain }}> </Text>
                            : body.map((t: Token, j: number) => (
                                <Text key={j} style={{
                                    fontSize, color: colors[t.kind], whiteSpace: "nowrap",
                                }}>
                                    {t.text}
                                </Text>
                            ))}
                    </View>
                )
            })}
        </View>
    )
}
