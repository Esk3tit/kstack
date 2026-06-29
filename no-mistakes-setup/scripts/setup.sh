#!/usr/bin/env bash
# Tooling check for no-mistakes-setup. The setup scripts live in the router skill (installed as a family).
set -u

NM="${NM:-$HOME/.claude/skills/no-mistakes/harness}"
ok=0

check() { if eval "$2" >/dev/null 2>&1; then echo "  ok    $1"; else echo "  MISS  $1 — $3"; ok=1; fi; }

echo "no-mistakes-setup preflight:"
check "node"                 "command -v node"                 "install Node 20+"
check "router setup.mjs"     "[ -f \"$NM/setup.mjs\" ]"        "install the no-mistakes (router) skill"
check "router detect.mjs"    "[ -f \"$NM/detect.mjs\" ]"       "install the no-mistakes (router) skill"
check "router load-config"   "[ -f \"$NM/load-config.mjs\" ]"  "install the no-mistakes (router) skill"

if [ -f "$PWD/.no-mistakes.json" ]; then
  echo "  note  $PWD/.no-mistakes.json already exists — setup will ask before overwriting (or pass --force)."
fi

exit $ok
