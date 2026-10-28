// Puts Claude Code's memory index for each session's working directory into
// DeepSeek Harness's runtime context, and registers tools to list another
// directory's notes and to write and edit the session directory's. The
// context provider runs at each assembly, and Harness logs a new snapshot
// only when the text changes, so notes saved during the session show up.
//
// A Harness Host serves every Workspace from one process, so the directory
// comes from each session (ctx.workingDirectory), never from the process.
import { isAbsolute } from "node:path"
import type { Context } from "@deepseek-ai/cordis"
import type {} from "@deepseek-ai/dsh-agent"
import type {} from "@deepseek-ai/dsh-system-prompt"
import { defineTool } from "@deepseek-ai/dsh-tools"
import type {} from "@deepseek-ai/dsh-working-directory"
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

export const name = "cc-mem"
export const inject = ["systemPrompt", "tools", "workingDirectory"]

const source = "dsh"
// Right after the working directory (100) and the sandbox and approval
// policies (110, 115), before delegation (120).
const contextOrder = 117

const text = { schema: { type: "string" } as const, render: (_args: unknown, value: string) => [{ type: "text" as const, text: value }] }

export function apply(ctx: Context) {
  const env = systemEnv()

  ctx.systemPrompt.context({
    name: "cc-mem:index",
    order: contextOrder,
    interpolate: false,
    text: (context) => {
      if (context.agent === undefined) return ""
      try {
        return `<memory>\n${memoryText(env, ctx.workingDirectory.get(context.agent.session), { writable: true })}</memory>`
      } catch {
        return ""
      }
    },
  })

  const sessionDirectory = (exec: { agent?: { session: Parameters<typeof ctx.workingDirectory.get>[0] } }) => {
    if (exec.agent === undefined) throw new Error("The memory tools need a session working directory.")
    return ctx.workingDirectory.get(exec.agent.session)
  }

  ctx.tools.register(
    defineTool({
      name: "memory_list",
      description: listDescription,
      parameters: {
        project: { type: "string", required: true, description: "Absolute path of the project directory" },
      },
      output: text,
      async execute(args) {
        if (!isAbsolute(args.project)) throw new Error(`project must be an absolute path, got ${JSON.stringify(args.project)}`)
        return memoryText(env, args.project)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "memory_write",
      description: writeDescription,
      parameters: {
        file_name: { type: "string", required: true, description: fileNameDescription },
        content: { type: "string", required: true, description: "The whole file: frontmatter, then the fact" },
      },
      output: text,
      async execute(args, exec) {
        return writeMemory({ env, project: sessionDirectory(exec), source }, args.file_name, args.content).message
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: "memory_edit",
      description: editDescription,
      parameters: {
        file_name: { type: "string", required: true, description: fileNameDescription },
        old_string: { type: "string", description: "Exact text to replace" },
        new_string: { type: "string", description: "Replacement text" },
        replace_all: { type: "boolean", description: "Replace every match" },
        new_file_name: { type: "string", description: "New file name, to rename the file" },
      },
      output: text,
      async execute(args, exec) {
        return editMemory({ env, project: sessionDirectory(exec), source }, args.file_name, {
          oldString: args.old_string,
          newString: args.new_string,
          replaceAll: args.replace_all,
          newFileName: args.new_file_name,
        }).message
      },
    }),
  )
}
