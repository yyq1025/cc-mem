import { symlinkSync } from "node:fs"
import { join, sep } from "node:path"
import { describe, expect, test } from "vitest"
import { findCanonicalGitRoot } from "../src/git.js"
import { resolveLocation, sanitizePath, validateMemoryPath } from "../src/paths.js"
import { mkdir, tempDir, testEnv, writeFile } from "./helpers.js"

describe("resolveLocation", () => {
  test("uses the git root under the config home", () => {
    const env = testEnv()
    const project = join(tempDir(), "my.project")
    mkdir(join(project, ".git"))
    mkdir(join(project, "sub"))

    const loc = resolveLocation(env, join(project, "sub"))
    const want = join(env.home, ".claude", "projects", sanitizePath(project), "memory")
    expect(loc).toMatchObject({ dir: want, entrypoint: join(want, "MEMORY.md"), source: "default", enabled: true })
  })

  test("uses the directory itself outside git", () => {
    const project = tempDir()
    expect(resolveLocation(testEnv(), project).dir.endsWith(sanitizePath(project) + sep + "memory")).toBe(true)
  })

  test("follows CLAUDE_CONFIG_DIR and CLAUDE_CODE_REMOTE_MEMORY_DIR", () => {
    const env = testEnv()
    const project = tempDir()
    const config = tempDir()
    env.vars["CLAUDE_CONFIG_DIR"] = config
    expect(resolveLocation(env, project).dir.startsWith(join(config, "projects") + sep)).toBe(true)
    const remote = tempDir()
    env.vars["CLAUDE_CODE_REMOTE_MEMORY_DIR"] = remote
    expect(resolveLocation(env, project).dir.startsWith(join(remote, "projects") + sep)).toBe(true)
  })

  test("resolves a symlinked working directory", () => {
    const env = testEnv()
    const project = tempDir()
    const link = join(tempDir(), "link")
    symlinkSync(project, link)
    expect(resolveLocation(env, link).dir).toBe(resolveLocation(env, project).dir)
  })

  test("takes overrides in Claude Code's order", () => {
    const env = testEnv()
    const project = tempDir()
    const config = join(env.home, ".claude")

    writeFile(join(config, "settings.json"), `{"autoMemoryDirectory": "~/notes/user"}`)
    let loc = resolveLocation(env, project)
    expect(loc.dir).toBe(join(env.home, "notes", "user"))
    expect(loc.source).toContain("settings.json")

    // Project settings come from the repository, so they are ignored.
    writeFile(join(project, ".claude", "settings.json"), `{"autoMemoryDirectory": "/tmp/from-repo"}`)
    expect(resolveLocation(env, project).dir).toBe(join(env.home, "notes", "user"))

    writeFile(join(project, ".claude", "settings.local.json"), `{"autoMemoryDirectory": "/srv/local-notes"}`)
    expect(resolveLocation(env, project).dir).toBe("/srv/local-notes")

    writeFile(join(env.managedDir, "managed-settings.json"), `{"autoMemoryDirectory": "/srv/base"}`)
    writeFile(join(env.managedDir, "managed-settings.d", "10-a.json"), `{"autoMemoryDirectory": "/srv/a"}`)
    writeFile(join(env.managedDir, "managed-settings.d", "20-b.json"), `{"autoMemoryDirectory": "/srv/b"}`)
    expect(resolveLocation(env, project).dir).toBe("/srv/b")

    env.vars["CLAUDE_COWORK_MEMORY_PATH_OVERRIDE"] = "/srv/cowork/"
    loc = resolveLocation(env, project)
    expect(loc).toMatchObject({ dir: "/srv/cowork", source: "CLAUDE_COWORK_MEMORY_PATH_OVERRIDE" })
  })
})

test.each([
  ["/srv/mem", false, "/srv/mem"],
  ["/srv/mem//", false, "/srv/mem"],
  ["/srv/a/../mem", false, "/srv/mem"],
  ["relative/mem", false, undefined],
  ["/", false, undefined],
  ["/a", false, undefined],
  // Node's POSIX normalize collapses the leading slashes.
  ["//server/share", false, "/server/share"],
  ["~/mem", false, undefined],
  ["~/mem", true, "/home/u/mem"],
  ["~/", true, undefined],
  ["~/.", true, undefined],
  ["~/..", true, undefined],
  ["~/foo/../..", true, undefined],
  ["/srv/m\0em", false, undefined],
] as const)("validateMemoryPath(%j, tilde %s) = %s", (raw, tilde, want) => {
  expect(validateMemoryPath(raw, "/home/u", tilde)).toBe(want)
})

test("autoMemoryEnabled follows the environment and settings", () => {
  const env = testEnv()
  const project = tempDir()
  expect(resolveLocation(env, project).enabled).toBe(true)

  writeFile(join(project, ".claude", "settings.json"), `{"autoMemoryEnabled": false}`)
  const loc = resolveLocation(env, project)
  expect(loc.enabled).toBe(false)
  expect(loc.disabledBy).toContain("autoMemoryEnabled")

  writeFile(join(project, ".claude", "settings.local.json"), `{"autoMemoryEnabled": true}`)
  expect(resolveLocation(env, project).enabled, "local settings outrank project settings").toBe(true)

  env.vars["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] = "1"
  expect(resolveLocation(env, project).enabled).toBe(false)
  env.vars["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] = "0"
  env.vars["CLAUDE_CODE_SIMPLE"] = "1"
  expect(resolveLocation(env, project).enabled, "an explicit 0 enables before any other check").toBe(true)
})

// makeWorktree lays out what `git worktree add` creates.
function makeWorktree(commonDir: string, worktree: string, name: string): void {
  const gitDir = join(commonDir, "worktrees", name)
  writeFile(join(gitDir, "commondir"), "../..\n")
  writeFile(join(gitDir, "gitdir"), join(worktree, ".git") + "\n")
  writeFile(join(worktree, ".git"), `gitdir: ${gitDir}\n`)
}

test("findCanonicalGitRoot resolves worktrees to their repository", () => {
  const base = tempDir()
  const main = join(base, "main")
  mkdir(join(main, ".git"))
  const worktree = join(base, "wt")
  makeWorktree(join(main, ".git"), worktree, "wt")
  mkdir(join(worktree, "src"))
  expect(findCanonicalGitRoot(join(worktree, "src"))).toBe(main)

  const bare = join(base, "repo.git")
  const bareWorktree = join(base, "bare-wt")
  makeWorktree(bare, bareWorktree, "bare-wt")
  expect(findCanonicalGitRoot(bareWorktree)).toBe(bare)

  // A .git file whose gitdir has no back-link to it is not trusted.
  const forged = join(base, "forged")
  writeFile(join(forged, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`)
  expect(findCanonicalGitRoot(forged)).toBe(forged)

  // A submodule's .git file points at a gitdir with no commondir.
  const submodule = join(main, "sub")
  mkdir(join(main, ".git", "modules", "sub"))
  writeFile(join(submodule, ".git"), "gitdir: ../.git/modules/sub\n")
  expect(findCanonicalGitRoot(submodule)).toBe(submodule)
})
