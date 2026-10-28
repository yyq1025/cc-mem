import { readFileSync } from "node:fs"
import { expect, test } from "vitest"
import { djb2Hash } from "../src/hash.js"
import { sanitizePath } from "../src/paths.js"

// fixtures/hashes.json was generated with Claude Code's djb2Hash and
// sanitizePath regex under Node.
const cases = JSON.parse(readFileSync(new URL("fixtures/hashes.json", import.meta.url), "utf8")) as {
  input: string
  djb2Hash: string
  sanitized: string
}[]

test.each(cases)("djb2Hash and sanitize of a $input.length-character input", (c) => {
  expect(djb2Hash(c.input)).toBe(c.djb2Hash)
  if (c.sanitized.length <= 200) expect(sanitizePath(c.input)).toBe(c.sanitized)
})

test("sanitizePath cuts long names and adds the hash", () => {
  // Claude Code 2.1.311 was checked to produce the same kind of name on a
  // real long path; this expected value comes from its code under Node.
  const root =
    "/home/user/projects/long-path-记忆/very-long-directory-segment-01/very-long-directory-segment-02/very-long-directory-segment-03/very-long-directory-segment-04/very-long-directory-segment-05/very-long-directory-segment-06/very-long-directory-segment-07/final"
  expect(sanitizePath(root)).toBe(
    "-home-user-projects-long-path----very-long-directory-segment-01-very-long-directory-segment-02-very-long-directory-segment-03-very-long-directory-segment-04-very-long-directory-segment-05-very-long-di-qe7y0f",
  )
  expect(sanitizePath("/Users/u/my.project")).toBe("-Users-u-my-project")
  // A character outside the BMP is two UTF-16 code units, so two dashes.
  expect(sanitizePath("/a/😀")).toBe("-a---")
})
