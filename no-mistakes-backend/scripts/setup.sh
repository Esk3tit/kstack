#!/usr/bin/env bash
set -euo pipefail

# Preflight check for no-mistakes-backend. Verifies the tooling the skill needs is on
# PATH and reports what's missing. Idempotent, read-only — installs nothing destructive.
# DB ground-truth runs through the Neon MCP tools (run_sql / get_connection_string), which
# live in the Claude session, not on PATH — this script only checks the shell-side tools.

missing=0
check() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '  ok   %-8s %s\n' "$1" "$($1 --version 2>/dev/null | head -n1 || echo present)"
  else
    printf '  MISS %-8s %s\n' "$1" "$2"
    missing=1
  fi
}

echo ">> no-mistakes-backend tooling check"
check node    "required — install Node 18+ (global fetch used by the harness)"
check doppler "required — secrets/auth for both surfaces (brew install dopplerhq/cli/doppler)"
check gh      "required — posts results to the PR (brew install gh)"
check git     "required — repo/remote resolution"
check psql    "optional — only for async poll-until.mjs tight polling; without it the skill polls via Neon MCP run_sql"
check aws     "not needed — backend evidence is text (no S3, unlike no-mistakes)"

node_major="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]||0))' 2>/dev/null || echo 0)"
if [ "${node_major:-0}" -lt 18 ]; then
  echo "  WARN node is < 18 — the harness relies on global fetch (Node 18+)."
  missing=1
fi

echo
if [ "$missing" -eq 0 ]; then
  echo ">> all required tooling present."
else
  echo ">> some required tooling is missing (see MISS above) — install before running the skill."
fi
echo ">> Neon MCP tools (run_sql / get_connection_string / describe_branch) must be reachable in the Claude session."
exit 0
