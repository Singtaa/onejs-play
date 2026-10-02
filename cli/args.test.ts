import { describe, it, expect } from "vitest"
import { parse } from "./args.mjs"

/**
 * The command line, read strictly. The old reader gave every flag the word after
 * it, so `ojplay test --headed play.mjs` ran with no script and printed "passed";
 * an unknown or misspelled flag was dropped without a word; and a bare `--out`
 * wrote a file called "true".
 */
describe("the command line", () => {
    it("keeps the word after a switch as an argument", () => {
        expect(parse(["test", "--headed", "play.mjs"])).toEqual({ command: "test", args: ["play.mjs"], flags: { headed: true } })
        expect(parse(["run", "--headed", "--watch"]).flags).toEqual({ headed: true, watch: true })
    })

    it("gives a value flag its value, written either way", () => {
        expect(parse(["run", "--for", "10"]).flags).toEqual({ for: "10" })
        expect(parse(["run", "--for=10"]).flags).toEqual({ for: "10" })
        expect(parse(["build", "--out", "x.js"]).flags).toEqual({ out: "x.js" })
    })

    it("lets the flags that take an optional value go without one", () => {
        expect(parse(["update", "--major"]).flags).toEqual({ major: true })
        expect(parse(["update", "--major", "@a/b"]).flags).toEqual({ major: "@a/b" })
        expect(parse(["login", "--wait"]).flags).toEqual({ wait: true })
        expect(parse(["login", "--no-wait"]).flags).toEqual({ "no-wait": true })
    })

    it("refuses a flag it does not know, and names the one meant", () => {
        expect(() => parse(["test", "--hedaed"])).toThrow(/unknown flag --hedaed.*--headed/)
        expect(() => parse(["--verison"])).toThrow(/--version/)
        expect(() => parse(["test", "-x"])).toThrow(/unknown flag -x/)
    })

    it("refuses a value flag given no value", () => {
        expect(() => parse(["build", "--out"])).toThrow(/--out needs a value/)
        expect(() => parse(["runtime", "--runtime"])).toThrow(/--runtime needs a value/)
    })

    it("refuses a value that cannot be what the flag means", () => {
        expect(() => parse(["test", "--for", "abc"])).toThrow(/--for is a number of seconds/)
        expect(() => parse(["run", "--window", "1280"])).toThrow(/--window is width,height/)
        expect(() => parse(["runtime", "--runtime", "../../etc"])).toThrow(/--runtime is a version/)
        expect(() => parse(["status", "--sid", "../x"])).toThrow(/--sid is a cart's 12 character id/)
        expect(() => parse(["run", "--headed=yes"])).toThrow(/--headed takes no value/)
    })

    it("reads -h and -v as --help and --version", () => {
        expect(parse(["build", "-h"]).flags).toEqual({ help: true })
        expect(parse(["-v"]).flags).toEqual({ version: true })
    })
})
