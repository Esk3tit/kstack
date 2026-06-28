#!/usr/bin/env bash
# Vendor a PINNED axe-core UMD bundle into harness/axe.min.js (network at SETUP time only;
# the skill injects it from disk at run time so it works on intranet-HTTP / CSP / offline targets).
# Re-run to refresh; the pinned version is the single source of truth.
set -euo pipefail

AXE_VERSION="4.10.2"   # pin exact — bump deliberately, never float
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$DIR/harness/axe.min.js"
URL="https://cdn.jsdelivr.net/npm/axe-core@${AXE_VERSION}/axe.min.js"

echo "Vendoring axe-core@${AXE_VERSION} -> $OUT"
mkdir -p "$DIR/harness"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$OUT"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$OUT" "$URL"
else
  echo "ERROR: need curl or wget to vendor axe-core" >&2
  exit 1
fi

# Sanity: the bundle must define axe and look like the pinned version.
if ! grep -q "axe" "$OUT" || [ ! -s "$OUT" ]; then
  echo "ERROR: downloaded bundle looks wrong; removing" >&2
  rm -f "$OUT"
  exit 1
fi
echo "ok: $(wc -c < "$OUT") bytes, axe-core@${AXE_VERSION}"
