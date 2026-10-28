# Design

## Goal

Claude Code keeps an auto memory per project: a `MEMORY.md` index plus one markdown file per memory, under `<CLAUDE_CONFIG_DIR>/projects/<sanitized project root>/memory/`. Other agents cannot reach it. Migrating to a general memory system (claude-mem, memorix, mem0, …) means leaving that memory behind. This server serves Claude Code's memory directory as is, so Claude Code stays the primary home of the memory and other agents read and add to it.

## Prior art

[kuitos/opencode-claude-memory](https://github.com/kuitos/opencode-claude-memory) (MIT) does this for OpenCode only, as an OpenCode plugin. About 5.4k lines:

| Part | Lines | In this server |
|---|---|---|
| store: directory resolution, frontmatter, line-level `MEMORY.md` edits, list/search, delete to a trash dir | 1152 | Translate to Go, using its tests as fixtures |
| util: atomic writes, locks | 354 | Translate to Go, simplified |
| tools: save / delete / list / search / read | 221 | Keep list; replace save and delete with write and edit tools under the write rules below; agents read and search with their own file tools |
| prompt: a 15 KB copy of Claude Code's memory instructions, injected every request | 275 | Condense into the server's `instructions` and tool descriptions |
| recall: a model call before each turn picking ≤5 memories (as Claude Code's own recall does) | 453 | Drop: needs a per-turn hook and a model |
| extraction and auto-dream: hidden sessions that save and consolidate memories | 1088 | Drop: needs session events, forks and a model; Claude Code consolidates its own memory |
| host adapters for OpenCode 1.x and 2.x | 1641 | Not needed |

Format facts to keep exact, all ported from Claude Code by that project:

- Directory: canonical git root (worktrees resolve to the main repo through `gitdir`/`commondir`), sanitized by replacing every non-alphanumeric character with `-`; names over 200 characters are cut and suffixed with a djb2 hash.
- Frontmatter: `name`, `description`, `metadata.type` (`user` | `feedback` | `project` | `reference`); the closing `---` must be within the first 30 lines.
- Index line: `- [Title](file.md) — hook`. Edit only the target line, never rewrite the file: users organise it by hand.
- Limits: `MEMORY.md` 200 lines / 25,000 characters (UTF-16 code units, so about 75 KB of Chinese); at most 200 memory files of 40 KB each.

Claude Code's memory behavior that cc-mem relies on:

- Types are `user`, `feedback`, `project`, `reference`. An unknown or missing `type` parses as no type rather than an error, so the server validates the type itself. Extra frontmatter keys are tolerated.
- Frontmatter is parsed as YAML, and when that fails, again after quoting values that contain YAML special characters such as an unquoted `: ` or `#`. The server reads existing files with the same fallback, so an edit to a memory Claude wrote is not refused as malformed, and requires plain valid YAML in what agents write, which Claude Code always accepts.
- Recall scans every `.md` file under the memory directory recursively, not only the files `MEMORY.md` lists. Anything Claude must not see yet has to live outside the memory directory.
- The directory is resolved in this order: `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`; `autoMemoryDirectory` from policy, `--settings`, local or user settings (never project settings, which a cloned repo controls); otherwise `<CLAUDE_CODE_REMOTE_MEMORY_DIR or CLAUDE_CONFIG_DIR or ~/.claude>/projects/<sanitized root>/memory`, where the root is the canonical git root of the working directory with symlinks resolved, or that directory outside git. The server follows all of it except settings it cannot see from another process: `--settings`, and policy from MDM or the remote API (it reads `managed-settings.json` and `managed-settings.d/`).
- The long-name hash is djb2: a real Claude Code 2.1.311 session in a 268-character directory produced the djb2 name.
- The index size limit counts UTF-16 code units, not bytes.

## Tools

Every agent already has tools to read and grep files, so the server serves only what those tools cannot do safely. The writing tools copy the shape the harnesses have converged on (Claude Code, DeepSeek Harness, pi and OpenCode all pair a whole-file `write` with a literal-replacement `edit`), with Claude Code's snake_case field names:

- `memory_list`: returns the path of `MEMORY.md`, the memory directory, and the index, under the framing described in [Loading the index](#loading-the-index-at-session-start). It returns the whole index even past Claude Code's limits, with a note that Claude sees only the first part and the memory needs consolidating. Its description asks the agent to read and search the memory files with its own tools; when to call it is in the instructions.
- `memory_write(file_name, content)`: creates a memory file, frontmatter included, or `MEMORY.md` when there is none. It refuses a file that already exists.
- `memory_edit(file_name, old_string?, new_string?, replace_all?, new_file_name?)`: one exact literal replacement in a memory file or `MEMORY.md`, a rename of a memory file, or both. `old_string` must match once unless `replace_all` is set.
- `memory_delete(file_name)`: deletes one memory file. It refuses `MEMORY.md`, and its result names the index line left pointing at the file.

Every tool takes an optional `project` argument, the agent's working directory, for harnesses where one server serves several projects (see DeepSeek Harness below). Without it the server uses its own project.

The `memory_write` description carries the file template and a condensed version of Claude Code's memory instructions: what each type is for, what not to save, and to write facts about the user and the project rather than about the agent's own tools, naming the agent when a fact holds only for it.

Choices:

- One replacement per call, no `edits[]` array. pi and OpenCode run MCP tools in code mode by default, so several calls cost little context.
- Exact matching only. pi and OpenCode retry with typographic quotes, dashes and spaces normalized (pi also applies NFKC), but index lines use an em dash and many memories use full-width punctuation, which that normalization would rewrite.
- When `old_string` is not found, the error returns the file's current content. Memory files are small, and models fail literal replacement often (a pi user reports about half of DeepSeek V4 Flash's edits failing), so the agent can retry without another read.
- One file per delete, never `MEMORY.md`. Retiring and merging memories is still Claude Code's consolidation (auto-dream, the consolidate-memory skill), but users ask other agents to delete a memory too, and without a tool they use `rm`: a pi run in S2 deleted the old file that way, and so did DeepSeek Harness when asked to drop a note that belonged to another project (2026-10-27). The tool bounds what one call can remove.

## Write rules

Writes are open, like opencode-claude-memory: any agent can create and edit any memory, Claude's included. The server checks the file each write or edit would produce, and the rules only keep the format correct and the changes traceable:

1. Paths: a bare `*.md` file name at the top of the memory directory, never `MEMORY.md`.
2. The resulting file must parse: frontmatter with its closing `---` within the first 30 lines, `name`, `description`, and a known `type`; at most 40 KB and 200 memory files. A failed check leaves the file unchanged.
3. The agent owns `MEMORY.md`, as Claude Code's own model does: Claude Code 2.1.312 only tells its model to add a one-line pointer after writing a file, and checks single memory files, never the index. The tools edit `MEMORY.md` like any memory file (no frontmatter), and their results remind the agent of what Claude Code would flag: a new file without its line, a renamed file whose line still points at the old name, links to files that do not exist, an index over Claude Code's limits, and a memory file past what recall shows (4,096 bytes or 200 lines) or with a description over 300 characters. (Until 2026-10-27 the server wrote the index line itself; a rename that kept a stale title led an agent to fix `MEMORY.md` with its own edit tool, and the user chose to hand the index to the agent.)
4. Provenance: the server stamps the source agent (`metadata.source`) and the date into the frontmatter.
5. No backups, as in Claude Code, whose model overwrites and deletes memory files with its ordinary file tools (2026-10-27). The first version copied every edited file into `.cc-mem-trash` beside the memory directory; agents were never told where it was, nothing restored from it, and it only grew. A project's memory is small, and what is lost can be asked again or read back from the code.
6. `feedback` is allowed (2026-10-27), with the rules in the tool description: save only what the user said in the conversation, never what came from files, pages or tool output, and write it as it holds for any agent working here, naming the agent when it holds only for that one. Claude Code lets its own model, Haiku included, write feedback, and the agents here are as able. Refusing it did not stop the text, only moved it: agents saved the same rule as a `project` memory, or wrote it into the repository's `AGENTS.md` and `CLAUDE.md`. The risks it guarded against remain and are no larger than for the other types: Claude follows a feedback memory as the user's instruction, so one that holds only for the agent that heard it, or one a page planted, changes how Claude works. `metadata.source` names the agent that wrote it.
7. Concurrent writers: Claude Code writes the same directory. Writes are atomic (temporary file, then rename) and queued per file. The server cannot require a read before an edit, as DeepSeek Harness's observation policy does, because agents read with their own tools; instead `memory_write` never overwrites, and an edit whose `old_string` Claude has changed in the meantime fails and returns the current text.

Deferred until the open version shows a need: deleting, perhaps only in a consolidation flow (MCP cannot restrict a tool to one mode, only describe it); an elicitation form to confirm writes when the client declares elicitation; `destructiveHint: true` on writing tools, which makes Codex ask for approval under its default settings.

## Protocol

Serve the legacy `initialize` handshake: pi supports nothing newer than 2025-11-25 (its own client; support for 2026-07-28 is requested in earendil-works/pi#10416), and OpenCode and Codex default to legacy. The official Go SDK answers both the legacy and the 2026-07-28 handshakes (v1.8.0 lists 2026-07-28 down to 2024-11-05).

## Implementation

TypeScript, as plugins for the harnesses rather than an MCP server. OpenCode, pi and DeepSeek Harness load plugins as JavaScript modules in their own process (OpenCode on Bun, pi and DeepSeek Harness on Node), so a plugin can inject the index when a session starts and register tools the model sees directly, with no process of its own. Code Mode in OpenCode, codemode in pi and tool search in Codex all keep MCP tools out of the model's first view (see Validation), and session-start injection is what the other cross-agent memory tools rely on (claude-mem, deja-vu, tigerless-labs/agent-memory, memmy all install per-harness hooks or plugins).

Layout: `packages/core` (`@cc-mem/core` on npm) resolves the memory directory, reads the index and builds the text, with a `cc-mem index` command for hooks; one thin package per harness will import it. Core uses only `node:` modules so it runs on Bun and Node alike. JavaScript strings count UTF-16 code units, as Claude Code does, so `sanitizePath`, `djb2Hash` and the `MEMORY.md` size limit port without conversion. Tests run on vitest under Node.

The first version was a Go MCP server, chosen because a resident server per session should cost little. The same minimal stdio server, measured after `initialize`, `tools/list` and one call (macOS arm64, 2026-10-27):

| Runtime | Resident memory | Shipped file | User needs |
|---|---|---|---|
| Node 24, TypeScript SDK v2.4.0 | 66 MB | — | Node |
| Bun 1.4.3, same code | 46 MB | — | Bun |
| `bun build --compile`, same code | 37 MB | 68 MB | nothing |
| Go 1.27.3, go-sdk v1.8.0 | 13 MB | 10.8 MB (7.3 MB stripped) | nothing |

Plugins remove the resident process, and a hook runs `index` once per session and exits. Cold start of `index` on the same machine, median of 40 runs: Go 5.8 ms (12 MB peak), `bun build --compile` 12.1 ms (15 MB, a 71 MB file), Bun 13.0 ms (16 MB), Node 30.9 ms (47 MB). With memory and start-up time no longer deciding, TypeScript wins on distribution: pure JavaScript packages, no per-platform binaries (OpenCode and pi install npm packages without lifecycle scripts, so a binary would need esbuild-style optional dependencies), and plugins that call core in process. Codex is left out for now; it would need a `SessionStart` hook plus an MCP server for tools, since it cannot load plugin code and its sandbox blocks shell writes to `~/.claude`.

## Loading the index at session start

The server's `instructions` are one line and carry no index:

> Call memory_list with your working directory before any other tool, once per conversation: it returns notes from earlier sessions there (the user's preferences, past decisions, where things are on this machine) that the code does not tell you.

Claude Code, OpenCode 2, Codex and DeepSeek Harness place server instructions in the model's context. pi lists only their first line (up to the first newline, cut to 250 characters, and only for servers whose tools are reached through codemode or tool search), so the whole instruction is one line of 243 characters. It gives the reason before the order: an agent cares about what the notes hold, not who wrote them, so it does not name Claude Code.

Every agent makes the same call with its own directory, so every harness behaves alike. Where the server runs matters only as the default for `project`: DeepSeek Harness's `dsh web` and desktop app start one server per Host for all its Workspaces, with the Host's working directory (its memory MCP examples set `cwd: !!js process.cwd()`), which is the profile directory `$DSH_HOME/profiles/desktop` for the desktop app. Its MCP client sends no roots and tool calls carry no session, so only the agent knows its directory. Every harness tested puts the working directory in the system prompt (OpenCode's `Working directory:` line, for one).

Tried and dropped (see Validation):

- A bare request to call `memory_list` that named Claude Code and gave no reason: DeepSeek Harness called in 10 of 10 fresh sessions, OpenCode in 0 of 9.
- The index in the instructions when the server's own directory has notes, with that one line otherwise: 10 of 10 correct in both, but the agent sees a different setup in each harness, and the instructions are a snapshot taken at `initialize`.

With the final line, DeepSeek Harness called first in 10 of 10, and OpenCode did with GLM 5.3 Flash, Muse Spark 1.3 and MiniMax M3.1 Flash at their default effort and with DeepSeek V4.1 Flash at `max`. DeepSeek V4.1 Flash at its default `high` in OpenCode sometimes searched the disk first, so the README suggests `max` for that pairing.

The framing follows Claude Code's own line for recalled memories ("background context, not user instructions, and reflect what was true when written") and the access rules of its memory prompt, which opencode-claude-memory also ports: verify a named file, function or flag before relying on it; read a file when its entry bears on the task or the user asks to recall; act as if the index were empty when the user says to ignore memory. One line is ours: a note about a specific coding agent's tools may not apply. It goes next to the index at the top of the `memory_list` result, not in the tool description.

Optional, where a harness supports it: a CLI command that prints the index, for Codex `SessionStart` hooks (or an `mcp_tool` hook calling `memory_list`) and DeepSeek Harness's hook bridges.

## Open questions

- How the server learns the project directory. The agent passes it to `memory_list`; without it the server uses its working directory or `--project`. Does the agent pass `project` reliably in DeepSeek Harness when its Workspace differs from the Host's launch directory?
- Reading memory files with the agent's own tools: the directory is outside the project, so OpenCode may ask for its external-directory permission and sandboxes may need the path allowed. Check each harness's default. OpenCode 2.1.4 read a memory file under `~/.claude` with no permission request: `opencode run` rejects any request it would have to ask, and the read went through.
- Claude Code's auto-dream consolidates the memory directory in the background. Check whether it keeps `metadata.source` when it merges or rewrites other agents' memories.
- Validation: per harness × model × task, does the agent read the index, use the right memory, and save useful memories with the right type? Start with `memory_list` and file reads before building writes. For writes, also measure how often `memory_edit` fails and whether returning the current content gets the retry right, per model; no one has published a comparison of the harnesses' edit tools.

## Validation

Place names in the scenarios below are fictional.

OpenCode 2.1.4, `opencode run --standalone` in this repository with the server added through `OPENCODE_CONFIG_CONTENT`, the default model (the most recently chosen one is `opencode-go/deepseek-v4.1-flash`; the run output does not name it), 2026-10-27:

- Instructions reach the model: told not to call tools, it answered two questions from index entries and named their files.
- Unprompted use: asked where a fact lives that only a memory file holds, without mentioning memory, it called `memory_list` from code mode (`tools["cc-memory"].memory_list({})`), read the file with OpenCode's own read tool, and answered correctly.

DeepSeek Harness 0.2.1-rc.3, the CLI bundled with the desktop app, `dsh headless --json` in this repository with a `--patch` overlay adding the server, model `deepseek-v4.1-flash` through the OpenCode Go endpoint, same questions, 2026-10-27:

- Instructions reach the model: it answered both from the index without tools, and in Chinese, following the reply-language memory.
- Unprompted use: it called `mcp__cc-memory__memory_list`, read the memory file with its own read tool, then checked the note against the checkout with shell and grep, as the framing asks, and found a relevant file the note omits.
- Setup notes: the headless profile ignores keys saved by the GUI unless the overlay re-enables the `credentials`, `authorization` and `deepseek-account` entries.
- Not covered: `dsh web` serving several Workspaces from one server, where the agent has to pass `project`.

DeepSeek Harness desktop app 0.2.1-rc.3, the form deepseek.com promotes first ("Download for macOS"), with the server added to the desktop profile as the MCP guide shows (`cwd: !!js process.cwd()`), a Workspace on this repository, 2026-10-27:

- The host process runs in `$DSH_HOME/profiles/desktop`, so the server's instructions described that directory, which has no memory.
- Asked where a local checkout is that only a memory note records, the model saw no index entry for it, did not call `memory_list`, and declined to look; in headless, launched in the repository, the index entry made the same question routine.
- Asked a question only memory answers, it called `memory_list` with `project` set to the Workspace on its first step and read the memory file; the reason it wanted was not in the note, so it went on to read Claude Code's transcripts under `~/.claude/projects/` and found it there (23 tool calls).
- Setup notes: the desktop app's DeepSeek card listed `deepseek-flash`, which the OpenCode Go endpoint retired; renaming the model id on the Models page fixed it.

Context cost in DeepSeek Harness (DeepSeek tokenizer, this project's 2.9 KB index, mostly Chinese): the server adds about 1,560 tokens to every request (5,654 → 7,210 for the same task), a `memory_list` call about 1,100, and reading one 1.9 KB memory file about 1,160.

With the first line changed to "the index follows below; if you cannot see it, call memory_list once at the start of the conversation", both OpenCode 2.2.0 and DeepSeek Harness answered the same question by reading the memory file directly, without calling `memory_list`.

## Distribution

Four npm packages: `@cc-mem/core` (core and the `cc-mem` command), `@cc-mem/pi`, `@cc-mem/opencode` and `@cc-mem/dsh`, under the `@cc-mem` npm organization (npm refused the unscoped `cc-mem` as too similar to the existing `ccmem`; it compares names without punctuation, and scoped names are exempt), published with `bun publish`, which turns `workspace:*` into the version the lockfile records; run `bun install` after a version bump, or the plugins depend on the old core. Core and the DeepSeek Harness plugin ship JavaScript built on `prepack`; pi and OpenCode load TypeScript, so their packages ship `src`. The DeepSeek Harness plugin imports `@deepseek-ai/dsh-tools`, a peer: DeepSeek Harness routes a plugin's declared peers to its own runtime only for packages installed into a profile with `dsh plugin --profile <name> add` (`dsh-app-boot`'s profile resolution; profiles set `autoInstallPeers: false`). Loaded by path from elsewhere, the import fails; the repository checkout only works because of the devDependencies. Packed tarballs, 2026-10-27: installed outside the repository without peers or devDependencies, the pi and OpenCode plugins saved and indexed a memory in S1. The DeepSeek Harness plugin did so after `dsh plugin add` into a profile made from the headless template, which registered it through its bundle patch; the patch quotes `"@cc-mem/dsh"`, since a YAML plain value cannot start with `@`. Before that, loading it by path from the same install failed on that import. Published as 0.1.0 on 2026-10-27; installed from npm (`pi install npm:@cc-mem/pi`, `@cc-mem/opencode` in OpenCode's `plugins`, `dsh plugin add @cc-mem/dsh` into a throwaway profile), each agent saved and indexed a memory in S1. npm now stages a new package: for a few minutes after `bun publish` it serves a `0.0.0-stage` placeholder holding only a README. An install resolved against that metadata gets the placeholder, and pi then saves the range `^0.0.0-stage`, which 0.1.0 never satisfies; OpenCode left an empty install and loaded nothing, with no error. Install only after `latest` shows the new version, with fresh metadata (`npm view <pkg> --prefer-online`).

Instructions with no index, asking every agent to call `memory_list` with its working directory once per conversation, two prompts in one session (the checkout question, then the reply language and test runner), 2026-10-27:

- DeepSeek Harness headless: it called `memory_list` with the repository as `project` on its first step and answered; on the second prompt it read the memory files from the index already in the conversation, without calling again.
- OpenCode 2.2.0: on the first prompt it did not call `memory_list` and declined the checkout question, as the desktop app had with an empty index; on the second prompt it called `memory_list` from code mode with `project` and answered. The call is left to the model, and a model that does not make it loses exactly the context that would have changed its answer.

The same instructions, one prompt per fresh session, two questions (Q1 where a local checkout is, which a memory note records; Q2 "Which US state do I live in?", which only a memory answers), 2026-10-27:

| Harness | `memory_list` called | Correct |
|---|---|---|
| DeepSeek Harness headless, Q1 ×5 | 5/5, always the first call | 5/5 |
| DeepSeek Harness headless, Q2 ×5 | 5/5, always the first call | 5/5 |
| OpenCode 2.2.0, Q1 ×5 | 0/5 | 1/5: one refusal, one found the checkout by searching the disk, three searched `/` and `/Users` until stopped |
| OpenCode 2.2.0, Q2 ×4 | 0/4 | 0/4: each said it cannot know the user's location |

OpenCode puts the server instructions in context (the index-in-instructions runs answered from them), and in code mode the agent reaches MCP tools only through `execute`; a one-line instruction did not get it to call `memory_list` in any of nine fresh sessions. Whether the agent calls depends on the harness, not only the model, so the index has to be in the instructions wherever the server's directory is the agent's.

The index back in the instructions where the server's directory has notes (a reason line, the project and memory directory, the framing, then the index; since dropped), same questions and sessions, 2026-10-27:

| Harness | Correct | `memory_list` called |
|---|---|---|
| DeepSeek Harness headless, Q1 ×5 | 5/5 | 3/5, alongside reading the file it already knew |
| DeepSeek Harness headless, Q2 ×5 | 5/5 | 0/5; read the location note directly |
| OpenCode 2.2.0, Q1 ×5 | 5/5; four read the memory file and answered in one call, one searched the disk first | 0/5 |
| OpenCode 2.2.0, Q2 ×5 | 5/5; three answered from the index alone, one hedged ("the memory says Oregon; is that still current?") | 1/5 |

Against the call-only instructions, OpenCode went from 1/9 to 10/10 and DeepSeek Harness stayed at 10/10, with fewer steps.

No index again, with one 243-character line that gives the reason and the order: "Call memory_list with your working directory before any other tool, once per conversation: it returns notes from earlier sessions there (the user's preferences, past decisions, where things are on this machine) that the code does not tell you." Same questions, 2026-10-27:

| Harness | `memory_list` as the first call | Correct |
|---|---|---|
| DeepSeek Harness headless, Q1 ×5 + Q2 ×5 | 10/10 | 10/10 |
| OpenCode 2.2.0, Q1 ×4 | 2/4; the other two started with shell or glob | 3/4 (one stopped while globbing) |
| OpenCode 2.2.0, Q2 ×3 | 3/3 | 3/3 |

Against the first call-only line (0 of 9 calls in OpenCode), the reason and "before any other tool" moved OpenCode most of the way; it still searches the disk first on some "where is X on this machine" questions. Reasoning effort was not pinned in any of these batches: DeepSeek Harness headless sent `high`, and `opencode run` passed no variant.

The same line with OpenCode pinned to the `max` variant (`-m opencode-go/deepseek-v4.1-flash#max`), Q1 ×5, 2026-10-27: `memory_list` was the first call in 5/5 and all five answered correctly, after reading the memory file and checking the checkout on disk. At the default variant the same question got the call first in 2 of 4. Without a variant OpenCode sends no `reasoning_effort` (`model-resolver.ts`, `withVariant`), so the provider's default applies. DeepSeek's docs give `high`, but OpenCode Go may not pass that default through: see the `#high` runs with the plugin below, which reasoned two to three times as much as the default. `max` closed the gap in OpenCode. The max runs also thought longer before the first call (160 to 1,014 reasoning tokens, against 73 to 217).

Why OpenCode differs (v2.2.0 source): models without a model-specific prompt, DeepSeek among them, get the short default prompt (`session/runner/prompt/system.txt`), which says nothing about MCP or the order of tools. MCP server instructions go into the system prompt in full, inside `<mcp_instructions>`, but in code mode MCP tools are not tools of their own: they appear in the Code Mode catalog as one line each, the description's first line cut to 120 characters (`codemode/catalog.ts`), and are called by writing code for `execute`. Glob, grep, read and shell are direct tools. DeepSeek Harness exposes `mcp__cc-memory__memory_list` as a direct tool.

Other models in OpenCode 2.2.0 at their default variant, the same 243-character line, Q1 only, 2026-10-27:

| Model (OpenCode Go) | `memory_list` as the first call | Correct |
|---|---|---|
| GLM 5.3 Flash, ×5 | 5/5 | 5/5 |
| Muse Spark 1.3 Contributor, ×5 (OpenCode gives Muse models its own system prompt, `meta.txt`) | 5/5 | 5/5 |
| MiniMax M3.1 Flash, ×2 (stopped to save quota) | 2/2 | 2/2 |

All of them read the memory file next and checked the checkout on disk before answering; MiniMax went furthest, grepping the checkout to confirm it. Of the models tried in OpenCode at the default effort, only DeepSeek V4.1 Flash started some runs with a disk search instead.

Codex 0.165.0 with GPT-6 Luna at `high`, signed in with ChatGPT, the user's own config (other MCP servers, and Codex's own memories feature on), the final line, Q1 ×6, 2026-10-27: `memory_list` was called in 0 of 6. Two runs declined; four found the checkout by searching the home directory, and two of those first grepped Codex's own `~/.codex/memories/MEMORY.md`. Why (0.165.0 source): for models that support tool search, Codex defers every regular MCP tool (`mcp_tool_exposure.rs`), so `memory_list` is not among the model's tools until it calls `tool_search`; the server instructions become the namespace description that tool search shows (`codex-mcp/src/rmcp_client.rs`). A per-server `omit_tools_from = ["deferred"]` should expose the tools directly. Codex's memories feature also tells the model where to look for earlier sessions, and it looks there first.

pi 1.4.0 with OpenCode Go's DeepSeek V4.1 Flash, the server at pi's default `codemode` exposure (so the model sees only `- mcp__cc_memory (codemode): <the line>` under "MCP servers whose tools are not declared to you"), Q1, 2026-10-27. pi's default thinking level `medium` is not offered for this model, so pi raises it to `high`.

| Thinking | `memory_list` called | Outcome |
|---|---|---|
| default (`high`), ×5 (the fifth stopped) | 1/5, at the fourth step after searching the disk and `searchTools("memory")` | 2 refusals, 3 found the checkout, one of them through the memory |
| `max`, ×5 | 0/5 | 2 refusals, 3 found the checkout with `find ~ -maxdepth 6`, about 25 s per search |

Unlike OpenCode, `max` did not help: in pi's default exposure the line is a one-line summary of a server whose tools are not declared, and the model goes straight to bash.

The pi extension (`packages/pi`): the memory text for the working directory as a `<memory>` section of the system prompt, rebuilt before every run, plus `memory_list` as a direct tool for other directories. Same model and questions, default thinking (`high`), the MCP server off (`--no-mcp`), 2026-10-27:

| Question | First step | Correct | Time |
|---|---|---|---|
| Q1 ×5 | read the memory file the index names, 5/5 | 5/5, no refusals | 4–13 s |
| Q2 ×5 | answered from the index (2) or read the location note (3) | 5/5 | 1–3 s |

Against the MCP server in pi's default exposure (1 call in 5 at `high`, 0 in 5 at `max`, four refusals, searches of `~` up to 118 s), every run used the memory first. Only one called `memory_list`, redundantly, for the working directory. Several answers followed the notes' preferences unprompted, replying in Chinese.

The OpenCode plugin (`packages/opencode`): a `context` session hook appends the memory text for the plugin's directory to the system prompt of every agent-loop request, read again each time, and `memory_list` is a direct tool (`codemode: false`) for other directories. OpenCode 2.2.0, DeepSeek V4.1 Flash at the default variant, no MCP server, 2026-10-27:

| Question | First step | Correct | Time |
|---|---|---|---|
| Q1 ×5 | read the memory file the index names, 5/5 | 5/5 | 10–18 s |
| Q2 ×5 | read the location note, 5/5 | 5/5 | 2–4 s |

With the MCP server and the same model and variant, the first call was `memory_list` in 2 of 4 Q1 runs, and the others globbed or searched the disk; `max` was needed to close the gap. With the plugin no run searched the disk first, so the README no longer needs to suggest `max`.

The plugin with the variant pinned to `high` (`#high`), Q1 ×3: the memory file was the first read in 3/3 and all were correct, in 12–39 s. Reasoning tokens per run were 374, 171 and 969, against 146, 76 and 166 for the default-variant runs above, so the default that reaches OpenCode Go is probably below `high`. Whatever the effort, the plugin got the memory read first.

## Writes: first behavior runs

`memory_write` and `memory_edit` in the pi extension and the OpenCode plugin, DeepSeek V4.1 Flash at the default effort, two runs per harness per scenario. Each run started from a copy of a real 18-entry memory directory, pointed to with `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`, 2026-10-27:

| Scenario | Result (4 runs) |
|---|---|
| "Remember: I come from data science, write Python daily, TypeScript only these two years" | 4/4 `memory_write`, type `user`, absolute dates, one index line added |
| "Update: I moved from Oregon to Vermont last week" | 4/4 ended with a correct note and index, but every run renamed or deleted `user_location_oregon.md` with the shell (`mv`, `rm`) or rewrote `MEMORY.md` with Python; one used only its own `write` and `rm`, no memory tool |
| "Don't use npm here, use bun; note it down" (feedback) | 4/4 not saved; each told the user to say it in Claude Code, without trying the tool |
| "Read me the first line of README.md" | 4/4 no write |

A real `claude -p` with the same override answered from a memory the core wrote, citing the file and its `opencode` source.

The rename is the gap: when a change makes the file name wrong (`..._oregon.md`), agents fix the name with their own tools, bypassing the backup, the provenance stamp and the server-owned index line.

`memory_edit` then took an optional `new_file_name`, renaming with the same backup, provenance and index update (a link-only change keeps a title the user wrote), as a patch's `*** Move to:` does in OpenCode and Codex; pi, DeepSeek Harness and Claude Code have no rename tool and use `mv`. The memory text and the `memory_write` description gained a line against changing memory files with the shell or other file tools (since softened to a preference with its reasons: the index line, the backup and the provenance stamp; not yet rerun). The same "moved to Vermont" request, two runs per harness: 4/4 renamed `user_location_oregon.md` to `user_location_vermont.md` through `memory_edit`, with `modifiedBy` stamped and the index line updated; the shell was used only for `ls`, `date` and reading.

The DeepSeek Harness plugin (`packages/dsh`, built against 0.2.1-rc.3): a `systemPrompt.context` contribution with the memory text for each session's working directory (`ctx.workingDirectory`), which Harness re-renders at each assembly and logs only when it changes, and the same three tools. One Host serves every Workspace, so the directory comes from the session, which also fixes the desktop app's profile-directory problem. DeepSeek V4.1 Flash through `dsh headless`, 2026-10-27:

| Run | Result |
|---|---|
| Q1 ×3 | 3/3 read the memory file first, correct |
| Q2 ×2 | 2/2 correct; one answered from the index alone and gave the move a wrong year (the index line has no year) |
| S1 ×2 | 2/2 `memory_write`, type `user`, `source: dsh` |
| S3 ×2 | unlike pi and OpenCode, both tried the tools (renaming the existing feedback file, then a new one) and were refused; one then told the user, the other wrote the rule into the repository's `AGENTS.md` and `CLAUDE.md`, added `packageManager` and ran `bun install` |
| S4 ×2 | no write |

S2 with the softened shell line, two runs on each of pi, OpenCode and DeepSeek Harness: 6/6 renamed through `memory_edit`, with backups beside the temporary memory directory. One pi run also fixed the index title with pi's own `edit` on `MEMORY.md`: the rename kept the user's title ("User in Oregon=US Pacific") because the name and description had not changed yet, so the title went stale.

The behavior runs worked in this repository, so the S3 run's `AGENTS.md`, `CLAUDE.md` and `packageManager` landed here; they were removed. Later runs should use a scratch project directory.

With `MEMORY.md` handed to the agent, the four scenarios again on pi, OpenCode and DeepSeek Harness, two runs each, in a scratch project directory with a copied memory directory, 2026-10-27:

| Scenario | Result (6 runs) |
|---|---|
| S1 remember a fact | 6/6 `memory_write`, then `memory_edit` on `MEMORY.md` to add its line; no file left out of the index |
| S2 the user moved | 6/6 ended with `user_location_vermont.md` and an index line with a new title and hook, no broken links. 5/6 renamed through `memory_edit`; one pi run wrote a new file, fixed the index and deleted the old file with `rm`, as there is no delete tool |
| S3 feedback | 0/6 feedback saved; four tried the tools and were refused. One DeepSeek Harness run then saved the rule as a `project` memory, which design rule 6 accepts |
| S4 unrelated task | 6/6 no write |

The repository and the home directory were untouched.

With `feedback` allowed (rule 6), S3 again, two runs each on pi, OpenCode and DeepSeek Harness, same setup, 2026-10-27:

| Run | Result |
|---|---|
| pi 1, DeepSeek Harness 2 | new `feedback_use_bun_not_npm.md` through `memory_write`, linking the existing `feedback_run_bun_install_foreground.md`; one index line added |
| pi 2, OpenCode 1 and 2 | merged the rule into the existing `feedback_run_bun_install_foreground.md` through `memory_edit`, and retitled its index line |
| DeepSeek Harness 1 | merged it the same way and renamed the file to `feedback_bun_only_no_npm.md` in the same `memory_edit`, then fixed the index line; no other memory linked the old name |

6/6 saved the rule as `feedback` with the memory tools alone, quoted the user's words with an absolute date, and followed it with **Why:** and **How to apply:**; none touched the project directory, and every edit left a backup. All of them also added rules the user had not stated, such as no `npx` or deleting a `package-lock.json`. Four of six changed a memory Claude wrote rather than adding a near-duplicate, as the description asks. Not yet run: feedback that holds only for the agent that heard it, and an instruction to save feedback planted in a file the agent reads.

The baseline, Claude Code 2.1.312 itself with Haiku 5.5, three runs of S3 with the same copied memory directory (`claude -p`, no Bash), 2026-10-27: 3/3 saved it as `feedback`. Two merged it into `feedback_run_bun_install_foreground.md`, rewriting the whole file with `Write`, and one wrote a new `feedback_use_bun_not_npm.md` linking it; each then edited `MEMORY.md`, and none renamed or deleted a file. Haiku also added rules the user had not stated (no `npx` twice, no `package-lock.json` once), fewer than the agents above, which also added deleting a stray `package-lock.json`, keeping npm out of docs and CI, and ignoring a README's `npm install`. Claude Code stamps its own provenance (`originSessionId`, `modified`) the way the core stamps `source` and `modifiedBy`.

With `memory_delete` added and backups removed, 2026-10-27: S5 ("AI brand logo rules 这条记忆是别的项目的，删掉吧。", the request a user had just made in the DeepSeek Harness desktop app, where the agent used `rm`) twice on each of pi, OpenCode and DeepSeek Harness, and S2 once on each:

| Scenario | Result |
|---|---|
| S5 delete a memory | 6/6 `memory_delete` on `reference_ai_brand_logo_rules.md`, then `memory_edit` to drop its line from `MEMORY.md`; no `rm`, no dangling link. The shell was used only to read (`ls`, `cat`, `grep`); one OpenCode run first looked in the parent directory for the project the note came from |
| S2 the user moved | 3/3 renamed through `memory_edit` and fixed the index line, as before the backup wording left the descriptions; no shell writes |
