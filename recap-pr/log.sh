#!/usr/bin/env bash
# Decision log helper; format in LEDGER.md beside this script.
#   log.sh <phase> <source> <asked> <decision> <why> <prod_delta> <evidence> <result>
#   log.sh --path    print the log path for the current branch
#   log.sh --pins    print the user's settled decisions, one "- " line each
set -euo pipefail

HEADER=$'ts\trepo\tphase\tsource\tasked\tdecision\twhy\tprod_delta\tevidence\tresult'

log_key() {
  if [ -n "${RECAP_KEY:-}" ]; then echo "$RECAP_KEY"; return; fi
  local branch base ticket
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-branch")
  ticket=$(printf '%s' "$branch" | grep -oiE 'pro-[0-9]+' | head -1 || true)
  if [ -z "$ticket" ]; then
    base=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/master)
    ticket=$(git log --format=%s "$base..HEAD" 2>/dev/null | grep -oiE 'pro-[0-9]+' | head -1 || true)
  fi
  if [ -n "$ticket" ]; then echo "$ticket" | tr '[:lower:]' '[:upper:]'; else echo "$branch" | tr '/' '-'; fi
}

LOG="$HOME/.local/share/recap/$(log_key)/decisions.tsv"

case "${1:-}" in
  --path) echo "$LOG"; exit 0 ;;
  --pins)
    [ -f "$LOG" ] && awk -F'\t' 'NR > 1 && $4 == "you" { print "- " $6 " (" $7 ")" }' "$LOG"
    exit 0 ;;
esac

[ "$#" -eq 8 ] || { echo "usage: log.sh <phase> <source> <asked> <decision> <why> <prod_delta> <evidence> <result>" >&2; exit 2; }

clean() { printf '%s' "$1" | tr '\t\r\n' '   '; }

mkdir -p "$(dirname "$LOG")"
[ -s "$LOG" ] || echo "$HEADER" > "$LOG"
repo=$(basename -s .git "$(git remote get-url origin 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || pwd)")
row="$(date -u +%Y-%m-%dT%H:%M:%SZ)"$'\t'"$repo"
for cell in "$@"; do row+=$'\t'"$(clean "$cell")"; done
echo "$row" >> "$LOG"
