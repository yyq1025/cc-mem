import { isMap, parse, parseDocument } from "yaml"

// Claude Code reads a memory file's frontmatter from its first 30 lines and
// knows these types.
export const frontmatterMaxLines = 30
export const memoryTypes = ["user", "feedback", "project", "reference"] as const
export type MemoryType = (typeof memoryTypes)[number]

const frontmatterPattern = /^---\s*\n([\s\S]*?)---\s*\n?/
const yamlSpecialChars = /[{}[\]*&#!|>%@`]|: /

export interface Memory {
  name?: string
  description?: string
  type?: MemoryType
  strict: boolean // whether the frontmatter is valid YAML without the fallback
  frontmatterLines: number // lines up to and including the closing ---
}

// parseMemory reads a memory file's frontmatter as Claude Code does: YAML,
// and when that fails, again after quoting values with YAML special
// characters. The type is metadata.type as
// Claude Code 2.1.312 writes it, or the top-level type older versions used.
export function parseMemory(raw: string): Memory | undefined {
  const match = frontmatterPattern.exec(raw)
  if (!match) return undefined
  const text = match[1] ?? ""
  let data: unknown
  let strict = true
  try {
    data = parse(text)
  } catch {
    strict = false
    try {
      data = parse(quoteProblematicValues(text))
    } catch {
      return undefined
    }
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined
  const fields = data as Record<string, unknown>
  const metadata = typeof fields["metadata"] === "object" && fields["metadata"] !== null ? (fields["metadata"] as Record<string, unknown>) : {}
  const type = [metadata["type"], fields["type"]].find((t): t is MemoryType => memoryTypes.includes(t as MemoryType))
  return {
    ...(typeof fields["name"] === "string" ? { name: fields["name"] } : {}),
    ...(typeof fields["description"] === "string" ? { description: fields["description"] } : {}),
    ...(type ? { type } : {}),
    strict,
    frontmatterLines: match[0].replace(/\n$/, "").split("\n").length,
  }
}

function quoteProblematicValues(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const match = /^([a-zA-Z_-]+):\s+(.+)$/.exec(line)
      if (!match) return line
      const [, key, value] = match as unknown as [string, string, string]
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return line
      if (!yamlSpecialChars.test(value)) return line
      return `${key}: "${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    })
    .join("\n")
}

// setMetadata sets keys under metadata in a file whose frontmatter is valid
// YAML, keeping the rest of the frontmatter as written.
export function setMetadata(raw: string, values: Record<string, string>): string {
  // Unlike Claude Code's pattern, stop at the closing line so the body,
  // blank lines included, stays as written.
  const match = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(raw)
  if (!match || match.index !== 0) return raw
  const doc = parseDocument(match[1] ?? "")
  if (doc.errors.length > 0) return raw
  if (!isMap(doc.get("metadata"))) doc.set("metadata", doc.createNode({}))
  for (const [key, value] of Object.entries(values)) doc.setIn(["metadata", key], value)
  return `---\n${doc.toString({ lineWidth: 0 })}---\n${raw.slice(match[0].length)}`
}
