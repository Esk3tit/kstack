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
    # An explicit RECAP_KEY reads that log alone (plus RECAP_PIN_KEYS), not the checkout's own logs.
    { if [ -z "${RECAP_KEY:-}" ] && [ -f "$KEYFILE" ]; then cat "$KEYFILE"; fi
      echo "$KEY"; printf '%s\n' ${RECAP_PIN_KEYS:-}; } \
      | awk 'NF && !seen[$0]++' | while read -r k; do
      f="$HOME/.local/share/recap/$k/decisions.tsv"
      if [ -f "$f" ]; then tail -n +2 "$f"; fi
    done | sort -s -t$'\t' -k1,1 | awk '!seen[$0]++' | awk -F'\t' '
      # Rows run in time order. Within one second a supersession waits for the decision it
      # replaces (only a true cycle falls back to write order), and retractions land last.
      function flush(   a, b, k, x, pick, blocked, left, g) {
        left = gn
        while (left) {
          pick = 0
          for (a = 1; a <= gn && !pick; a++) {
            k = gid[a]
            if (k in done) continue
            blocked = 0
            if (k in old) for (b = 1; b <= gn; b++) {
              x = gid[b]
              if (x != k && !(x in done) && dec[x] == old[k]) blocked = 1
            }
            if (!blocked) pick = k
          }
          if (!pick) for (a = 1; a <= gn; a++) if (!(gid[a] in done)) { pick = gid[a]; break }
          if (pick in old) for (x in live) if (dec[x] == old[pick]) delete live[x]
          live[pick] = 1; done[pick] = 1; left--
        }
        for (g in gone) for (x in live) if (dec[x] == g) delete live[x]
        split("", gone); gn = 0
      }
      # The first tag after "; " or ", " is the directive; everything after it is decision text.
      $10 ~ /^accepted/ {
        verb = ""
        if (match($10, /[;,] (supersedes|retracts): /)) {
          verb = substr($10, RSTART + 2, RLENGTH - 4); target = substr($10, RSTART + RLENGTH)
        }
        if ($4 != "you" && verb != "retracts") next
        if ($1 != cur) { flush(); cur = $1 }
        if (verb == "retracts") gone[target] = 1
        if ($4 == "you") {
          n++; gid[++gn] = n; dec[n] = $6; text[n] = "- " $6 " (" $7 ")"
          if (verb == "supersedes") old[n] = target
        }
      }
      END { flush(); for (i = 1; i <= n; i++) if (i in live) print text[i] }
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
