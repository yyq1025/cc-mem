import { readFileSync } from "node:fs"

// Claude Code's limits on the MEMORY.md it loads.
// The size limit counts UTF-16 code units, JavaScript's string length.
const maxIndexLines = 200
const maxIndexUnits = 25_000

// Index is MEMORY.md as stored, with what Claude Code loads of it.
export interface Index {
  content: string // trimmed file content; empty when there is no index
  lines: number
  units: number
  truncated: boolean
  shownLines: number // complete lines Claude Code loads
}

const emptyIndex: Index = { content: "", lines: 0, units: 0, truncated: false, shownLines: 0 }

// readIndex reads the MEMORY.md at path. A missing file is an empty index.
export function readIndex(path: string): Index {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyIndex
    throw err
  }
  return parseIndex(raw)
}

// parseIndex mirrors truncateEntrypointContent: keep the first 200 lines,
// then cut at the last newline within 25,000 code units.
export function parseIndex(raw: string): Index {
  const content = raw.trim()
  if (content === "") return emptyIndex
  const contentLines = content.split("\n")
  const index = { content, lines: contentLines.length, units: content.length, truncated: false }
  if (index.lines <= maxIndexLines && index.units <= maxIndexUnits) {
    return { ...index, shownLines: index.lines }
  }
  const kept = contentLines.slice(0, maxIndexLines).join("\n")
  if (kept.length <= maxIndexUnits) {
    return { ...index, truncated: true, shownLines: Math.min(index.lines, maxIndexLines) }
  }
  const cutAt = kept.lastIndexOf("\n", maxIndexUnits)
  return { ...index, truncated: true, shownLines: cutAt > 0 ? kept.slice(0, cutAt).split("\n").length : 0 }
}
