#!/usr/bin/env node
// cc-mem index prints a project's memory index, for session-start
// hooks in harnesses without plugins.
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { systemEnv } from "./paths.js"
import { memoryText } from "./text.js"

const usage = `Usage:
  cc-mem index [--project <dir>]   print the memory index of a project

Options:
  --project <dir>   project directory (default: the working directory)
  --version         print the version
`

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: "string" },
      version: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  })
  if (values.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
    console.log(pkg.version)
    return
  }
  if (values.help || positionals[0] !== "index" || positionals.length > 1) {
    process.stdout.write(usage)
    process.exitCode = values.help ? 0 : 2
    return
  }
  process.stdout.write(memoryText(systemEnv(), values.project ?? process.cwd()))
}

try {
  main()
} catch (err) {
  console.error(`cc-mem: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
}
