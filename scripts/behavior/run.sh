#!/usr/bin/env bash
# Runs one behavior scenario against one agent inside a throwaway root: the
# memory directory, the project, and the agent's own sessions, settings and
# caches all live under it, and it is removed when the run ends. Only the
# results directory is kept.
#
#   scripts/behavior/run.sh <pi|opencode|dsh|claude> <scenario> [--npm]
#
# --npm installs the published plugin instead of loading the checkout.
# CC_MEM_TEST_API_KEY must hold an OpenCode Go API key (not needed for
# claude). CC_MEM_TEST_MODEL overrides the model, CC_MEM_TEST_VERSION the
# npm version, and CC_MEM_DSH the path of the dsh binary.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
agent=${1:-}
scenario=${2:-}
from=repo
[ "${3:-}" = --npm ] && from=npm

die() { echo "run.sh: $*" >&2; exit 2; }
case $agent in pi | opencode | dsh | claude) ;; *) die "agent must be pi, opencode, dsh or claude" ;; esac
prompt=$(awk -F'\t' -v s="$scenario" '$1 == s { print $2 }' "$here/scenarios.tsv")
[ -n "$prompt" ] || die "unknown scenario '$scenario'; see scenarios.tsv"
[ "$agent" = claude ] || [ -n "${CC_MEM_TEST_API_KEY:-}" ] || die "set CC_MEM_TEST_API_KEY to an OpenCode Go API key"
model=${CC_MEM_TEST_MODEL:-deepseek-v4.1-flash}

# Pin the published version, so a stale npm or pnpm metadata cache cannot
# hand out an older one.
version=
if [ "$from" = npm ]; then
  version=${CC_MEM_TEST_VERSION:-$(npm view @cc-mem/core version --prefer-online)}
fi

limited() { if command -v timeout > /dev/null; then timeout 300 "$@"; else "$@"; fi; }

root=$(mktemp -d "${TMPDIR:-/tmp}/cc-mem-behavior.XXXXXX")
cleanup() { [ -n "$root" ] && [ -d "$root" ] && rm -rf "$root"; }
trap cleanup EXIT
mkdir -p "$root/memory" "$root/project"
cp -R "$here/seed/." "$root/memory/"
cp -R "$here/project/." "$root/project/"
export CLAUDE_COWORK_MEMORY_PATH_OVERRIDE="$root/memory"

out="$here/results/$(date +%Y%m%d-%H%M%S)-$agent-$scenario"
mkdir -p "$out"
cd "$root/project"
status=0

case $agent in
pi)
  export PI_CODING_AGENT_DIR="$root/pi" PI_SKIP_VERSION_CHECK=1
  mkdir -p "$PI_CODING_AGENT_DIR"
  printf '{"opencode-go":{"type":"api_key","key":"!printenv CC_MEM_TEST_API_KEY"}}\n' > "$PI_CODING_AGENT_DIR/auth.json"
  extension=()
  if [ "$from" = npm ]; then
    pi install "npm:@cc-mem/pi@$version" > "$out/install.log" 2>&1 ||
      die "installing @cc-mem/pi@$version failed; see $out/install.log"
  else
    extension=(--extension "$repo/packages/pi")
  fi
  limited pi -p --mode json --no-session --no-mcp ${extension[@]+"${extension[@]}"} --model "opencode-go/$model" "$prompt" \
    < /dev/null > "$out/events.jsonl" 2> "$out/stderr.log" || status=$?
  ;;
opencode)
  export XDG_DATA_HOME="$root/xdg/data" XDG_CONFIG_HOME="$root/xdg/config"
  export XDG_CACHE_HOME="$root/xdg/cache" XDG_STATE_HOME="$root/xdg/state"
  plugin="$repo/packages/opencode"
  [ "$from" = npm ] && plugin="@cc-mem/opencode@$version"
  export OPENCODE_CONFIG_CONTENT="{\"\$schema\":\"https://opencode.ai/config.json\",\"plugins\":[\"$plugin\"],\"provider\":{\"opencode-go\":{\"options\":{\"apiKey\":\"{env:CC_MEM_TEST_API_KEY}\"}}}}"
  limited opencode run --standalone -m "opencode-go/$model" --format json "$prompt" \
    < /dev/null > "$out/events.jsonl" 2> "$out/stderr.log" || status=$?
  ;;
dsh)
  dsh=${CC_MEM_DSH:-$(command -v dsh || echo "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh")}
  export DSH_HOME="$root/dsh" DEEPSEEK_API_KEY="$CC_MEM_TEST_API_KEY"
  patch="$root/patch.yml"
  cat > "$patch" << EOF
- id: llm-deepseek
  name: "@deepseek-ai/dsh-llm-deepseek-api-key"
  config:
    baseURL: https://opencode.ai/inference/go
- id: credentials
  disabled: false
- id: authorization
  disabled: false
- id: deepseek-account
  disabled: false
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: deepseek-official
    model: $model
EOF
  if [ "$from" = npm ]; then
    # A plugin's peers resolve only when it is installed into a profile;
    # the first use of the shipped headless profile under DSH_HOME sets it up.
    "$dsh" plugin --profile headless add "@cc-mem/dsh@$version" > "$out/install.log" 2>&1 ||
      die "installing @cc-mem/dsh@$version failed; see $out/install.log"
  else
    [ -f "$repo/packages/dsh/dist/index.js" ] || die "build the plugin first: bun run build"
    printf -- '- insert:\n    - id: cc-mem\n      name: "%s"\n' "$repo/packages/dsh/dist/index.js" >> "$patch"
  fi
  limited "$dsh" headless --patch "$patch" --json "$prompt" \
    < /dev/null > "$out/events.jsonl" 2> "$out/stderr.log" || status=$?
  ;;
claude)
  # Claude Code itself, as the baseline: its own memory tools are Write and
  # Edit; Bash stays off so it cannot touch anything else.
  limited claude -p "$prompt" --model "${CC_MEM_TEST_CLAUDE_MODEL:-haiku}" --no-session-persistence \
    --output-format stream-json --verbose --allowedTools Read Write Edit Glob Grep --disallowedTools Bash \
    < /dev/null > "$out/events.jsonl" 2> "$out/stderr.log" || status=$?
  ;;
esac

cp -R "$root/memory" "$out/memory"
printf '{"agent":"%s","scenario":"%s","from":"%s","version":"%s","model":"%s","root":"%s","exit":%d}\n' \
  "$agent" "$scenario" "$from" "$version" "$model" "$root" "$status" > "$out/meta.json"
node "$here/analyze.mjs" "$out" || true
