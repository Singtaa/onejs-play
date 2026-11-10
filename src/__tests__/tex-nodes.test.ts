import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { texNodeTable } from "../tex/manifest"

const file = path.join(__dirname, "..", "tex", "tex-nodes.json")

describe("tex-nodes.json", () => {
    it("is tex's node table as SPECS has it, so Magerie's emitter reads what tex does", () => {
        const table = texNodeTable()
        const text = `${JSON.stringify(table, null, 4)}\n`
        // `npm run tex-nodes` writes it; any other run only compares.
        if (process.env.TEX_NODES_WRITE === "1") fs.writeFileSync(file, text)
        const held = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : ""
        expect(held, "src/tex/tex-nodes.json is stale: run npm run tex-nodes in onejs-play").toBe(text)
    })

    it("names scatter's three pictures and noise's options as Magerie's emitter must write them", () => {
        const { nodes } = texNodeTable()
        expect(nodes.scatter!.outputs).toEqual(["image", "id", "random"])
        expect(nodes.tileGrid!.outputs).toEqual(["image", "random", "uv"])
        expect(nodes.blur!.outputs).toEqual(["image"])
        expect([nodes.sdfShape!.outputs, nodes.sdfShape!.imageFirst, nodes.sdfShape!.ports]).toEqual([["image", "sdf"], true, { sdf: "out-distance" }])
        // A default that differs from Magerie's is what the emitter must write out (scaleLock: tex has none set).
        expect(nodes.noise!.options).toMatchObject({ scaleLock: null, bitDepth: null, type: "simplex" })
        expect(nodes.noise!.kind).toBe("type")
        expect([nodes.scatter!.imageOptions, nodes.scatter!.options.mask]).toEqual([["mask"], null])
    })

    it("carries the canvas a null option resolves to and the material Material Light takes", () => {
        const table = texNodeTable()
        expect(table.canvas).toEqual({ width: 1024, height: 1024, tile: false, bitDepth: "8" })
        expect(table.material.maps.albedo).toEqual({ takes: "image" })
        expect(table.material.maps.roughness).toEqual({ default: 0.5, takes: "image or number" })
        expect(Object.keys(table.material.maps)).toEqual(["albedo", "normal", "roughness", "metallic", "height", "ao", "emissive", "opacity"])
    })
})
