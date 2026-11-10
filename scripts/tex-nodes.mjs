// Writes src/tex/tex-nodes.json, tex's node table for Magerie's OJPlay emitter,
// by running its test with TEX_NODES_WRITE set; the plain test only compares.
import { spawnSync } from "node:child_process"

const run = spawnSync("npx", ["vitest", "run", "src/__tests__/tex-nodes.test.ts"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, TEX_NODES_WRITE: "1" },
})
process.exit(run.status ?? 1)
