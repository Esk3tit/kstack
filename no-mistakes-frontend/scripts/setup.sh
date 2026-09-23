#!/usr/bin/env bash
# One-time, idempotent setup for the no-mistakes skill: agent-browser (the browser driver) + its
# Chrome, gh for PR posting, ffmpeg for clips. Portable: resolves nothing from a hardcoded path.
set -euo pipefail

have() { command -v "$1" >/dev/null 2>&1; }

if ! have agent-browser; then
  echo "no-mistakes: installing agent-browser (global) ..."
  npm install -g agent-browser
fi
agent-browser install   # idempotent; downloads Chrome if missing
echo "no-mistakes: browser driver = agent-browser $(agent-browser --version | awk '{print $2}')"

if ! have gh; then
  echo "no-mistakes: WARNING — gh CLI not found; PR evidence posting will be unavailable until 'gh' is installed and authenticated." >&2
elif ! gh pr comment --help 2>/dev/null | grep -- '--attach' >/dev/null; then
  echo "no-mistakes: WARNING — gh $(gh --version | head -n1 | awk '{print $3}') has no --attach; upgrade to gh >= 2.99 to post screenshots and clips." >&2
fi

if ! have ffmpeg; then
  echo "no-mistakes: NOTE — clips need ffmpeg (brew install ffmpeg). Screenshots work without it." >&2
fi

echo "no-mistakes: ready"
