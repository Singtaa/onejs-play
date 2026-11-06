// Types for xatlas.vendor.js: the parts of xatlas-wasm's own declarations oj uses,
// written out so the published package needs no xatlas-wasm to typecheck.

/** Options for packing; padding in texels, texelsPerUnit in texels a model unit. */
export interface PackOptions {
    maxChartSize?: number
    padding?: number
    texelsPerUnit?: number
    resolution?: number
    bilinear?: boolean
    blockAlign?: boolean
    bruteForce?: boolean
    rotateChartsToAxis?: boolean
    rotateCharts?: boolean
}

export interface Vertex {
    atlasIndex: number
    /** -1 when the vertex is in no chart: it belongs only to faces with no area. */
    chartIndex: number
    /** In texels, 0 to the atlas's width and height. */
    uv: [number, number]
    /** The input vertex this one was split from. */
    xref: number
}

export interface Mesh {
    vertexCount: number
    indexCount: number
    chartCount: number
    vertices: Vertex[]
    indices: Uint32Array
}

export interface XAtlas {
    /** 0 on success, otherwise an error code addMeshErrorString names. */
    addMesh(options: { positions: Float32Array, indices?: Uint16Array | Uint32Array, normals?: Float32Array }): number
    computeCharts(options?: Record<string, number | boolean>): void
    packCharts(options?: PackOptions): void
    readonly width: number
    readonly height: number
    readonly atlasCount: number
    readonly chartCount: number
    getMesh(meshIndex: number): Mesh
    destroy(): void
}

export interface XAtlasModule {
    createAtlas(): XAtlas
    addMeshErrorString(error: number): string
}

/** The module factory, given an instantiateWasm hook so it never loads its own module. */
export default function createXAtlas(options: {
    instantiateWasm(imports: Record<string, Record<string, unknown>>, receive: (instance: { exports: unknown }) => void): object
}): Promise<XAtlasModule>
