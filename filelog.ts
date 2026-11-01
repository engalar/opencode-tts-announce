import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs"

export type FileLog = (line: string) => void

/**
 * Diagnostics log with a hard size cap: once `maxBytes` is exceeded the current
 * file is rotated to `<path>.old` (one generation kept) and a fresh file starts.
 * Never throws — logging must not disturb the session.
 */
export function createFileLog(path: string, maxBytes: number): FileLog {
  return (line: string) => {
    try {
      if (existsSync(path) && statSync(path).size >= maxBytes) {
        try {
          renameSync(path, `${path}.old`)
        } catch {
          // Another process may briefly hold the file; dropping is fine for diagnostics.
          unlinkSync(path)
        }
      }
      appendFileSync(path, `${new Date().toISOString()} ${line}\n`)
    } catch {}
  }
}
