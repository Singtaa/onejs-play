import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
    // onejs-unity's input module pulls in React hooks, and React is an optional
    // peer dep there, so it has to resolve to this package's copy.
    resolve: {
        alias: { react: path.resolve(import.meta.dirname, "node_modules/react") },
    },
    test: {
        globals: true,
        environment: "node",
        setupFiles: ["./src/__tests__/pre-setup.ts"],
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts", "src/**/*.tsx"],
            exclude: ["src/**/*.test.ts", "src/__tests__/**"],
        },
    },
})
