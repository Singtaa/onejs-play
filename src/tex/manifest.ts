/**
 * tex's node table as data, for Magerie's OJPlay emitter (magerie #1196): every
 * node by its op name, with the images it takes, its kind string, its
 * positional parameters, every option and its default, and the pictures it
 * returns. Read from SPECS, the one place tex defines a node, so it cannot say
 * what tex does not do. `tex-nodes.json` beside this file is its output, and
 * src/__tests__/tex-nodes.test.ts fails when the two differ;
 * `npm run tex-nodes` writes it again.
 */
import { makeNode, type Node } from "./graph"
import { DEFAULT_CANVAS, MATERIAL_DEFAULTS, MATERIAL_TAKES, SPECS, makeMaterial, type Canvas, type Spec, type SpecName } from "./nodes"

export interface TexNodeEntry {
    /** Leading image arguments, then up to `optionalImages` more. */
    images: number
    optionalImages?: number
    /** Takes a `material(...)` first, as Material Light does. */
    material?: true
    /** The option a leading string sets, as Magerie's script API `kindParam`. */
    kind?: string
    /** Options a call may give in order after the images and the kind. */
    positional: string[]
    /** Every option tex takes and its default; any other key is refused. `null` is "the canvas's" or "none". */
    options: Record<string, unknown>
    /** Options among `options` that take a picture from tex (or null for none), as scatter's mask. */
    imageOptions?: string[]
    /** "image" for one picture; otherwise the record's keys, as `scatter(...).id`. */
    outputs: string[]
    /** The call returns its `image`, carrying the other outputs as properties: it was published as an image first. */
    imageFirst?: true
    /** An output whose name differs from Magerie's port: tex's name to Magerie's port id. */
    ports?: Record<string, string>
}

export interface TexNodeTable {
    /** Bumped when this file's shape changes, not when a node does. */
    format: 2
    /** What a null size, tile or bitDepth option resolves to from `tex.canvas()` with no options, or a method call. */
    canvas: { width: number, height: number, tile: boolean, bitDepth: "8" | "32" }
    /** `tex.material({ ... })`, which Material Light takes first: each map's default (absent: required) and what it takes. */
    material: { maps: Record<string, { default?: unknown, takes: "image" | "image or number" }> }
    nodes: Record<string, TexNodeEntry>
}

/** The pictures a node returns, found by making it once from stand-ins: "image", or a record's keys. */
function outputsOf(spec: Spec): string[] {
    const canvas: Canvas = { width: 8, height: 8, tile: false, bitDepth: "8" }
    const stand = (): Node => makeNode("pixels", "source", [], {}, 8, 8, false, {})
    const images = Array.from({ length: spec.images }, stand)
    const material = spec.material ? makeMaterial({ albedo: stand() } as never, (v) => v as Node) : undefined
    const made = spec.make({ ...spec.defaults }, images, canvas, material)
    return "op" in made ? ["image"] : Object.keys(made)
}

export function texNodeTable(): TexNodeTable {
    const nodes: Record<string, TexNodeEntry> = {}
    for (const name of (Object.keys(SPECS) as SpecName[]).sort()) {
        const spec: Spec = SPECS[name]
        nodes[name] = {
            images: spec.images,
            ...(spec.optionalImages ? { optionalImages: spec.optionalImages } : {}),
            ...(spec.material ? { material: true as const } : {}),
            ...(spec.kind !== undefined ? { kind: spec.kind } : {}),
            positional: [...spec.positional],
            options: JSON.parse(JSON.stringify(spec.defaults)) as Record<string, unknown>,
            ...(spec.imageOptions ? { imageOptions: [...spec.imageOptions] } : {}),
            outputs: outputsOf(spec),
            ...(spec.imageFirst ? { imageFirst: true as const } : {}),
            ...(spec.ports ? { ports: { ...spec.ports } } : {}),
        }
    }
    const maps: TexNodeTable["material"]["maps"] = {}
    for (const [key, value] of Object.entries(MATERIAL_DEFAULTS)) {
        maps[key] = { ...(value === undefined ? {} : { default: value }), takes: MATERIAL_TAKES[key as keyof typeof MATERIAL_TAKES] }
    }
    return { format: 2, canvas: { ...DEFAULT_CANVAS }, material: { maps }, nodes }
}
