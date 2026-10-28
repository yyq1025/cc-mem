import { join } from "node:path"
import { expect, test } from "vitest"
import { parseIndex, readIndex } from "../src/index-file.js"
import { tempDir } from "./helpers.js"

test("a missing MEMORY.md is an empty index", () => {
  expect(readIndex(join(tempDir(), "MEMORY.md")).content).toBe("")
})

const lines = (n: number, line: string) => Array(n).fill(line).join("\n")

test.each([
  ["empty", " \n\n", 0, false, 0],
  ["small", "\n- [A](a.md) — a\n- [B](b.md) — b\n\n", 2, false, 2],
  ["a byte-order mark", "﻿- [A](a.md) — a\n", 1, false, 1],
  ["200 lines", lines(200, "- x"), 200, false, 200],
  ["201 lines", lines(201, "- x"), 201, true, 200],
  // 100 lines of 300 units: each line ends at 301*i - 1, so lines ending
  // at or before 25,000 are kept.
  ["long lines", lines(100, "x".repeat(300)), 100, true, 83],
  // A CJK character is one UTF-16 unit but three UTF-8 bytes.
  ["cjk", lines(100, "记".repeat(240)), 100, false, 100],
  ["cjk over", lines(110, "记".repeat(240)), 110, true, 103],
  ["one long line", "x".repeat(30_000), 1, true, 0],
] as const)("parseIndex: %s", (_name, raw, lineCount, truncated, shown) => {
  expect(parseIndex(raw)).toMatchObject({ lines: lineCount, truncated, shownLines: shown })
})
