#!/usr/bin/env bash
# One-time, idempotent setup for the no-mistakes-a11y skill: agent-browser (the interaction harness,
# with axe-core built in) + its Chrome, and gh for PR posting. Portable; safe to re-run.
set -euo pipefail

ab_current() { command -v agent-browser >/dev/null 2>&1 && node -e 'const [a, b] = process.argv[1].split(".").map(Number); process.exit(a > 0 || b >= 37 ? 0 : 1)' "$(agent-browser --version | awk '{print $2}')"; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' || { echo "no-mistakes-a11y: agent-browser needs Node 24+ (found $(node --version))" >&2; exit 1; }
if ! ab_current; then
  echo "no-mistakes-a11y: installing agent-browser >= 0.37 (global) ..."
  npm install -g agent-browser@latest
fi
agent-browser install $([ "$(uname -s)" = Linux ] && echo --with-deps)   # idempotent; Linux also gets Chrome's system libraries

if ! command -v gh >/dev/null 2>&1; then
  echo "no-mistakes-a11y: WARNING — gh CLI not found; PR evidence posting will be unavailable until 'gh' is installed and authenticated." >&2
elif ! gh pr comment --help 2>/dev/null | grep -- '--attach' >/dev/null; then
  echo "no-mistakes-a11y: WARNING — gh $(gh --version | head -n1 | awk '{print $3}') has no --attach; upgrade to gh >= 2.99 to post screenshots." >&2
fi

echo "no-mistakes-a11y: ready"
