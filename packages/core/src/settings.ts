import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { configHome, validateMemoryPath, type Env } from "./paths.js"

// SettingsFile holds the keys read from one settings file.
interface SettingsFile {
  path: string
  autoMemoryDirectory?: string
  autoMemoryEnabled?: boolean
}

// Settings are Claude Code's file-based settings sources, highest
// precedence first. Policy settings from MDM or the remote API and the
// --settings flag are not visible to another process.
export interface Settings {
  policy: SettingsFile[]
  local: SettingsFile[]
  project: SettingsFile[]
  user: SettingsFile[]
}

export function loadSettings(env: Env, project: string): Settings {
  // managed-settings.json first, then managed-settings.d/*.json in name
  // order, later files winning; reversed so the winner comes first.
  const policy = readSettings(join(env.managedDir, "managed-settings.json"))
  const dropInDir = join(env.managedDir, "managed-settings.d")
  let dropIns: string[] = []
  try {
    dropIns = readdirSync(dropInDir).filter((name) => name.endsWith(".json") && !name.startsWith("."))
  } catch {}
  for (const name of dropIns.sort()) policy.push(...readSettings(join(dropInDir, name)))
  return {
    policy: policy.reverse(),
    local: readSettings(join(project, ".claude", "settings.local.json")),
    project: readSettings(join(project, ".claude", "settings.json")),
    user: readSettings(join(configHome(env), "settings.json")),
  }
}

function readSettings(path: string): SettingsFile[] {
  let data: unknown
  try {
    data = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return []
  }
  if (typeof data !== "object" || data === null) return []
  const { autoMemoryDirectory, autoMemoryEnabled } = data as Record<string, unknown>
  return [
    {
      path,
      ...(typeof autoMemoryDirectory === "string" ? { autoMemoryDirectory } : {}),
      ...(typeof autoMemoryEnabled === "boolean" ? { autoMemoryEnabled } : {}),
    },
  ]
}

// memoryDirectory is autoMemoryDirectory from the trusted sources. Project
// settings are excluded, as in Claude Code: a cloned repository must not be
// able to point memory writes elsewhere.
export function memoryDirectory(settings: Settings, home: string): { dir: string; file: string } | undefined {
  for (const source of [settings.policy, settings.local, settings.user]) {
    for (const f of source) {
      if (f.autoMemoryDirectory) {
        const dir = validateMemoryPath(f.autoMemoryDirectory, home, true)
        return dir === undefined ? undefined : { dir, file: f.path }
      }
    }
  }
  return undefined
}

// autoMemoryDisabledBy applies Claude Code's switches for auto memory. It
// returns why memory is off, or undefined when it is on.
export function autoMemoryDisabledBy(env: Env, settings: Settings): string | undefined {
  const disable = env.vars["CLAUDE_CODE_DISABLE_AUTO_MEMORY"]
  if (disable !== undefined) {
    if (envTruthy(disable)) return "CLAUDE_CODE_DISABLE_AUTO_MEMORY is set"
    if (envFalsy(disable)) return undefined
  }
  if (envTruthy(env.vars["CLAUDE_CODE_SIMPLE"])) return "CLAUDE_CODE_SIMPLE is set"
  if (envTruthy(env.vars["CLAUDE_CODE_REMOTE"]) && !env.vars["CLAUDE_CODE_REMOTE_MEMORY_DIR"]) {
    return "CLAUDE_CODE_REMOTE is set without CLAUDE_CODE_REMOTE_MEMORY_DIR"
  }
  for (const source of [settings.policy, settings.local, settings.project, settings.user]) {
    for (const f of source) {
      if (f.autoMemoryEnabled !== undefined) {
        return f.autoMemoryEnabled ? undefined : `autoMemoryEnabled is false in ${f.path}`
      }
    }
  }
  return undefined
}

function envTruthy(v: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase())
}

function envFalsy(v: string | undefined): boolean {
  return ["0", "false", "no", "off"].includes((v ?? "").trim().toLowerCase())
}
