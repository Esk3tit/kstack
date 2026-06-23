#!/usr/bin/env bash
# One-time, idempotent setup for the no-mistakes skill.
# dev-browser IS the browser harness — this just ensures it (and chromium) exist.
# Portable: resolves nothing from a hardcoded path; safe to re-run.
set -euo pipefail

if ! command -v dev-browser >/dev/null 2>&1; then
  echo "no-mistakes: installing dev-browser (global) ..."
  npm install -g dev-browser
fi

echo "no-mistakes: ensuring chromium ..."
dev-browser install   # idempotent; downloads chromium if missing

if ! command -v gh >/dev/null 2>&1; then
  echo "no-mistakes: WARNING — gh CLI not found; PR evidence posting will be unavailable until 'gh' is installed and authenticated." >&2
fi

echo "no-mistakes: ready"
