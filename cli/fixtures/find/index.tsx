// A button that shows after the cart has started, away from the corner, for
// find.playtest.mjs to locate and click. It is there from the start with
// display none, which has no layout, so its worldBound reads as an element's
// does on the frame it mounts, and holds that long enough to be read every
// time rather than by luck.
import { useEffect, useState } from "react"
import { View, Text, Button, mount } from "oj"

function Late() {
    const [shown, setShown] = useState(false)
    const [clicked, setClicked] = useState(false)
    useEffect(() => {
        const id = setTimeout(() => setShown(true), 400)
        return () => clearTimeout(id)
    }, [])
    return (
        <View style={{ width: "100%", height: "100%", backgroundColor: "#14181d" }}>
            <Text style={{ color: "#ffffff" }}>{clicked ? "Clicked" : "Waiting"}</Text>
            <Button text="Late" onClick={() => setClicked(true)}
                style={{ display: shown ? "flex" : "none", position: "absolute", left: 300, top: 200, width: 120, height: 40 }} />
        </View>
    )
}

mount(<Late />)
