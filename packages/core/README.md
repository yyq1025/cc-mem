# @cc-mem/core

The core of cc-mem: one memory for all your coding agents, kept in the auto memory Claude Code already writes. The agent plugins build on it:

| Agent | Package |
|---|---|
| pi | [`@cc-mem/pi`](https://www.npmjs.com/package/@cc-mem/pi) |
| OpenCode | [`@cc-mem/opencode`](https://www.npmjs.com/package/@cc-mem/opencode) |
| DeepSeek Harness | [`@cc-mem/dsh`](https://www.npmjs.com/package/@cc-mem/dsh) |

Install one of those to use cc-mem in an agent. This package is for scripts and for writing a plugin for another agent.

## Command line

Print a project's memory index the way an agent sees it, for scripts or hooks:

```sh
npx @cc-mem/core index --project <dir>
```

## Library

- `resolveLocation(env, project)` resolves the memory directory as Claude Code does: the canonical git root, so worktrees share one memory; `autoMemoryDirectory` from user, local and managed settings; `CLAUDE_CONFIG_DIR`; the long-path hash. It also reports whether auto memory is turned off.
- `memoryText(env, project, { writable })` builds what the plugins put in the prompt: where the notes are, how to treat them, and `MEMORY.md` within Claude Code's limits of 200 lines and 25,000 characters.
- `writeMemory` and `editMemory` back the `memory_write` and `memory_edit` tools.
  - They check Claude Code's frontmatter format.
  - They never overwrite a file on create.
  - They copy the old version into `.cc-mem-trash` beside the memory directory before every edit.
  - They record which agent wrote or changed a file.
- `listDescription`, `writeDescription`, `editDescription` and `fileNameDescription` are the tool descriptions, shared so the tools read the same in every agent.

Use `systemEnv()` for the environment of the current process.

## License

MIT. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.
