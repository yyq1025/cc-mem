# @cc-mem/pi

Gives [pi](https://pi.dev) the auto memory Claude Code already keeps for your projects, so pi, Claude Code and your other agents work from the same notes. What pi saves, Claude Code recalls in its next session, and the other way round.

```sh
pi install npm:@cc-mem/pi
```

## What it does

- Puts the project's `MEMORY.md` index into the system prompt on every turn. The directory is the one Claude Code uses for the working directory, `~/.claude/projects/<project>/memory` by default.
- Registers three tools:
  - `memory_list(project)` returns the notes of another project directory.
  - `memory_write(file_name, content)` creates a memory file, or `MEMORY.md`, and never overwrites one.
  - `memory_edit(file_name, …)` replaces text exactly, renames a memory file, or both. Every edit first copies the old version into `.cc-mem-trash`, beside the memory directory.
- Records `source: pi` in the files it writes and `modifiedBy: pi` in the files it changes.

pi reads memory files with its own `read` tool. It keeps `MEMORY.md` up to date itself, one line per memory, as Claude Code's model does.

The plugin follows Claude Code's settings: `autoMemoryDirectory`, `CLAUDE_CONFIG_DIR`, and turning auto memory off with `autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. When auto memory is off, pi is told so and writes are refused.

Part of cc-mem, with plugins for [OpenCode](https://www.npmjs.com/package/@cc-mem/opencode) and [DeepSeek Harness](https://www.npmjs.com/package/@cc-mem/dsh).

## License

MIT. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.
