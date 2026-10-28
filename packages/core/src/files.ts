import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createHash, randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// writeAtomic writes through a temporary file in the same directory and
// renames it into place, so a reader never sees a partial file.
export function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`)
  try {
    writeFileSync(temp, content)
    renameSync(temp, path)
  } catch (err) {
    rmSync(temp, { force: true })
    throw err
  }
}

const lockTimeoutMs = 5_000
const staleLockMs = 30_000

// withLock serializes writers to one memory directory across processes:
// every harness runs its own copy of this code. Claude Code does not take
// the lock; atomic renames and edits that check old_string against the
// file at write time cover it. The lock file lives outside the memory
// directory so Claude Code never sees it.
export function withLock<T>(memoryDir: string, fn: () => T): T {
  const name = createHash("sha256").update(memoryDir).digest("hex").slice(0, 16)
  const lock = join(tmpdir(), "cc-mem-locks", `${name}.lock`)
  mkdirSync(dirname(lock), { recursive: true })
  const deadline = Date.now() + lockTimeoutMs
  for (;;) {
    try {
      closeSync(openSync(lock, "wx"))
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
      const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
      if (age > staleLockMs) {
        rmSync(lock, { force: true })
        continue
      }
      if (Date.now() > deadline) throw new Error("another agent is writing to this memory directory; try again")
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
  try {
    return fn()
  } finally {
    rmSync(lock, { force: true })
  }
}
