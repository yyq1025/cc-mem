import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import { resolveLocation } from "../src/paths.js"
import { framing, memoryText } from "../src/text.js"
import { mkdir, tempDir, testEnv, writeFile } from "./helpers.js"

function setup(index: string) {
  const env = testEnv()
  const project = join(env.home, "project")
  mkdir(project)
  const loc = resolveLocation(env, project)
  if (index !== "") writeFile(loc.entrypoint, index)
  return { env, project, loc }
}

test("memoryText gives the location, the framing and the current index", () => {
  const { env, project, loc } = setup("- [Old](old.md) — old\n")
  expect(memoryText(env, project)).toBe(
    `These notes are for ${project}; the files are in ${loc.dir}.\n\n${framing}\n\nMEMORY.md:\n\n- [Old](old.md) — old\n`,
  )
  writeFileSync(loc.entrypoint, "- [New](new.md) — new\n")
  expect(memoryText(env, project)).toContain("new.md")
})

test("memoryText says when there are no notes", () => {
  const { env, project } = setup("")
  expect(memoryText(env, project)).toContain("No notes have been saved for this project yet.")
})

test("memoryText notes an index over Claude Code's limits and returns all of it", () => {
  const { env, project } = setup("- [x](x.md) — x\n".repeat(250))
  const text = memoryText(env, project)
  expect(text).toContain("loads only its first 200 lines")
  expect(text.split("(x.md)").length - 1).toBe(250)
})

test("memoryText rejects a project that is not a directory", () => {
  const { env } = setup("")
  expect(() => memoryText(env, join(env.home, "missing"))).toThrow()
})
