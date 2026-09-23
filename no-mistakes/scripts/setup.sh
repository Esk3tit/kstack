#!/usr/bin/env bash
set -uo pipefail

# Preflight for no-mistakes: checks the shell tooling AND that the two sibling
# skills it composes (no-mistakes-frontend + no-mistakes-backend) are installed. Read-only — it
# reports; the skill's own preflight offers to install a missing sibling from the skills repo.
# Exits nonzero if a REQUIRED tool or a sibling skill is missing.

H="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/no-mistakes}"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
missing=0

# check <cmd> <note> <required|optional>
check() {
  if command -v "$1" >/dev/null 2>&1; then
    local v=present
    if out=$("$1" --version 2>/dev/null) && [ -n "$out" ]; then v=$(printf '%s' "$out" | head -n1); fi
    printf '  ok   %-9s %s\n' "$1" "$v"
  elif [ "$3" = required ]; then
    printf '  MISS %-9s %s\n' "$1" "$2"; missing=1
  else
    printf '  --   %-9s %s\n' "$1" "$2"
  fi
}

# check_any <label> <note> <required|optional> <cmd...> — ok if ANY cmd is on PATH.
# Used for the browser driver, which can be dev-browser OR chrome-devtools-axi.
check_any() {
  local label="$1" note="$2" req="$3"; shift 3
  local found=""
  for c in "$@"; do
    if command -v "$c" >/dev/null 2>&1; then found="$c"; break; fi
  done
  if [ -n "$found" ]; then
    printf '  ok   %-9s %s\n' "$label" "$found"
  elif [ "$req" = required ]; then
    printf '  MISS %-9s %s\n' "$label" "$note"; missing=1
  else
    printf '  --   %-9s %s\n' "$label" "$note"
  fi
}

echo ">> no-mistakes (router) tooling check"
check node     "install Node 18+ (harness scripts use global fetch)" required
check porter   "resolve the preview env (porter app manifests / kubectl)" required
check gh       "post the combined verdict to both PRs (>= 2.99 for --attach media)" required
if command -v gh >/dev/null 2>&1 && ! gh pr comment --help 2>/dev/null | grep -- '--attach' >/dev/null; then
  printf '  MISS %-9s %s\n' "gh-attach" "gh is too old for --attach; upgrade to gh >= 2.99"; missing=1
fi
check git      "repo/branch/PR resolution" required
check_any browser "drive the frontend UI — install dev-browser OR chrome-devtools-axi" required dev-browser chrome-devtools-axi
check neonctl  "optional CLI fallback for preview DB branch resolution; the DB MCP (in-session) is preferred" optional
check agent-browser "optional — records interaction clips (>= 0.37)" optional
check ffmpeg   "optional — encodes agent-browser clips" optional
check psql     "optional — async DB poll-until tight polling (else the DB MCP run-SQL loop)" optional

echo
echo ">> sibling skills (composed by this coordinator)"
sib_check() {  # <skill-dir-name>
  local d="$SKILLS_DIR/$1"
  if [ -d "$d" ] && [ -d "$d/harness" ]; then
    printf '  ok   %-20s %s\n' "$1" "$d"
  else
    printf '  MISS %-20s not installed — install from the kstack skills repo: cp -R <kstack-checkout>/%s %s/\n' "$1" "$1" "$SKILLS_DIR"
    missing=1
  fi
}
sib_check no-mistakes-frontend
sib_check no-mistakes-backend

echo
echo ">> project config"
if cfg="$(node "$H/harness/load-config.mjs" --path 2>/dev/null)" && [ -n "$cfg" ]; then
  printf '  ok   %-20s %s\n' "config" "$cfg"
else
  printf '  --   %-20s no .no-mistakes.json resolved — see config/README.md (skill BLOCKs reason=needs-config)\n' "config"
fi

echo
if [ "$missing" -eq 0 ]; then
  echo ">> all required tooling + sibling skills present."
else
  echo ">> missing required tooling or a sibling skill (see MISS above)."
  echo "   For a missing sibling, the skill's preflight will offer to install it from"
  echo "   the kstack skills repo (clone it first if you don't have a checkout)."
fi
echo ">> Reminder: preview ClusterIPs need the un-sandboxed VPN network; the DB MCP must be reachable in the Claude session."
exit "$missing"
