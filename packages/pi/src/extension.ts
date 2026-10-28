// Puts Claude Code's memory index for the working directory into pi's
// system prompt, and registers tools to list another directory's notes and
// to write, edit and delete the working directory's. Like Claude Code, the
// session keeps the index it started with until a compaction, so writes
// during the session do not add prompt changes to the transcript; the tool
// results tell the agent what it changed. pi loads the extension again for
// each session, so the snapshot belongs to one session.
import { isAbsolute } from "node:path"
import { Type } from "@earendil-works/pi-ai"
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
  deleteDescription,
  deleteMemory,
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

  // undefined until the first run reads it; null when it could not be read.
  let index: string | null | undefined
  pi.on("session_compact", () => {
    index = undefined
  })
  pi.on("before_agent_start", (event, ctx) => {
    if (index === undefined) {
      try {
        index = memoryText(env, ctx.cwd, { writable: true })
      } catch {
        index = null
      }
    }
    if (index === null) delete event.systemPromptOptions.sections[section]
    else event.systemPromptOptions.sections[section] = index
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

  pi.registerTool(
    defineTool({
      name: "memory_delete",
      label: "Delete memory",
      description: deleteDescription,
      promptSnippet: "Delete a saved memory",
      parameters: Type.Object({
        file_name: Type.String({ description: fileNameDescription }),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        return text(deleteMemory({ env, project: ctx.cwd, source }, params.file_name).message)
      },
    }),
  )
}
