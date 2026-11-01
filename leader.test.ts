import { describe, test, expect, beforeEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireLeader } from "./leader"

const dir = () => join(mkdtempSync(join(tmpdir(), "leader-test-")), "lock")

describe("acquireLeader", () => {
  test("first caller becomes leader", () => {
    const leader = acquireLeader(dir())
    expect(leader.isLeader).toBe(true)
    leader.release()
  })

  test("second caller on a live lock is not leader", () => {
    const path = dir()
    const first = acquireLeader(path)
    const second = acquireLeader(path)
    expect(first.isLeader).toBe(true)
    expect(second.isLeader).toBe(false)
    first.release()
  })

  test("released lock can be acquired again", () => {
    const path = dir()
    acquireLeader(path).release()
    const next = acquireLeader(path)
    expect(next.isLeader).toBe(true)
    next.release()
  })

  test("stale lock from a dead pid is taken over", () => {
    const path = dir()
    // A pid that cannot exist on any platform we target.
    const first = acquireLeader(path)
    first.release()
    const { writeFileSync } = require("node:fs") as typeof import("node:fs")
    writeFileSync(path, "2147483646")
    const leader = acquireLeader(path)
    expect(leader.isLeader).toBe(true)
    leader.release()
  })

  test("release is idempotent and never throws", () => {
    const leader = acquireLeader(dir())
    leader.release()
    expect(() => leader.release()).not.toThrow()
  })
})
