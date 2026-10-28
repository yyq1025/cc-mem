// Summarizes one result directory from run.sh: the tool calls, which of
// them changed memory files outside the memory tools, what changed in the
// memory directory, and a check of the answer where the scenario has one.
// It prints no memory content, so a session running it does not pick the
// scenario's facts up as its own.
//
//   node scripts/behavior/analyze.mjs <result directory>
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const out = process.argv[2]
const here = new URL(".", import.meta.url).pathname
const meta = JSON.parse(readFileSync(join(out, "meta.json"), "utf8"))
const events = readFileSync(join(out, "events.jsonl"), "utf8")
  .split("\n")
  .flatMap((line) => {
    try {
      return [JSON.parse(line)]
    } catch {
      return []
    }
  })

// Each agent logs tool calls and the final answer in its own shape.
const calls = []
let answer = ""
for (const e of events) {
  if (meta.agent === "pi" && e.type === "message_end") {
    for (const c of e.message?.content ?? []) {
      if (c.type === "toolCall") calls.push({ name: c.name, input: c.arguments ?? {} })
      if (c.type === "text" && e.message.role === "assistant") answer = c.text
    }
  }
  if (meta.agent === "opencode" && e.part?.type === "tool" && e.part.state?.status === "completed") {
    calls.push({ name: e.part.tool, input: e.part.state.input ?? {} })
  }
  if (meta.agent === "opencode" && e.part?.type === "text") answer = e.part.text ?? answer
  if (meta.agent === "dsh" && e.type === "tool_call") calls.push({ name: e.tool, input: e.input ?? {} })
  if (meta.agent === "dsh" && (e.type === "final" || e.type === "text")) answer = e.text ?? answer
}

const memoryDir = join(meta.root, "memory")
const fileTools = new Set(["write", "edit", "patch", "apply_patch"])
// A redirect into a file, not 2> or >&.
const writes = /\b(rm|mv|cp|tee|python3?|perl|sed -i)\b|(^|[^0-9&])>\s*[^&\s]/
const steps = calls.map(({ name, input }) => {
  if (name.startsWith("memory_")) return `${name}(${input.file_name ?? input.project ?? ""}${input.new_file_name ? " → " + input.new_file_name : ""})`
  const text = JSON.stringify(input)
  if (!text.includes(memoryDir)) return name
  const command = input.command ?? input.code ?? ""
  return fileTools.has(name) || writes.test(command) ? `${name}[writes memory]` : `${name}[reads memory]`
})

const seed = new Set(readdirSync(join(here, "seed")))
const now = readdirSync(join(out, "memory")).filter((f) => f.endsWith(".md"))
const index = existsSync(join(out, "memory", "MEMORY.md")) ? readFileSync(join(out, "memory", "MEMORY.md"), "utf8") : ""
const changed = now.filter((f) => seed.has(f) && readFileSync(join(out, "memory", f), "utf8") !== readFileSync(join(here, "seed", f), "utf8"))
const added = now.filter((f) => !seed.has(f))
const removed = [...seed].filter((f) => !now.includes(f))
const unindexed = now.filter((f) => f !== "MEMORY.md" && !index.includes(`](${f})`))
const dangling = [...index.matchAll(/\]\(([^)\s]+\.md)\)/g)].map((m) => m[1]).filter((f) => !now.includes(f))

// Scenarios with a known answer.
const checks = {
  R1: () => /俄勒冈|Oregon/i.test(answer),
  S4: () => answer.includes("Acme API"),
}
const check = checks[meta.scenario] ? (checks[meta.scenario]() ? " answer ok" : " answer WRONG") : ""

console.log(`${meta.agent} ${meta.scenario} (${meta.from}${meta.version ? " " + meta.version : ""}, exit ${meta.exit})${check}`)
console.log(`  tools: ${steps.join(" | ") || "none"}`)
console.log(`  memory: +${added.join(",") || "-"} -${removed.join(",") || "-"} ~${changed.join(",") || "-"} unindexed=${unindexed.join(",") || "none"} dangling=${dangling.join(",") || "none"}`)
