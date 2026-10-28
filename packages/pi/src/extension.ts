// Puts Claude Code's memory index for the working directory into pi's
// system prompt before every run, and registers tools to list another
// directory's notes and to write and edit the working directory's. The index
// is read again each run, so notes saved during the session show up.
import { isAbsolute } from "node:path"
import { Type } from "@earendil-works/pi-ai"
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
  editDescription,
  editMemory,
  fileNameDescription,
  listDescription,
  memoryText,
  systemEnv,
  writeDescription,
  writeMemory,
} from "@cc-mem/core"

const section = "memory"
const source = "pi"

export default function ccMem(pi: ExtensionAPI) {
  const env = systemEnv()
  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined })

  pi.on("before_agent_start", (event, ctx) => {
    try {
      event.systemPromptOptions.sections[section] = memoryText(env, ctx.cwd, { writable: true })
    } catch {
      delete event.systemPromptOptions.sections[section]
    }
  })

  pi.registerTool(
    defineTool({
      name: "memory_list",
      label: "Memory",
      description: listDescription,
      promptSnippet: "Notes from earlier sessions for another project directory",
      parameters: Type.Object({
        project: Type.String({ description: "Absolute path of the project directory" }),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      async execute(_toolCallId, params) {
        if (!isAbsolute(params.project)) {
          throw new Error(`project must be an absolute path, got ${JSON.stringify(params.project)}`)
        }
        return text(memoryText(env, params.project))
      },
    }),
  )

  pi.registerTool(
    defineTool({
      name: "memory_write",
      label: "Save memory",
      description: writeDescription,
      promptSnippet: "Save a new memory for later sessions",
      parameters: Type.Object({
        file_name: Type.String({ description: fileNameDescription }),
        content: Type.String({ description: "The whole file: frontmatter, then the fact" }),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        return text(writeMemory({ env, project: ctx.cwd, source }, params.file_name, params.content).message)
      },
    }),
  )

  pi.registerTool(
    defineTool({
      name: "memory_edit",
      label: "Edit memory",
      description: editDescription,
      promptSnippet: "Change a saved memory",
      parameters: Type.Object({
        file_name: Type.String({ description: fileNameDescription }),
        old_string: Type.Optional(Type.String({ description: "Exact text to replace" })),
        new_string: Type.Optional(Type.String({ description: "Replacement text" })),
        replace_all: Type.Optional(Type.Boolean({ description: "Replace every match" })),
        new_file_name: Type.Optional(Type.String({ description: "New file name, to rename the file" })),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const result = editMemory({ env, project: ctx.cwd, source }, params.file_name, {
          oldString: params.old_string,
          newString: params.new_string,
          replaceAll: params.replace_all,
          newFileName: params.new_file_name,
        })
        return text(result.message)
      },
    }),
  )
}
