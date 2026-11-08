/**
 * What a kernel sees while its pass's program is recorded: this texel, the
 * pass's size, uniforms, and the textures of the nodes drawn before it.
 *
 * Every coordinate a kernel handles is Magerie's (texture-node-spec 1.2):
 * pixel (0, 0) is the TOP-LEFT texel and y grows down, a pixel's centre is
 * `pixel + 0.5`, and a uv is `pixel / size` with v down. The shader
 * language's own uv has v up, and the conversion lives here, once, so no
 * kernel ever flips anything.
 */
import { sl, type Float, type Vec2, type Vec4 } from "onejs-unity/sl"

/** A texture a kernel reads: a node drawn into its own target by an earlier pass. */
export interface TexRead {
    /** The texture's size in pixels. */
    readonly size: Vec2
    /** One texel, unfiltered, at an integral pixel (y down), which must be inside. */
    fetch(pixel: Vec2): Vec4
    /** Bilinear at a uv with v down, wrapped or clamped as the texture was declared. */
    sample(uv: Vec2): Vec4
}

export interface Scope {
    /** This texel, (x, y) with y down: whole numbers. */
    readonly pixel: Vec2
    /** The pass's size in pixels. */
    readonly size: Vec2
    /** A float the host sets: a parameter, so changing it recompiles nothing. */
    f(value: number): Float
    /** A float4 the host sets. */
    f4(value: readonly number[]): Vec4
}

/** A recorder for one pass's program, which hands kernels a Scope. */
export class ScopeRecorder implements Scope {
    readonly pixel: Vec2
    readonly size: Vec2
    /**
     * The uniforms declared, in order, with the values this graph gives them.
     * Each is declared at 0, since a default is part of the program's hash:
     * a new seed is a new value and the same program.
     */
    readonly uniforms: Record<string, number | number[]> = {}
    private next = 0

    constructor(uv: Vec2, resolution: Vec2) {
        this.size = resolution
        // uv is a texel centre with v up: (i + 0.5) / n, so floor(uv * n) is i
        // exactly, and the row from the top is n - 1 - i.
        const i = uv.mul(resolution).floor()
        this.pixel = sl.vec2(i.x, resolution.y.sub(1).sub(i.y))
    }

    f(value: number): Float {
        const name = `u${this.next++}`
        this.uniforms[name] = value
        return sl.uniform.float(name, 0)
    }

    f4(value: readonly number[]): Vec4 {
        const name = `u${this.next++}`
        const v: [number, number, number, number] = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0]
        this.uniforms[name] = v
        return sl.uniform.vec4(name, [0, 0, 0, 0])
    }
}

/**
 * Declares a texture for the program and wraps it in Magerie's coordinates.
 * `wrap` decides the sampler for `sample`; `fetch` never filters or wraps.
 */
export function declareTexture(name: string, wrap: boolean): TexRead {
    const t = sl.texture(name, { wrap: wrap ? "repeat" : "clamp", filter: "linear" })
    const size = t.size()
    return {
        size,
        fetch(pixel: Vec2): Vec4 {
            // The shader language counts texel rows from the bottom.
            return t.fetch(sl.vec2(pixel.x, size.y.sub(1).sub(pixel.y)))
        },
        sample(uv: Vec2): Vec4 {
            return t.sample(sl.vec2(uv.x, sl.float(1).sub(uv.y)))
        },
    }
}
