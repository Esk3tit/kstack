#!/usr/bin/env bash
# One-time, idempotent setup for the no-mistakes skill.
# The browser harness is EITHER dev-browser (default) OR chrome-devtools-axi.
# Set NM_BROWSER_DRIVER=chrome-devtools-axi to prefer the latter; otherwise an
# already-installed chrome-devtools-axi is used, else dev-browser is ensured.
# Portable: resolves nothing from a hardcoded path; safe to re-run.
set -euo pipefail

have() { command -v "$1" >/dev/null 2>&1; }
DRIVER="${NM_BROWSER_DRIVER:-}"

# Pick chrome-devtools-axi when explicitly preferred, or when it's the only
# driver already present.
if [ "$DRIVER" = chrome-devtools-axi ] || { [ -z "$DRIVER" ] && have chrome-devtools-axi && ! have dev-browser; }; then
  if have chrome-devtools-axi; then
    echo "no-mistakes: browser driver = chrome-devtools-axi ($(chrome-devtools-axi --version 2>/dev/null | head -n1))"
  else
    # AXI: no global install needed — it runs on demand via npx.
    echo "no-mistakes: browser driver = chrome-devtools-axi (on-demand via 'npx -y chrome-devtools-axi')"
  fi
else
  if ! have dev-browser; then
    echo "no-mistakes: installing dev-browser (global) ..."
    npm install -g dev-browser
  fi
  echo "no-mistakes: ensuring chromium ..."
  dev-browser install   # idempotent; downloads chromium if missing
  echo "no-mistakes: browser driver = dev-browser"
fi

if ! have gh; then
  echo "no-mistakes: WARNING — gh CLI not found; PR evidence posting will be unavailable until 'gh' is installed and authenticated." >&2
elif ! gh pr comment --help 2>/dev/null | grep -- '--attach' >/dev/null; then
  echo "no-mistakes: WARNING — gh $(gh --version | head -n1 | awk '{print $3}') has no --attach; upgrade to gh >= 2.99 to post screenshots and clips." >&2
fi

if ! have agent-browser || ! have ffmpeg; then
  echo "no-mistakes: NOTE — video clips need agent-browser (>= 0.37) and ffmpeg: npm i -g agent-browser && brew install ffmpeg. Screenshots work without them." >&2
fi

echo "no-mistakes: ready"
