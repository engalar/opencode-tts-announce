import { describe, test, expect, beforeEach } from "bun:test"
import { mkdtempSync, existsSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFileLog } from "./filelog"

const newPath = () => join(mkdtempSync(join(tmpdir(), "filelog-test-")), "diag.log")

describe("createFileLog", () => {
  test("appends timestamped lines", () => {
    const path = newPath()
    const log = createFileLog(path, 10_000)
    log("hello")
    log("world")
    const body = readFileSync(path, "utf8")
    expect(body).toContain("hello")
    expect(body).toContain("world")
    expect(body.split("\n").filter((l) => l.includes("world")).length).toBe(1)
  })

  test("rotates to .old once the cap is exceeded and starts fresh", () => {
    const path = newPath()
    const log = createFileLog(path, 200)
    for (let i = 0; i < 50; i++) log(`line-${i}-${"x".repeat(20)}`)
    expect(existsSync(`${path}.old`)).toBe(true)
    expect(statSync(path).size).toBeLessThan(400)
  })

  test("keeps logging after rotation", () => {
    const path = newPath()
    const log = createFileLog(path, 200)
    for (let i = 0; i < 50; i++) log(`line-${i}-${"x".repeat(20)}`)
    log("after-rotation")
    expect(readFileSync(path, "utf8")).toContain("after-rotation")
  })

  test("one-rotation scenario: old generation moves to .old, fresh file continues", () => {
    const path = newPath()
    const log = createFileLog(path, 400)
    log("first-generation-marker")
    for (let i = 0; i < 10; i++) log(`line-${i}-${"x".repeat(20)}`)
    log("post-rotation")
    expect(readFileSync(path, "utf8")).toContain("post-rotation")
    expect(readFileSync(path, "utf8")).not.toContain("first-generation-marker")
    expect(readFileSync(`${path}.old`, "utf8")).toContain("first-generation-marker")
  })
})
