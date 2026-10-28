// Writes to Claude Code's memory directory under the rules in
// docs/design.md: format checks, provenance, and one named file at a time.
// MEMORY.md is the agent's to maintain, as it is for Claude Code's own
// model; results remind it where the index needs a change, the way Claude
// Code's checks after a memory write do.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { basename, join } from "node:path"
import { writeAtomic, withLock } from "./files.js"
import { frontmatterMaxLines, memoryTypes, parseMemory, setMetadata, type Memory } from "./frontmatter.js"
import { readIndex } from "./index-file.js"
import { load } from "./text.js"
import type { Env, Location } from "./paths.js"

const maxFileBytes = 40 * 1024
const maxIndexBytes = 1024 * 1024
const maxMemoryFiles = 200
const entrypointName = "MEMORY.md"
// Claude Code 2.1.312 shows other sessions only the first 4,096 bytes and
// 200 lines of a recalled memory file, and flags descriptions over 300
// characters.
const recallBytes = 4096
const recallLines = 200
const maxDescription = 300

// MemoryError carries a message for the model, which can act on it.
export class MemoryError extends Error {}

export interface WriteContext {
  env: Env
  project: string
  source: string // the agent writing, recorded in metadata.source
  now?: () => Date
}

export interface WriteResult {
  path: string
  message: string
}

// writeMemory creates a memory file, or MEMORY.md when there is none. It
// never overwrites an existing file.
export function writeMemory(ctx: WriteContext, fileName: string, content: string): WriteResult {
  const location = writableLocation(ctx)
  checkFileName(fileName)
  const path = join(location.dir, fileName)
  return withLock(location.dir, () => {
    if (existsSync(path)) throw new MemoryError(`${fileName} already exists. Read it and change it with memory_edit.`)
    if (isIndex(fileName)) {
      checkIndex(content)
      writeAtomic(path, content)
      return { path, message: `Saved ${fileName}.${indexNotes(location)}` }
    }
    if (countMemoryFiles(location.dir) >= maxMemoryFiles) {
      throw new MemoryError(`The memory directory already holds ${maxMemoryFiles} memory files, all Claude Code recalls. Ask the user to consolidate the memory in Claude Code before adding more.`)
    }
    const memory = checkContent(content, true)
    const stamp = (ctx.now ?? (() => new Date()))().toISOString()
    writeAtomic(path, setMetadata(content, { source: ctx.source, modified: stamp }))
    const pointer = `- [Title](${fileName}) — ${oneLine(memory.description)}`
    // The first note of a project: say so, or the agent tries memory_edit on
    // an index that does not exist.
    const next = existsSync(location.entrypoint)
      ? `Add its line to MEMORY.md, such as: ${pointer}`
      : `MEMORY.md does not exist yet: create it with memory_write, starting with its line, such as: ${pointer}`
    return { path, message: `Saved ${fileName}. ${next}${contentNotes(content, memory)}` }
  })
}

export interface Edit {
  oldString?: string
  newString?: string
  replaceAll?: boolean
  newFileName?: string // renames the file, as a patch's "Move to" does
}

// editMemory replaces old_string with new_string in a memory file or
// MEMORY.md, once unless replaceAll, and can rename a memory file. A failed
// match returns the file's current content so the agent can retry without
// another read.
export function editMemory(ctx: WriteContext, fileName: string, edit: Edit): WriteResult {
  const location = writableLocation(ctx)
  checkFileName(fileName)
  const { oldString, newString, replaceAll = false } = edit
  const newFileName = edit.newFileName === fileName ? undefined : edit.newFileName
  if (newFileName !== undefined) {
    checkFileName(newFileName)
    if (isIndex(fileName) || isIndex(newFileName)) throw new MemoryError("MEMORY.md keeps its name.")
  }
  if (oldString === undefined && newFileName === undefined) throw new MemoryError("Give old_string and new_string, new_file_name, or both.")
  if (oldString !== undefined) {
    if (oldString === "") throw new MemoryError("old_string is empty.")
    if (newString === undefined) throw new MemoryError("new_string is missing.")
    if (oldString === newString) throw new MemoryError("old_string and new_string are the same.")
  }
  const path = join(location.dir, fileName)
  const target = join(location.dir, newFileName ?? fileName)
  return withLock(location.dir, () => {
    if (!existsSync(path)) throw new MemoryError(`${fileName} does not exist. Create it with memory_write.`)
    if (newFileName !== undefined && existsSync(target)) throw new MemoryError(`${newFileName} already exists; pick another name.`)
    const current = readFileSync(path, "utf8")
    const before = isIndex(fileName) ? undefined : parseMemory(current)
    let edited = current
    if (oldString !== undefined && newString !== undefined) {
      const count = current.split(oldString).length - 1
      if (count === 0) throw new MemoryError(`old_string was not found in ${fileName}. Its current content:\n\n${current}`)
      if (count > 1 && !replaceAll) {
        throw new MemoryError(`old_string matches ${count} times in ${fileName}. Include more context to pick one, or set replace_all.`)
      }
      edited = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, () => newString)
    }

    if (isIndex(fileName)) {
      checkIndex(edited)
      writeAtomic(path, edited)
      return { path, message: `Edited ${fileName}.${indexNotes(location)}` }
    }

    // A file Claude Code wrote may only parse with its quoting fallback;
    // the edit keeps it as editable as it was.
    const after = checkContent(edited, before?.strict ?? true)
    const stamp = (ctx.now ?? (() => new Date()))().toISOString()
    writeAtomic(target, setMetadata(edited, { modifiedBy: ctx.source, modified: stamp }))
    if (target !== path) rmSync(path)
    let message = newFileName === undefined ? `Edited ${fileName}.` : `Renamed ${fileName} to ${newFileName}${edited === current ? "" : " and edited it"}.`
    const index = existsSync(location.entrypoint) ? readFileSync(location.entrypoint, "utf8") : ""
    if (newFileName !== undefined && index.includes(`](${fileName})`)) {
      message += ` MEMORY.md still links ${fileName}: point that line at ${newFileName} and update its title and hook if they changed.`
    } else if ((after.name !== before?.name || after.description !== before?.description) && index.includes(`](${fileName})`)) {
      message += ` Its line in MEMORY.md may need the new description.`
    }
    return { path: target, message: message + contentNotes(edited, after) }
  })
}

// deleteMemory removes one memory file. MEMORY.md cannot be deleted: it is
// the index Claude Code loads, and the agent edits it instead.
export function deleteMemory(ctx: WriteContext, fileName: string): WriteResult {
  const location = writableLocation(ctx)
  checkFileName(fileName)
  if (isIndex(fileName)) throw new MemoryError("MEMORY.md is the index and cannot be deleted; remove lines from it with memory_edit.")
  const path = join(location.dir, fileName)
  return withLock(location.dir, () => {
    if (!existsSync(path)) throw new MemoryError(`${fileName} does not exist.`)
    rmSync(path)
    const index = existsSync(location.entrypoint) ? readFileSync(location.entrypoint, "utf8") : ""
    const note = index.includes(`](${fileName})`) ? ` MEMORY.md still links ${fileName}: remove that line with memory_edit.` : ""
    return { path, message: `Deleted ${fileName}.${note}` }
  })
}

function writableLocation(ctx: WriteContext): Location {
  const { location } = load(ctx.env, ctx.project)
  if (!location.enabled) {
    throw new MemoryError(`Claude Code's auto memory is turned off here (${location.disabledBy}), so it would not read a new memory. Not saved.`)
  }
  return location
}

const isIndex = (fileName: string) => fileName.toLowerCase() === entrypointName.toLowerCase()

function checkFileName(fileName: string): void {
  if (!/^[^/\\]+\.md$/.test(fileName) || fileName.startsWith(".")) {
    throw new MemoryError(`file_name must be a file name ending in .md at the top of the memory directory, like user_role.md; got ${JSON.stringify(fileName)}.`)
  }
  if (isIndex(fileName) && fileName !== entrypointName) throw new MemoryError(`The index is ${entrypointName}.`)
}

// checkContent applies the format rules to a memory file as it would be
// after the write.
function checkContent(content: string, strict: boolean): Required<Pick<Memory, "name" | "description" | "type">> {
  if (Buffer.byteLength(content) > maxFileBytes) throw new MemoryError(`A memory file may be at most ${maxFileBytes / 1024} KB.`)
  const memory = parseMemory(content)
  if (!memory) throw new MemoryError(`The file must start with YAML frontmatter between --- lines.\n\n${template}`)
  if (strict && !memory.strict) throw new MemoryError(`The frontmatter is not valid YAML; quote values that contain ": " or #.\n\n${template}`)
  if (memory.frontmatterLines > frontmatterMaxLines) {
    throw new MemoryError(`The frontmatter must close within the first ${frontmatterMaxLines} lines, the part Claude Code reads.`)
  }
  if (!memory.name || !memory.description || !memory.type) {
    throw new MemoryError(`The frontmatter needs name, description and metadata.type (one of ${memoryTypes.join(", ")}).\n\n${template}`)
  }
  return { name: memory.name, description: memory.description, type: memory.type }
}

function checkIndex(content: string): void {
  if (Buffer.byteLength(content) > maxIndexBytes) throw new MemoryError(`MEMORY.md may be at most ${maxIndexBytes / 1024 / 1024} MB.`)
  if (/^---\s*\n/.test(content)) throw new MemoryError("MEMORY.md is the index: one line per memory, no frontmatter.")
}

const template = `Template:
---
name: short-kebab-case-name
description: one line saying what this memory holds, used to decide when to read it
metadata:
  type: user | feedback | project | reference
---

The fact itself.`

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ")

function countMemoryFiles(dir: string): number {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".md") && basename(f) !== entrypointName).length
  } catch {
    return 0
  }
}

// contentNotes mirrors the checks Claude Code runs after a memory write:
// what recall will not show, and a description too long to match on.
function contentNotes(content: string, memory: { description: string }): string {
  let notes = ""
  const bytes = Buffer.byteLength(content)
  const lines = content.split("\n").length
  if (bytes > recallBytes || lines > recallLines) {
    notes += ` The file is ${bytes} bytes and ${lines} lines; Claude Code shows other sessions only the first ${recallBytes} bytes and ${recallLines} lines of a memory file, so the rest is invisible unless they open it. Keep one fact per file: summarize, or split distinct facts into their own files.`
  }
  if (memory.description.length > maxDescription) {
    notes += ` The description is ${memory.description.length} characters; recall matches on it as a one-line summary, so shorten it to one specific line (about ${maxDescription / 2} characters).`
  }
  return notes
}

// indexNotes reports what Claude Code will not load of MEMORY.md and links
// to files that do not exist.
function indexNotes(location: Location): string {
  let notes = ""
  const index = readIndex(location.entrypoint)
  if (index.truncated) {
    notes += ` MEMORY.md is over Claude Code's limits (${index.lines} lines, ${index.units} characters), so Claude Code loads only its first ${index.shownLines} lines; keep one short line per memory, or suggest the user ask Claude Code to consolidate its memory.`
  }
  const missing = [...index.content.matchAll(/\]\(([^)\s]+\.md)\)/g)]
    .map((m) => m[1]!)
    .filter((f) => !f.includes("/") && !existsSync(join(location.dir, f)))
  if (missing.length > 0) notes += ` MEMORY.md links files that do not exist: ${[...new Set(missing)].join(", ")}.`
  return notes
}
