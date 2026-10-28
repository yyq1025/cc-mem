# @cc-mem/opencode

Gives [OpenCode](https://opencode.ai) the auto memory Claude Code already keeps for your projects, so OpenCode, Claude Code and your other agents work from the same notes. What OpenCode saves, Claude Code recalls in its next session, and the other way round.

```sh
opencode plugin add @cc-mem/opencode
```

Needs OpenCode 2.2 or later. Start a new session afterwards.

## What it does

- Puts the project's `MEMORY.md` index into the system prompt when a session starts, and reads it again after each compaction. The directory is the one Claude Code uses for the working directory, `~/.claude/projects/<project>/memory` by default.
- Registers four direct tools, outside code mode:
  - `memory_list(project)` returns the notes of another project directory.
  - `memory_write(file_name, content)` creates a memory file, or `MEMORY.md`, and never overwrites one.
  - `memory_edit(file_name, …)` replaces text exactly, renames a memory file, or both.
  - `memory_delete(file_name)` deletes one memory file; it cannot delete `MEMORY.md`.
- Records `source: opencode` in the files it writes and `modifiedBy: opencode` in the files it changes.

OpenCode reads memory files with its own `read` tool. It keeps `MEMORY.md` up to date itself, one line per memory, as Claude Code's model does.

The plugin follows Claude Code's settings: `autoMemoryDirectory`, `CLAUDE_CONFIG_DIR`, and turning auto memory off with `autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. When auto memory is off, OpenCode is told so and writes are refused.

Part of cc-mem, with plugins for [pi](https://www.npmjs.com/package/@cc-mem/pi) and [DeepSeek Harness](https://www.npmjs.com/package/@cc-mem/dsh).

## License

MIT. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.
