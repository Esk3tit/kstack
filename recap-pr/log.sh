#!/usr/bin/env bash
# Decision log helper; format in LEDGER.md beside this script.
#   log.sh <phase> <source> <asked> <decision> <why> <prod_delta> <evidence> <result>
#   log.sh --path    print the log path for the current branch
#   log.sh --pins    print the user's settled decisions, one "- " line each (RECAP_PIN_KEYS adds logs)
#   log.sh --bind K  point the current branch at log K from now on (earlier rows stay where they are)
set -euo pipefail

HEADER=$'ts\trepo\tphase\tsource\tasked\tdecision\twhy\tprod_delta\tevidence\tresult'

ticket_in() {
  printf '%s\n' "$1" | grep -oiE "(^|[^[:alnum:]])${RECAP_TICKET_RE:-pro-[0-9]+}([^[:alnum:]]|$)" | head -1 \
    | sed -E 's/^[^[:alnum:]]//; s/[^[:alnum:]]$//' | tr '[:lower:]' '[:upper:]' || true
}

repo=$(basename -s .git "$(git remote get-url origin 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || pwd)")

branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null \
  || git rev-parse --short HEAD 2>/dev/null || echo no-branch)
# Percent-encoded so distinct branches (feat/a-b, feat-a/b) never share a file name.
branch_id=$(printf '%s' "$branch" | sed 's/%/%25/g; s#/#%2F#g')
KEYFILES="$HOME/.local/share/recap/.branch-keys"
KEYFILE="$KEYFILES/$repo--$branch_id"

# The key file lists every key the branch has logged under, newest last; the newest one is current.
log_key() {
  local base key keyfile=$KEYFILE
  if [ -n "${RECAP_KEY:-}" ]; then
    key=$RECAP_KEY
  elif [ -s "$keyfile" ]; then
    tail -1 "$keyfile"; return
  else
    key=$(ticket_in "$branch")
    if [ -z "$key" ]; then
      base=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/master)
      key=$(ticket_in "$(git log --reverse --format=%s "$base..HEAD" 2>/dev/null)")
    fi
    [ -n "$key" ] || key="$repo-$branch_id"
  fi
  echo "$key"
}

KEY=$(log_key)
LOG="$HOME/.local/share/recap/$KEY/decisions.tsv"

case "${1:-}" in
  --path) echo "$LOG"; exit 0 ;;
  --bind)
    mkdir -p "$KEYFILES"
    [ -s "$KEYFILE" ] && [ "$(tail -1 "$KEYFILE")" = "${2:?usage: log.sh --bind <key>}" ] \
      || echo "${2:?usage: log.sh --bind <key>}" >> "$KEYFILE"
    new="$HOME/.local/share/recap/$2/decisions.tsv"
    echo "$new"; exit 0 ;;
  --pins)
    { [ -f "$KEYFILE" ] && cat "$KEYFILE"; echo "$KEY"; printf '%s\n' ${RECAP_PIN_KEYS:-}; } \
      | awk 'NF && !seen[$0]++' | while read -r k; do
      f="$HOME/.local/share/recap/$k/decisions.tsv"
      if [ -f "$f" ]; then tail -n +2 "$f"; fi
    done | sort -s -t$'\t' -k1,1 | awk '!seen[$0]++' | awk -F'\t' '
      $4 == "you" && $10 ~ /^accepted/ {
        n++; ts[n] = $1; decision[n] = $6; text[n] = "- " $6 " (" $7 ")"
        if (match($10, /supersedes: .*$/)) old[n] = substr($10, RSTART + 12)
      }
      # A supersession removes the named decision when logged earlier or in the same second,
      # whichever log it came from; two rows that supersede each other in one second keep the later.
      END {
        for (i = 1; i <= n; i++) if (i in old)
          for (j = 1; j <= n; j++)
            if (j != i && decision[j] == old[i] && (ts[j] < ts[i] || \
                (ts[j] == ts[i] && !((j in old) && old[j] == decision[i] && j > i))))
              gone[j] = 1
        for (i = 1; i <= n; i++) if (!(i in gone)) print text[i]
      }
    '
    exit 0 ;;
esac

[ "$#" -eq 8 ] || { echo "usage: log.sh <phase> <source> <asked> <decision> <why> <prod_delta> <evidence> <result>" >&2; exit 2; }

clean() { printf '%s' "$1" | tr '\t\r\n' '   '; }

mkdir -p "$(dirname "$LOG")"
# Only a derived key registers the branch; an explicit RECAP_KEY routes this row without binding.
if [ -z "${RECAP_KEY:-}" ] && [ ! -s "$KEYFILE" ]; then
  mkdir -p "$(dirname "$KEYFILE")"
  echo "$KEY" > "$KEYFILE"
fi
# The header is written to a temp file and hard-linked into place, so the log never exists without it.
if [ ! -e "$LOG" ]; then
  tmp=$(mktemp "$LOG.XXXXXX")
  echo "$HEADER" > "$tmp"
  ln "$tmp" "$LOG" 2>/dev/null || true
  rm -f "$tmp"
fi
# RECAP_TS keeps a backfilled row at its original time; one UTC format keeps rows sortable as text.
ts="${RECAP_TS:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
[[ "$ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || { echo "RECAP_TS must be UTC YYYY-MM-DDTHH:MM:SSZ, got: $ts" >&2; exit 2; }
row="$ts"$'\t'"$repo"
for cell in "$@"; do row+=$'\t'"$(clean "$cell")"; done
echo "$row" >> "$LOG"
