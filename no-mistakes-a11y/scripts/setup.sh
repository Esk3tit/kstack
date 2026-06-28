#!/usr/bin/env bash
# One-time, idempotent setup for the no-mistakes-a11y skill.
# Ensures dev-browser (the interaction harness) + chromium exist, vendors axe-core, and
# checks gh for PR posting. Portable: resolves nothing from a hardcoded path; safe to re-run.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v dev-browser >/dev/null 2>&1; then
  echo "no-mistakes-a11y: installing dev-browser (global) ..."
  npm install -g dev-browser
fi

echo "no-mistakes-a11y: ensuring chromium ..."
dev-browser install   # idempotent; downloads chromium if missing

# Static WCAG layer — vendor the pinned axe-core bundle. Non-fatal: the interaction axes
# (keyboard / focus / reflow) are the headline and run without it (skill notes axe=skipped).
if [ -s "$DIR/harness/axe.min.js" ]; then
  echo "no-mistakes-a11y: axe-core already vendored"
else
  echo "no-mistakes-a11y: vendoring axe-core ..."
  if ! bash "$DIR/scripts/vendor-axe.sh"; then
    echo "no-mistakes-a11y: WARNING — could not vendor axe-core (offline?); the static WCAG layer will be skipped at run time." >&2
  fi
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "no-mistakes-a11y: WARNING — gh CLI not found; PR evidence posting will be unavailable until 'gh' is installed and authenticated." >&2
fi

echo "no-mistakes-a11y: ready"
