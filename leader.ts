import { closeSync, existsSync, openSync, readFileSync, rmSync, writeSync } from "node:fs"

export type Leader = {
  isLeader: boolean
  release: () => void
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isStale(path: string): boolean {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10)
    return Number.isFinite(pid) && !pidAlive(pid)
  } catch {
    return false
  }
}

/**
 * Single-leader election over an exclusive lock file. Exactly one live plugin
 * instance across locations/processes becomes leader and does the announcing;
 * the rest stay silent. A lock left by a dead process is taken over.
 */
export function acquireLeader(lockPath: string): Leader {
  let fd: number | null = null
  let leader = false

  const attempt = (): boolean => {
    try {
      fd = openSync(lockPath, "wx")
      writeSync(fd, String(process.pid))
      return true
    } catch {
      if (!existsSync(lockPath) || !isStale(lockPath)) return false
      try {
        rmSync(lockPath, { force: true })
      } catch {
        return false
      }
      try {
        fd = openSync(lockPath, "wx")
        writeSync(fd, String(process.pid))
        return true
      } catch {
        return false
      }
    }
  }

  leader = attempt()

  return {
    isLeader: leader,
    release: () => {
      if (!leader) return
      leader = false
      try {
        if (fd !== null) closeSync(fd)
      } catch {}
      fd = null
      try {
        rmSync(lockPath, { force: true })
      } catch {}
    },
  }
}
