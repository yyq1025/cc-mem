import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach } from "vitest"
import type { Env } from "../src/paths.js"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// tempDir resolves symlinks (macOS /var → /private/var) so expected paths
// match what resolveLocation computes.
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-mem-")))
  dirs.push(dir)
  return dir
}

// testEnv returns an environment with an empty home and managed dir.
export function testEnv(): Env {
  return { vars: {}, home: tempDir(), managedDir: tempDir() }
}

export function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export function mkdir(path: string): void {
  mkdirSync(path, { recursive: true })
}
