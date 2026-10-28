// Locates Claude Code's auto memory directory the way Claude Code 2.1.311
// and later resolve it.
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, normalize, resolve } from "node:path"
import { findCanonicalGitRoot } from "./git.js"
import { djb2Hash } from "./hash.js"
import { autoMemoryDisabledBy, loadSettings, memoryDirectory } from "./settings.js"

const maxSanitizedLength = 200
const entrypointName = "MEMORY.md"

// Env is what resolution reads from outside the project.
export interface Env {
  vars: Record<string, string | undefined>
  home: string
  managedDir: string // directory holding managed-settings.json
}

export function systemEnv(): Env {
  return { vars: process.env, home: homedir(), managedDir: managedDir() }
}

function managedDir(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/ClaudeCode"
    case "win32":
      return "C:\\Program Files\\ClaudeCode"
    default:
      return "/etc/claude-code"
  }
}

// Location is the memory directory of one project.
export interface Location {
  project: string // working directory with symlinks resolved
  dir: string // memory directory, without a trailing separator
  entrypoint: string // dir/MEMORY.md
  source: string // where dir came from
  enabled: boolean // whether Claude Code reads it
  disabledBy?: string // why not, when !enabled
}

// resolveLocation finds the memory directory Claude Code uses when started
// in cwd.
export function resolveLocation(env: Env, cwd: string): Location {
  let project = resolve(cwd)
  try {
    project = realpathSync(project)
  } catch {}
  project = project.normalize("NFC")

  const settings = loadSettings(env, project)
  const disabledBy = autoMemoryDisabledBy(env, settings)
  let dir: string
  let source: string
  const override = validateMemoryPath(env.vars["CLAUDE_COWORK_MEMORY_PATH_OVERRIDE"], "", false)
  const fromSettings = memoryDirectory(settings, env.home)
  if (override !== undefined) {
    dir = override
    source = "CLAUDE_COWORK_MEMORY_PATH_OVERRIDE"
  } else if (fromSettings !== undefined) {
    dir = fromSettings.dir
    source = `autoMemoryDirectory in ${fromSettings.file}`
  } else {
    const base = env.vars["CLAUDE_CODE_REMOTE_MEMORY_DIR"] || configHome(env)
    const root = findCanonicalGitRoot(project) ?? project
    dir = join(base, "projects", sanitizePath(root), "memory").normalize("NFC")
    source = "default"
  }
  return {
    project,
    dir,
    entrypoint: join(dir, entrypointName),
    source,
    enabled: disabledBy === undefined,
    ...(disabledBy === undefined ? {} : { disabledBy }),
  }
}

export function configHome(env: Env): string {
  return (env.vars["CLAUDE_CONFIG_DIR"] || join(env.home, ".claude")).normalize("NFC")
}

// sanitizePath gives the directory name Claude Code uses for a project root
// under projects/: each character but a letter or digit becomes -, and a
// name over 200 characters is cut and suffixed with a hash.
export function sanitizePath(root: string): string {
  const sanitized = root.replace(/[^a-zA-Z0-9]/g, "-")
  if (sanitized.length <= maxSanitizedLength) return sanitized
  return `${sanitized.slice(0, maxSanitizedLength)}-${djb2Hash(root)}`
}

// validateMemoryPath checks an override path as Claude Code does. Settings
// values may start with ~/; the environment override may not.
export function validateMemoryPath(raw: string | undefined, home: string, expandTilde: boolean): string | undefined {
  if (!raw) return undefined
  let candidate = raw
  if (expandTilde && (candidate.startsWith("~/") || candidate.startsWith("~\\"))) {
    const rest = candidate.slice(2)
    const restNorm = normalize(rest || ".")
    if (restNorm === "." || restNorm === "..") return undefined
    candidate = join(home, rest)
  }
  const normalized = normalize(candidate).replace(/[/\\]+$/, "")
  if (
    !isAbsolute(normalized) ||
    normalized.length < 3 ||
    /^[A-Za-z]:$/.test(normalized) ||
    normalized.startsWith("\\\\") ||
    normalized.startsWith("//") ||
    normalized.includes("\0")
  ) {
    return undefined
  }
  return normalized.normalize("NFC")
}
