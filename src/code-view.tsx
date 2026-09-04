import { View, Text } from "onejs-react"
import { tokenize, CODE_THEME, type CodeTheme, type Token } from "./code"

/**
 * A block of highlighted code.
 *
 * UI Toolkit has no rich text runs to colour, so a line is a row of Text
 * elements, one per token. That is the only way to get two colours on one
 * line, and it is why this exists as a component rather than a string helper.
 *
 * Spaces are drawn as no-break spaces. UI Toolkit collapses the whitespace at
 * either end of a Text, and a token very often ends or begins with one: the
 * gap between `const` and its name is the plain token's leading space, and
 * the first live version of this drew `constwarp`. A no-break space is a real
 * glyph with the space's advance, so it survives at both ends, and it is
 * substituted here rather than in the tokenizer, which keeps handing back the
 * characters it was given.
 */
export interface CodeProps {
    /** The snippet, as one string or as lines. */
    source: string | readonly string[]
    fontSize?: number
    /**
     * Pixels per leading space, for an indent that is padding rather than
     * glyphs. Left unset, indentation is drawn with the same no-break spaces
     * as every other gap, at the font's own space width.
     */
    indent?: number
    theme?: Partial<CodeTheme>
    style?: Record<string, unknown>
}

const NBSP = "\u00a0"

/** The text a token is drawn with: every space a glyph UI Toolkit will keep. */
export function displayText(text: string): string {
    return text.replace(/ /g, NBSP)
}

export function Code({ source, fontSize = 12.5, indent, theme, style }: CodeProps) {
    const colors: CodeTheme = theme ? { ...CODE_THEME, ...theme } : CODE_THEME
    const lines = tokenize(source)

    return (
        <View style={style}>
            {lines.map((tokens: Token[], i: number) => {
                // With an explicit indent the leading run becomes padding. It
                // is measured from the tokens rather than the source, so the
                // caller can pass either shape.
                const first = tokens[0]
                const lead = indent !== undefined && first !== undefined && first.text.startsWith(" ")
                    ? first.text.length - first.text.trimStart().length
                    : 0
                const body = lead > 0
                    ? [{ ...first!, text: first!.text.slice(lead) }, ...tokens.slice(1)]
                    : tokens
                return (
                    <View key={i} style={{ flexDirection: "row", paddingLeft: lead * (indent ?? 0) }}>
                        {body.length === 0
                            // An empty line still has to take a line's height.
                            ? <Text style={{ fontSize, color: colors.plain }}>{NBSP}</Text>
                            : body.map((t: Token, j: number) => (
                                <Text key={j} style={{
                                    fontSize, color: colors[t.kind], whiteSpace: "nowrap",
                                }}>
                                    {displayText(t.text)}
                                </Text>
                            ))}
                    </View>
                )
            })}
        </View>
    )
}
