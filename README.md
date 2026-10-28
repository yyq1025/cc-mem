# cc-mem

One memory for all your coding agents. Plugins for pi, OpenCode and DeepSeek Harness read and write the auto memory Claude Code already keeps, so every agent you use on a project works from the same notes.

Claude Code saves what it learns about you and your project to `~/.claude/projects/<project>/memory`. Other agents start every session blank, and memory tools built for them keep a store of their own that you then have to fill, sync or migrate. cc-mem skips that: the other agents use Claude Code's memory directly, and what one of them saves, Claude Code recalls in its next session, and the other way round.

## What it does

- **The same memory, read the way Claude Code reads it.** The directory is resolved as Claude Code resolves it: the canonical git root, so worktrees share one memory; `autoMemoryDirectory`; `CLAUDE_CONFIG_DIR`; the long-path hash. `MEMORY.md` is loaded within Claude Code's limits of 200 lines and 25,000 characters. Notes are written in Claude Code's own format.
- **Loaded when the session starts.** The index goes into the system prompt, framed as background notes from earlier sessions, so the agent sees it without having to think of calling a tool. As in Claude Code, a session keeps the index it started with until its context is compacted, which keeps the prompt cache intact; notes other agents save meanwhile arrive after the next compaction or in the next session.
- **Careful writes.**
  - `memory_write` creates a file and never overwrites one.
  - `memory_edit` makes one exact replacement and can rename a file.
  - `memory_delete` removes one named memory file at a time and never `MEMORY.md`, so a mistaken delete cannot take the index or the whole directory with it.
  - Each file records which agent wrote or last changed it (`metadata.source`, `modifiedBy`) and when.
  - No backups, as in Claude Code: a project's memory is small, and what is lost can be asked again or read back from the code.
- **Small.** About 1,100 tokens of fixed instructions and tool descriptions per request, plus your index, which Claude Code loads too. No extra model calls, database or background process.

## Install

| Agent | Command |
|---|---|
| [pi](https://pi.dev) | `pi install npm:@cc-mem/pi` |
| [OpenCode](https://opencode.ai) 2.2+ | `opencode plugin add @cc-mem/opencode` |
| [DeepSeek Harness](https://www.deepseek.com/harness/) 0.2.1+ | `dsh plugin --profile <profile> add @cc-mem/dsh` (the desktop app's profile is `desktop`) |

Start a new session afterwards. Claude Code needs nothing: it already reads and writes the same directory.

## Tools

| Tool | What it does |
|---|---|
| `memory_list(project)` | Returns the notes for another project directory; the working directory's are already in the prompt |
| `memory_write(file_name, content)` | Creates a memory file, or `MEMORY.md` when there is none |
| `memory_edit(file_name, old_string?, new_string?, replace_all?, new_file_name?)` | Replaces text exactly in a memory file or `MEMORY.md`, renames a memory file, or both |
| `memory_delete(file_name)` | Deletes one memory file; `MEMORY.md` cannot be deleted |

Agents read memory files with their own file tools. They maintain `MEMORY.md` themselves, one line per memory, as Claude Code's model does.

## Configuration

There is none of its own: cc-mem follows Claude Code's settings and environment.

| Setting | Effect |
|---|---|
| `autoMemoryDirectory` in user, local or managed settings | Moves the memory directory, as in Claude Code. Project settings are ignored, as in Claude Code, so a cloned repository cannot redirect it |
| `CLAUDE_CONFIG_DIR` | Moves the whole Claude configuration, memory included |
| `autoMemoryEnabled: false`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | Auto memory is off: the agents are told so, and writes are refused |

## Command line

Print a project's memory index, for scripts or hooks:

```sh
npx @cc-mem/core index --project <dir>
```

## Status

Version 0.2.2, on npm under [`@cc-mem`](https://www.npmjs.com/org/cc-mem). Tested with pi 1.4.0, OpenCode 2.2.0 and DeepSeek Harness 0.2.1-rc.3 running DeepSeek V4.1 Flash, against Claude Code 2.1.312. The design, and how each agent behaved in the tests, are in [docs/design.md](docs/design.md). An earlier version was a Go MCP server.

## License

MIT. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.
