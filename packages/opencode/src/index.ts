// Puts Claude Code's memory index for the plugin's directory into every
// agent-loop request, and registers direct tools to list another
// directory's notes and to write and edit this directory's. OpenCode loads
// one plugin instance per directory, so its location is the sessions'
// working directory. The index is read again for each request, so notes
// saved during the session show up.
import { isAbsolute } from "node:path"
import { Plugin } from "@opencode/plugin"
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

const source = "opencode"

export default Plugin.define({
  id: "cc-mem",
  async setup(ctx) {
    const env = systemEnv()
    const directory = ctx.location.directory
    const write = { env, project: directory, source }

    await ctx.session.hook("context", (event) => {
      let text: string
      try {
        text = memoryText(env, directory, { writable: true })
      } catch {
        return
      }
      event.system.push({ type: "text", text: `<memory>\n${text}</memory>` })
    })

    const fileName = { type: "string", description: fileNameDescription }
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "memory_list",
        description: listDescription,
        input: {
          type: "object",
          properties: { project: { type: "string", description: "Absolute path of the project directory" } },
          required: ["project"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input) => {
          const { project } = input as { project: string }
          if (!isAbsolute(project)) throw new Error(`project must be an absolute path, got ${JSON.stringify(project)}`)
          return { content: memoryText(env, project) }
        },
      })
      editor.add({
        name: "memory_write",
        description: writeDescription,
        input: {
          type: "object",
          properties: {
            file_name: fileName,
            content: { type: "string", description: "The whole file: frontmatter, then the fact" },
          },
          required: ["file_name", "content"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input) => {
          const { file_name, content } = input as { file_name: string; content: string }
          return { content: writeMemory(write, file_name, content).message }
        },
      })
      editor.add({
        name: "memory_edit",
        description: editDescription,
        input: {
          type: "object",
          properties: {
            file_name: fileName,
            old_string: { type: "string", description: "Exact text to replace" },
            new_string: { type: "string", description: "Replacement text" },
            replace_all: { type: "boolean", description: "Replace every match" },
            new_file_name: { type: "string", description: "New file name, to rename the file" },
          },
          required: ["file_name"],
          additionalProperties: false,
        },
        options: { codemode: false },
        execute: async (input) => {
          const { file_name, old_string, new_string, replace_all, new_file_name } = input as {
            file_name: string
            old_string?: string
            new_string?: string
            replace_all?: boolean
            new_file_name?: string
          }
          const edit = { oldString: old_string, newString: new_string, replaceAll: replace_all, newFileName: new_file_name }
          return { content: editMemory(write, file_name, edit).message }
        },
      })
    })
  },
})
