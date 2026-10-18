#!/usr/bin/env bash
# Decision log helper; format in LEDGER.md beside this script.
#   log.sh <phase> <source> <asked> <decision> <why> <prod_delta> <evidence> <result>
#   log.sh --path    print the log path for the current branch
#   log.sh --pins    print the user's settled decisions, one "- " line each
set -euo pipefail

HEADER=$'ts\trepo\tphase\tsource\tasked\tdecision\twhy\tprod_delta\tevidence\tresult'

ticket_in() {
  printf '%s\n' "$1" | grep -oiE "(^|[^[:alnum:]])${RECAP_TICKET_RE:-pro-[0-9]+}([^[:alnum:]]|$)" | head -1 \
    | sed -E 's/^[^[:alnum:]]//; s/[^[:alnum:]]$//' | tr '[:lower:]' '[:upper:]' || true
}

repo=$(basename -s .git "$(git remote get-url origin 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || pwd)")

# A branch keeps the key it first resolved to, so a later ticketed commit cannot move its log.
log_key() {
  local branch base key keyfile
  branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null \
    || git rev-parse --short HEAD 2>/dev/null || echo no-branch)
  keyfile="$HOME/.local/share/recap/.branch-keys/$repo--$(echo "$branch" | tr '/' '-')"
  if [ -n "${RECAP_KEY:-}" ]; then
    key=$RECAP_KEY
  elif [ -s "$keyfile" ]; then
    cat "$keyfile"; return
  else
    key=$(ticket_in "$branch")
    if [ -z "$key" ]; then
      base=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/master)
      key=$(ticket_in "$(git log --reverse --format=%s "$base..HEAD" 2>/dev/null)")
    fi
    [ -n "$key" ] || key=$(echo "$branch" | tr '/' '-')
  fi
  mkdir -p "$(dirname "$keyfile")"
  echo "$key" > "$keyfile"
  echo "$key"
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
# noclobber: of two first writers, only one creates the file and writes the header.
( set -o noclobber; echo "$HEADER" > "$LOG" ) 2>/dev/null || true
row="$(date -u +%Y-%m-%dT%H:%M:%SZ)"$'\t'"$repo"
for cell in "$@"; do row+=$'\t'"$(clean "$cell")"; done
echo "$row" >> "$LOG"
