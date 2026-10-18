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

branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null \
  || git rev-parse --short HEAD 2>/dev/null || echo no-branch)
KEYFILE="$HOME/.local/share/recap/.branch-keys/$repo--$(echo "$branch" | tr '/' '-')"

# A branch keeps the key its first row was written under, so a later ticketed commit cannot move its log.
log_key() {
  local base key keyfile=$KEYFILE
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
    [ -n "$key" ] || key="$repo-$(echo "$branch" | tr '/' '-')"
  fi
  echo "$key"
}

KEY=$(log_key)
LOG="$HOME/.local/share/recap/$KEY/decisions.tsv"

case "${1:-}" in
  --path) echo "$LOG"; exit 0 ;;
  --pins)
    [ -f "$LOG" ] && awk -F'\t' '
      NR > 1 && $4 == "you" && $10 ~ /^accepted/ {
        if (match($10, /supersedes: .*$/)) {
          old = substr($10, RSTART + 12)
          for (j in decision) if (decision[j] == old) { delete decision[j]; delete text[j] }
        }
        decision[NR] = $6; text[NR] = "- " $6 " (" $7 ")"
      }
      END { for (i = 1; i <= NR; i++) if (i in text) print text[i] }
    ' "$LOG"
    exit 0 ;;
esac

[ "$#" -eq 8 ] || { echo "usage: log.sh <phase> <source> <asked> <decision> <why> <prod_delta> <evidence> <result>" >&2; exit 2; }

clean() { printf '%s' "$1" | tr '\t\r\n' '   '; }

mkdir -p "$(dirname "$LOG")" "$(dirname "$KEYFILE")"
echo "$KEY" > "$KEYFILE"
# The header is written to a temp file and hard-linked into place, so the log never exists without it.
if [ ! -e "$LOG" ]; then
  tmp=$(mktemp "$LOG.XXXXXX")
  echo "$HEADER" > "$tmp"
  ln "$tmp" "$LOG" 2>/dev/null || true
  rm -f "$tmp"
fi
row="$(date -u +%Y-%m-%dT%H:%M:%SZ)"$'\t'"$repo"
for cell in "$@"; do row+=$'\t'"$(clean "$cell")"; done
echo "$row" >> "$LOG"
