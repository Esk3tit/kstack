#!/usr/bin/env bash
set -uo pipefail

# Preflight for no-mistakes: checks the shell tooling AND that the two sibling
# skills it composes (no-mistakes + no-mistakes-backend) are installed. Read-only — it
# reports; the skill's own preflight offers to install a missing sibling from kstack.
# Exits nonzero if a REQUIRED tool or a sibling skill is missing.

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

echo ">> no-mistakes (router) tooling check"
check node     "install Node 18+ (harness scripts use global fetch)" required
check porter   "resolve the preview env (porter app manifests / kubectl)" required
check gh       "post the combined verdict to both PRs" required
check git      "repo/branch/PR resolution" required
check dev-browser "drive the frontend UI for round-trip cases" required
check neonctl  "optional CLI fallback for Neon branch resolution; Neon MCP (in-session) is preferred" optional
check psql     "optional — async DB poll-until tight polling (else Neon MCP run_sql loop)" optional

echo
echo ">> sibling skills (composed by this coordinator)"
sib_check() {  # <skill-dir-name>
  local d="$SKILLS_DIR/$1"
  if [ -d "$d" ] && [ -d "$d/harness" ]; then
    printf '  ok   %-20s %s\n' "$1" "$d"
  else
    printf '  MISS %-20s not installed — install from kstack: cp -R ~/PromptArmor/kstack/%s %s/\n' "$1" "$1" "$SKILLS_DIR"
    missing=1
  fi
}
sib_check no-mistakes-frontend
sib_check no-mistakes-backend

echo
if [ "$missing" -eq 0 ]; then
  echo ">> all required tooling + sibling skills present."
else
  echo ">> missing required tooling or a sibling skill (see MISS above)."
  echo "   For a missing sibling, the skill's preflight will offer to install it from"
  echo "   ~/PromptArmor/kstack (clone promptarmor/kstack first if you don't have it)."
fi
echo ">> Reminder: preview ClusterIPs need the un-sandboxed VPN network; Neon MCP must be reachable in the Claude session."
exit "$missing"
