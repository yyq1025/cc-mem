import { readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

// findCanonicalGitRoot finds the project root Claude Code keys memory on:
// the nearest directory with a .git entry, resolved from a worktree to its
// main repository so all worktrees share memory.
export function findCanonicalGitRoot(start: string): string | undefined {
  const root = findGitRoot(start)
  return root === undefined ? undefined : resolveCanonicalRoot(root)
}

function findGitRoot(start: string): string | undefined {
  for (let current = resolve(start); ; current = dirname(current)) {
    const info = statSync(join(current, ".git"), { throwIfNoEntry: false })
    if (info && (info.isDirectory() || info.isFile())) return current.normalize("NFC")
    if (dirname(current) === current) return undefined
  }
}

// resolveCanonicalRoot follows a worktree's .git file to gitdir and
// commondir, accepting only the layout `git worktree add` creates.
// Submodules and anything else fall back to gitRoot.
function resolveCanonicalRoot(gitRoot: string): string {
  try {
    const text = readFileSync(join(gitRoot, ".git"), "utf8").trim()
    if (!text.startsWith("gitdir:")) return gitRoot
    const worktreeGitDir = resolve(gitRoot, text.slice("gitdir:".length).trim())
    const commonDir = resolve(worktreeGitDir, readFileSync(join(worktreeGitDir, "commondir"), "utf8").trim())
    if (dirname(worktreeGitDir) !== join(commonDir, "worktrees")) return gitRoot
    const backlink = realpathSync(readFileSync(join(worktreeGitDir, "gitdir"), "utf8").trim())
    if (backlink !== join(realpathSync(gitRoot), ".git")) return gitRoot
    // A bare repository's worktrees have no main working directory, so the
    // common dir itself identifies the project.
    if (basename(commonDir) !== ".git") return commonDir.normalize("NFC")
    return dirname(commonDir).normalize("NFC")
  } catch {
    // A .git directory, or a worktree whose files are missing.
    return gitRoot
  }
}
