import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { expect, test } from "vitest"
import { parseMemory } from "../src/frontmatter.js"
import { resolveLocation } from "../src/paths.js"
import { editMemory, MemoryError, writeMemory, type WriteContext } from "../src/write.js"
import { mkdir, testEnv, writeFile } from "./helpers.js"

function setup(index = "- [Old note](old.md) — kept as written\n") {
  const env = testEnv()
  const project = join(env.home, "project")
  mkdir(project)
  const loc = resolveLocation(env, project)
  if (index !== "") writeFile(loc.entrypoint, index)
  const ctx: WriteContext = { env, project, source: "opencode", now: () => new Date("2026-10-27T12:00:00Z") }
  return { env, project, loc, ctx }
}

const memory = (name: string, description: string, type: string, body = "The fact.") =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`

const read = (path: string) => readFileSync(path, "utf8")

test("memory_write creates the file, stamps it and leaves MEMORY.md to the agent", () => {
  const { loc, ctx } = setup()
  const result = writeMemory(ctx, "user_role.md", memory("user-role", "The user is a data scientist", "user"))

  const saved = read(join(loc.dir, "user_role.md"))
  expect(saved).toContain("source: opencode")
  expect(saved).toContain("modified: 2026-10-27T12:00:00.000Z")
  expect(parseMemory(saved)).toMatchObject({ name: "user-role", type: "user", strict: true })
  expect(saved.endsWith("---\n\nThe fact.\n")).toBe(true)
  expect(read(loc.entrypoint)).toBe("- [Old note](old.md) — kept as written\n")
  expect(result.message).toBe("Saved user_role.md. Add its line to MEMORY.md, such as: - [Title](user_role.md) — The user is a data scientist")
})

test("memory_write creates MEMORY.md only when there is none, without frontmatter", () => {
  const { loc, ctx } = setup("")
  expect(() => writeMemory(ctx, "MEMORY.md", memory("a", "A", "user"))).toThrow(/no frontmatter/)
  writeMemory(ctx, "MEMORY.md", "- [A](a.md) — A\n")
  expect(read(loc.entrypoint)).toBe("- [A](a.md) — A\n")
  expect(() => writeMemory(ctx, "MEMORY.md", "- x\n")).toThrow(/already exists/)
})

test("memory_write never overwrites", () => {
  const { ctx } = setup()
  writeMemory(ctx, "a.md", memory("a", "A", "project"))
  expect(() => writeMemory(ctx, "a.md", memory("a", "B", "project"))).toThrow(/already exists/)
})

test.each([
  ["memory.md", /The index is MEMORY\.md/],
  ["sub/a.md", /file name ending in \.md/],
  ["../a.md", /file name ending in \.md/],
  [".hidden.md", /file name ending in \.md/],
  ["a.txt", /file name ending in \.md/],
])("memory_write refuses the file name %s", (name, error) => {
  const { ctx } = setup()
  expect(() => writeMemory(ctx, name, memory("a", "A", "project"))).toThrow(error)
})

test.each([
  ["no frontmatter", "Just text\n", /start with YAML frontmatter/],
  ["no description", "---\nname: a\nmetadata:\n  type: user\n---\nx\n", /needs name, description/],
  ["unknown type", memory("a", "A", "opinion"), /needs name, description/],
  ["invalid YAML", "---\nname: a\ndescription: uses: colons\nmetadata:\n  type: user\n---\nx\n", /not valid YAML/],
  ["frontmatter past line 30", `---\nname: a\ndescription: A\nmetadata:\n  type: user\n${Array.from({ length: 30 }, (_, i) => `k${i}: 1\n`).join("")}---\nx\n`, /first 30 lines/],
  ["over 40 KB", memory("a", "A", "user", "x".repeat(41 * 1024)), /at most 40 KB/],
])("memory_write refuses %s and leaves no file", (_name, content, error) => {
  const { loc, ctx } = setup()
  expect(() => writeMemory(ctx, "a.md", content)).toThrow(error)
  expect(existsSync(join(loc.dir, "a.md"))).toBe(false)
  expect(read(loc.entrypoint)).toBe("- [Old note](old.md) — kept as written\n")
})

test("memory_write accepts the top-level type older Claude Code versions wrote", () => {
  const { ctx } = setup()
  writeMemory(ctx, "a.md", "---\nname: a\ndescription: A\ntype: reference\n---\nx\n")
})

test("memory_write stops at 200 memory files", () => {
  const { loc, ctx } = setup()
  for (let i = 0; i < 200; i++) writeFile(join(loc.dir, `m${i}.md`), memory(`m${i}`, "x", "user"))
  expect(() => writeMemory(ctx, "a.md", memory("a", "A", "user"))).toThrow(/200 memory files/)
})

test("memory_write refuses when Claude Code's auto memory is off", () => {
  const { env, ctx } = setup()
  env.vars["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] = "1"
  expect(() => writeMemory(ctx, "a.md", memory("a", "A", "user"))).toThrow(/turned off/)
})

test("results flag what Claude Code would: recall limits and long descriptions", () => {
  const { ctx } = setup()
  const long = writeMemory(ctx, "a.md", memory("a", "A", "user", "x".repeat(5000)))
  expect(long.message).toContain("shows other sessions only the first 4096 bytes")
  const wordy = writeMemory(ctx, "b.md", memory("b", "d".repeat(301), "user"))
  expect(wordy.message).toContain("The description is 301 characters")
})

test("memory_edit edits MEMORY.md with a backup and flags missing files and the index limits", () => {
  const { loc, ctx } = setup("- x\n".repeat(199) + "- last\n")
  const result = editMemory(ctx, "MEMORY.md", { oldString: "- last\n", newString: "- last\n- [Gone](gone.md) — g\n" })
  expect(result.message).toContain("loads only its first 200 lines")
  expect(result.message).toContain("links files that do not exist: gone.md")
  expect(read(loc.entrypoint).split("\n").length).toBe(202)
  expect(readdirSync(join(dirname(loc.dir), ".cc-mem-trash"))[0]).toMatch(/MEMORY\.md$/)
  expect(() => editMemory(ctx, "MEMORY.md", { newFileName: "INDEX.md" })).toThrow(/keeps its name/)
})

test("memory_edit replaces once, backs up the old version and keeps the index line", () => {
  const { env, loc, ctx } = setup()
  writeMemory(ctx, "a.md", memory("a", "Where the user lives", "user", "Lives in Oregon."))
  const indexBefore = read(loc.entrypoint)
  const result = editMemory({ ...ctx, source: "pi" }, "a.md", { oldString: "Oregon", newString: "Vermont" })

  const saved = read(join(loc.dir, "a.md"))
  expect(saved).toContain("Lives in Vermont.")
  expect(saved).toContain("source: opencode")
  expect(saved).toContain("modifiedBy: pi")
  expect(result.message).toBe("Edited a.md.")
  expect(read(loc.entrypoint)).toBe(indexBefore)
  const trash = join(dirname(loc.dir), ".cc-mem-trash")
  const backups = readdirSync(trash)
  expect(backups).toHaveLength(1)
  expect(read(join(trash, backups[0]!))).toContain("Lives in Oregon.")
})

test("memory_edit points out an index line whose description changed", () => {
  const { loc, ctx } = setup("- [a](a.md) — Old description\n")
  writeMemory(ctx, "a.md", memory("a", "Old description", "user"))
  const result = editMemory(ctx, "a.md", { oldString: "Old description", newString: "New description" })
  expect(result.message).toBe("Edited a.md. Its line in MEMORY.md may need the new description.")
  expect(read(loc.entrypoint)).toBe("- [a](a.md) — Old description\n")
})

test("memory_edit returns the current content when old_string is not found", () => {
  const { ctx } = setup()
  writeMemory(ctx, "a.md", memory("a", "A", "user", "Lives in Oregon."))
  let error: unknown
  try {
    editMemory(ctx, "a.md", { oldString: "Lives in Ohio.", newString: "Lives in Vermont." })
  } catch (err) {
    error = err
  }
  expect(error).toBeInstanceOf(MemoryError)
  expect((error as Error).message).toContain("Lives in Oregon.")
})

test("memory_edit needs a unique match unless replace_all", () => {
  const { loc, ctx } = setup()
  writeMemory(ctx, "a.md", memory("a", "A", "user", "x and x"))
  expect(() => editMemory(ctx, "a.md", { oldString: "x and", newString: "y and" })).not.toThrow()
  writeMemory(ctx, "b.md", memory("b", "B", "user", "x and x"))
  expect(() => editMemory(ctx, "b.md", { oldString: "x", newString: "y" })).toThrow(/matches 2 times/)
  editMemory(ctx, "b.md", { oldString: "x", newString: "y", replaceAll: true })
  expect(read(join(loc.dir, "b.md"))).toContain("y and y")
})

test("feedback memories are written and edited like the other types", () => {
  const { loc, ctx } = setup()
  writeMemory(ctx, "f.md", memory("f", "F", "feedback", "Use bun."))
  expect(read(join(loc.dir, "f.md"))).toContain("source: opencode")
  editMemory(ctx, "f.md", { oldString: "Use bun.", newString: "Use bun 1.4." })
  expect(read(join(loc.dir, "f.md"))).toContain("Use bun 1.4.")
  writeMemory(ctx, "a.md", memory("a", "A", "user"))
  editMemory(ctx, "a.md", { oldString: "type: user", newString: "type: feedback" })
  expect(read(join(loc.dir, "a.md"))).toContain("type: feedback")
})

test("memory_edit works on a file Claude Code wrote with loose YAML", () => {
  const { loc, ctx } = setup()
  // An unquoted ": " in a value only parses with Claude Code's fallback.
  const loose = "---\nname: notes\ndescription: Build: use bun\nmetadata:\n  type: project\n---\n\nUse bun.\n"
  writeFileSync(join(loc.dir, "notes.md"), loose)
  editMemory(ctx, "notes.md", { oldString: "Use bun.", newString: "Use bun 1.4." })
  expect(read(join(loc.dir, "notes.md"))).toBe(loose.replace("Use bun.", "Use bun 1.4."))
})

test("memory_edit needs an existing file", () => {
  const { ctx } = setup()
  expect(() => editMemory(ctx, "missing.md", { oldString: "a", newString: "b" })).toThrow(/does not exist/)
})

test("memory_edit renames a file and says MEMORY.md still links the old name", () => {
  const { loc, ctx } = setup("- [Where I live](user_location_oregon.md) — a title the user wrote\n")
  writeFile(join(loc.dir, "user_location_oregon.md"), memory("user-location", "Where the user lives", "user", "Lives in Oregon."))
  const result = editMemory(ctx, "user_location_oregon.md", {
    oldString: "Lives in Oregon.",
    newString: "Lives in Vermont.",
    newFileName: "user_location.md",
  })
  expect(result.message).toBe(
    "Renamed user_location_oregon.md to user_location.md and edited it. MEMORY.md still links user_location_oregon.md: point that line at user_location.md and update its title and hook if they changed.",
  )
  expect(existsSync(join(loc.dir, "user_location_oregon.md"))).toBe(false)
  expect(read(join(loc.dir, "user_location.md"))).toContain("Lives in Vermont.")
  expect(read(loc.entrypoint)).toBe("- [Where I live](user_location_oregon.md) — a title the user wrote\n")
  const trash = join(dirname(loc.dir), ".cc-mem-trash")
  expect(readdirSync(trash)[0]).toMatch(/user_location_oregon\.md$/)
})

test("memory_edit renames without editing, and never onto an existing file", () => {
  const { ctx } = setup("")
  writeMemory(ctx, "a.md", memory("a", "A", "user"))
  writeMemory(ctx, "b.md", memory("b", "B", "user"))
  expect(() => editMemory(ctx, "a.md", { newFileName: "b.md" })).toThrow(/already exists/)
  expect(editMemory(ctx, "a.md", { newFileName: "c.md" }).message).toBe("Renamed a.md to c.md.")
  expect(() => editMemory(ctx, "c.md", { newFileName: "MEMORY.md" })).toThrow(/keeps its name/)
  expect(() => editMemory(ctx, "c.md", {})).toThrow(/Give old_string/)
})
