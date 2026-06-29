#!/usr/bin/env bash
set -euo pipefail

# Preflight check for no-mistakes-backend. Verifies the tooling the skill needs is on
# PATH and reports what's missing. Idempotent, read-only — installs nothing destructive.
# DB ground-truth runs through the configured DB MCP tools (run-sql / get-connection-string),
# which live in the Claude session, not on PATH — this script only checks the shell-side tools.

H="${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"

missing=0
# check <cmd> <note> <required|optional>: only a missing REQUIRED tool fails the check.
check() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '  ok   %-8s %s\n' "$1" "$($1 --version 2>/dev/null | head -n1 || echo present)"
  elif [ "$3" = "required" ]; then
    printf '  MISS %-8s %s\n' "$1" "$2"
    missing=1
  else
    printf '  --   %-8s %s\n' "$1" "$2"
  fi
}

echo ">> no-mistakes-backend tooling check"
check node "install Node 18+ (global fetch used by the harness)" required
check gh   "posts results to the PR (brew install gh)" required
check git  "repo/remote resolution" required

# The secrets tool comes from the project config (auth.profiles[].secretsTool). Only
# CLI-backed tools (e.g. doppler) need a binary on PATH; env/dotenv resolve in-process.
cfg_path="$(node "$H/harness/load-config.mjs" --path 2>/dev/null || true)"
if [ -n "$cfg_path" ]; then
  secrets_tools="$(node "$H/harness/load-config.mjs" --get auth.profiles 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s||"{}");process.stdout.write([...new Set(Object.values(p).map(x=>x&&x.secretsTool).filter(Boolean))].join(" "))}catch{}})' 2>/dev/null || true)"
  for t in $secrets_tools; do
    case "$t" in
      doppler) check doppler "secrets/auth resolution for an auth profile (brew install dopplerhq/cli/doppler)" required ;;
      *) : ;;  # env / dotenv resolve in-process — no binary to check
    esac
  done
else
  check doppler "common secrets tool; required only if your auth profile uses secretsTool=doppler" optional
fi

check psql "optional — async poll-until.mjs tight polling; without it the skill polls via the DB MCP run-sql tool" optional
check aws  "optional — only if evidence.backend=s3 (backend evidence is otherwise text)" optional

node_major="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]||0))' 2>/dev/null || echo 0)"
if [ "${node_major:-0}" -lt 18 ]; then
  echo "  WARN node is < 18 — the harness relies on global fetch (Node 18+)."
  missing=1
fi

echo
# Config presence is advisory here — the skill itself gates on it (reason=needs-config).
if [ -n "$cfg_path" ]; then
  printf '  ok   %-8s %s\n' "config" "$cfg_path"
else
  echo "  WARN no .no-mistakes.json resolved — the skill will BLOCK with reason=needs-config. See config/README.md and config/examples/."
fi

echo
if [ "$missing" -eq 0 ]; then
  echo ">> all required tooling present."
else
  echo ">> some required tooling is missing (see MISS above) — install before running the skill."
fi
echo ">> The configured DB MCP tools (run-sql / get-connection-string / describe-branch) must be reachable in the Claude session."
exit "$missing"
