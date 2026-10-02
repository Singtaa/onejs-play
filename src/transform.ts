/**
 * 2D affine transforms for the painter.
 *
 * The matrix, the save and restore stack and the transformed path are
 * onejs-react's, so a cart and a OneJS app share one implementation. The only
 * difference is what point() returns: onejs-react makes a CS Vector2 for raw
 * Painter2D calls, which a cart has no use for, so oj's makes its own Vector2.
 *
 *     import { Transform2D, drawing } from "oj"
 *
 *     onGenerateVisualContent={drawing((p) => {
 *         const t = new Transform2D().translate(100, 100).rotate(Math.PI / 4)
 *         const path = t.path(p)
 *         path.beginPath()
 *         path.moveTo(-40, -40)
 *         path.lineTo(40, -40)
 *         path.lineTo(40, 40)
 *         path.closePath()
 *         p.fillColor("#ff0000").fill()
 *     })}
 */

import { Transform2D as Transform2DBase } from "onejs-react"
import { Vector2 } from "./vec"

export class Transform2D extends Transform2DBase<Vector2> {
    protected override makePoint(x: number, y: number): Vector2 {
        return new Vector2(x, y)
    }
}

export { TransformedPath } from "onejs-react"
export type { PathSink } from "onejs-react"
