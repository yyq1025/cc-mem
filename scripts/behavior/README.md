# Behavior runs

Runs one scenario against one agent with the plugin loaded, and records what the agent did to the memory.

```sh
export CC_MEM_TEST_API_KEY=...   # an OpenCode Go API key
bun run build                    # the DeepSeek Harness plugin loads from dist
scripts/behavior/run.sh pi S5
scripts/behavior/run.sh opencode S2 --npm
```

Agents: `pi`, `opencode` and `dsh` (DeepSeek Harness). Without `--npm` the plugin loads from this checkout; with it, the published version is installed into the run, pinned so a stale npm or pnpm cache cannot serve an older one.

## Isolation

Each run gets a temporary root holding everything it touches, and the root is removed when the run ends:

| What | Where it goes |
|---|---|
| Memory | a copy of `seed/`, through `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` |
| Project | a copy of `project/`, the agent's working directory |
| pi | `PI_CODING_AGENT_DIR`, with `--no-session` |
| OpenCode | `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME`: sessions, config, and npm plugins. Your own `~/.config/opencode` is not read |
| DeepSeek Harness | `DSH_HOME`: profiles, sessions and caches |

The API key reaches each agent through an environment variable and is never written to a file. Your own sessions, settings and memory are left as they were. pnpm's and npm's download caches are shared, as they are only caches.

`seed/` is a fictional memory: every type, one file in the older top-level `type:` format, and the notes the scenarios need.

## Scenarios

`scenarios.tsv`:

| | Prompt | Checks |
|---|---|---|
| R1 | Which US state do I live in? | answered from memory |
| S1 | Remember a fact about the user | a new memory and its index line |
| S2 | The user moved | the note, its file name and its index line updated |
| S3 | Use bun, not npm; note it down | a feedback memory, or the existing one updated |
| S4 | Read the first line of README.md | no memory write |
| S5 | Delete a memory that belongs to another project | `memory_delete`, then the index line removed |
| S6 | S1 with no memory directory at all | the first note, then `MEMORY.md` created with `memory_write` |

A third column of `empty` in `scenarios.tsv` starts the run without the seed, and without the memory directory.

## Results

Each run writes `results/<time>-<agent>-<scenario>/` (ignored by git): the agent's event log, its stderr, the memory directory as the run left it, and `meta.json`. `analyze.mjs` summarizes a result, and `run.sh` calls it at the end:

```
pi S5 (repo, exit 0)
  tools: bash[reads memory] | memory_delete(reference_brand_logo_rules.md) | memory_edit(MEMORY.md)
  memory: +- -reference_brand_logo_rules.md ~MEMORY.md unindexed=none dangling=none
```

`[writes memory]` marks a shell or file-tool call that changed memory outside the memory tools. The summary prints no memory content. If you run these from a Claude Code session, its own memory may still pick up a scenario's facts from the conversation, so check that project's memory afterwards.
