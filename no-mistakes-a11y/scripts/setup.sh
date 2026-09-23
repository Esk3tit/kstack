#!/usr/bin/env bash
# One-time, idempotent setup for the no-mistakes-a11y skill: agent-browser (the interaction harness,
# with axe-core built in) + its Chrome, and gh for PR posting. Portable; safe to re-run.
set -euo pipefail

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "no-mistakes-a11y: installing agent-browser (global) ..."
  npm install -g agent-browser
fi
agent-browser install   # idempotent; downloads Chrome if missing

if ! command -v gh >/dev/null 2>&1; then
  echo "no-mistakes-a11y: WARNING — gh CLI not found; PR evidence posting will be unavailable until 'gh' is installed and authenticated." >&2
fi

echo "no-mistakes-a11y: ready"
