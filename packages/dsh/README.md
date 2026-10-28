# @cc-mem/dsh

Gives [DeepSeek Harness](https://www.deepseek.com/harness/) the auto memory Claude Code already keeps for your projects, so DeepSeek Harness, Claude Code and your other agents work from the same notes. What it saves, Claude Code recalls in its next session, and the other way round.

```sh
dsh plugin --profile <profile> add @cc-mem/dsh
```

The desktop app's profile is `desktop`. Needs DeepSeek Harness 0.2.1 or later; restart it afterwards.

## What it does

- Puts the `MEMORY.md` index for each session's working directory into the runtime context on every request. The directory is the one Claude Code uses, `~/.claude/projects/<project>/memory` by default. One Harness host serves many workspaces, so the directory comes from each session, not from the process.
- Registers three tools:
  - `memory_list(project)` returns the notes of another project directory.
  - `memory_write(file_name, content)` creates a memory file, or `MEMORY.md`, and never overwrites one.
  - `memory_edit(file_name, …)` replaces text exactly, renames a memory file, or both. Every edit first copies the old version into `.cc-mem-trash`, beside the memory directory.
- Records `source: dsh` in the files it writes and `modifiedBy: dsh` in the files it changes.

The agent reads memory files with its own file tools. It keeps `MEMORY.md` up to date itself, one line per memory, as Claude Code's model does.

The plugin follows Claude Code's settings: `autoMemoryDirectory`, `CLAUDE_CONFIG_DIR`, and turning auto memory off with `autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. When auto memory is off, the agent is told so and writes are refused.

Part of cc-mem, with plugins for [pi](https://www.npmjs.com/package/@cc-mem/pi) and [OpenCode](https://www.npmjs.com/package/@cc-mem/opencode).

## License

MIT. Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.
