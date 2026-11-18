#!/usr/bin/env bash
# Decision log helper; format in LEDGER.md beside this script.
#   log.sh <phase> <source> <asked> <decision> <why> <prod_delta> <evidence> <result>
#   log.sh --path    print the log path for the current branch
#   log.sh --pins    print the user's settled decisions, one "- " line each (RECAP_PIN_KEYS adds logs)
#   log.sh --bind K  point the current branch at log K from now on (earlier rows stay where they are)
#   log.sh --rounds  print this branch's last two /codexloop round rows, then "next round <n>"; exit 1 while
#                    a dispatched round has no round or dropped row
#   log.sh --rejected  print this branch's /codexloop findings whose latest row rejects them, one "- " line each
#   log.sh --pass <pass> <head> <clean|fixed|not-reviewed> [<PR body file it read>]  record a review pass
#   log.sh --check <head> [<PR number | body file>]  check the passes every PR needs (standards, spec against
#                    the PR body, codexloop): exit 1, naming each, unless all are clean there (or when a PR number's
#                    head is another commit); exit 3 when the only ones left are recorded not-reviewed on it; exit 2
#                    when it cannot run. Other passes, such as fable, are listed with the head they last read.
#   log.sh --body-hash <file>  print the hash --pass and --check keep for a PR body
set -euo pipefail

HEADER=$'ts\trepo\tphase\tsource\tasked\tdecision\twhy\tprod_delta\tevidence\tresult'
PASS_HEADER=$'ts\trepo\tbranch\tpass\thead\tverdict\tbody'

die() { echo "log.sh: $*" >&2; exit 2; }

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
PASSES="$(dirname "$LOG")/reviews.tsv"

# Every key this checkout's branch has logged under, plus the current one. An explicit RECAP_KEY
# stands alone: it reads that log, not the checkout's own.
branch_keys() {
  { if [ -z "${RECAP_KEY:-}" ] && [ -f "$KEYFILE" ]; then cat "$KEYFILE"; fi; echo "$KEY"; } | awk 'NF && !seen[$0]++'
}

# Only a derived key registers the branch; an explicit RECAP_KEY routes this row without binding.
register_key() {
  if [ -z "${RECAP_KEY:-}" ] && [ ! -s "$KEYFILE" ]; then
    mkdir -p "$(dirname "$KEYFILE")"
    echo "$KEY" > "$KEYFILE"
  fi
}

# The header is written to a temp file and hard-linked into place, so the file never exists without it.
ensure_header() {
  mkdir -p "$(dirname "$1")"
  if [ ! -e "$1" ]; then
    local tmp
    tmp=$(mktemp "$1.XXXXXX")
    echo "$2" > "$tmp"
    ln "$tmp" "$1" 2>/dev/null || true
    rm -f "$tmp"
  fi
}

# RECAP_TS keeps a backfilled row at its original time; one UTC format keeps rows sortable as text.
stamp() {
  local ts="${RECAP_TS:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
  [[ "$ts" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || { echo "RECAP_TS must be UTC YYYY-MM-DDTHH:MM:SSZ, got: $ts" >&2; exit 2; }
  echo "$ts"
}

# Every decision row in the branch's logs, in time order.
branch_rows() {
  branch_keys | while read -r k; do
    f="$HOME/.local/share/recap/$k/decisions.tsv"
    if [ -f "$f" ]; then tail -n +2 "$f"; fi
  done | sort -s -t$'\t' -k1,1
}

commit_of() { git rev-parse --verify --quiet "$1^{commit}" || die "not a commit in this repo: $1"; }

# Hashes the PR body's own text: the review bots' summaries and the review record inside facts.py's
# block are dropped (an unclosed one is kept), as are blank lines, trailing spaces and carriage returns.
body_hash() {
  tr -d '\r' < "$1" | awk '
    function closer(l) {
      if (l ~ /<!-- pr-facts:record:start -->/) return "<!-- pr-facts:record:end -->"
      if (l ~ /<!-- Macroscope.s pull request summary starts here -->/) return "<!-- Macroscope.s pull request summary ends here -->"
      if (l ~ /<!-- This is an auto-generated comment: release notes by coderabbit\.ai -->/) return "<!-- end of auto-generated comment: release notes by coderabbit\\.ai -->"
      if (l ~ /<!-- CURSOR_SUMMARY -->/) return "<!-- /CURSOR_SUMMARY -->"
      return ""
    }
    function keep(l) { sub(/[ \t]+$/, "", l); if (l != "") print l }
    end == "" { end = closer($0); if (end == "") keep($0); else { h = 0; held[++h] = $0 }; next }
    { held[++h] = $0; if ($0 ~ end) end = "" }
    END { if (end != "") for (i = 1; i <= h; i++) keep(held[i]) }
  ' | git hash-object --stdin | cut -c1-12
}

case "${1:-}" in
  --path) echo "$LOG"; exit 0 ;;
  --body-hash) [ -f "${2:-}" ] || die "usage: log.sh --body-hash <file>"; body_hash "$2"; exit 0 ;;
  --rounds)
    branch_rows | awk -F'\t' -v repo="$repo" -v b="$branch" '
      # Counted, not ordered: rows from different logs in one second can sort either way.
      # A dispatch or drop may carry a scope label after the number and a reason after the branch.
      function is(word, s) { s = word " on " b; return rest == s || substr(rest, 1, length(s) + 2) == s ": " }
      $2 != repo || $3 != "codexloop" || $6 !~ /^round [0-9]+ / { next }
      { split($6, w, " "); n = w[2]; rest = substr($6, length(n) + 8); sub(/^\([a-zA-Z-]+\) /, "", rest) }
      is("dispatched") { sent[n]++; at[n] = $1 ", " $9; if (n + 0 > top) top = n + 0; next }
      is("dropped") { ended[n]++; if (n + 0 > top) top = n + 0; next }
      $6 ~ /^round [0-9]+ \([a-zA-Z-]+\) on / && substr($6, index($6, ") on ") + 5, length(b) + 2) == b ": " {
        ended[n]++; before = last; last = $0; if (n + 0 > top) top = n + 0
      }
      END {
        for (n in sent) if (sent[n] > ended[n]) {
          printf "round %s on %s (dispatched %s) has no round row: collect and triage its findings and log its round row, or log \"round %s dropped on %s\" if it ended without a review\n", n, b, at[n], n, b > "/dev/stderr"
          stuck = 1
        }
        if (stuck) exit 1
        if (before != "") print before
        if (last != "") print last
        print "next round " top + 1
      }'
    exit $? ;;
  --rejected)
    branch_rows | awk -F'\t' -v repo="$repo" -v b="$branch" '
      $2 == repo && $3 == "codexloop" && ($4 == "codex" || $4 == "claude") && $6 ~ /^F[0-9]+\.[0-9]+ on / {
        id = $6; sub(/ .*/, "", id)
        if (substr($6, length(id) + 1, length(b) + 6) != " on " b ": ") next
        if (!(id in text)) order[++k] = id
        rejected[id] = ($10 ~ /^rejected/); text[id] = "- " $6 " (" $7 ")"
      }
      END { for (i = 1; i <= k; i++) if (rejected[order[i]]) print text[order[i]] }'
    exit 0 ;;
  --pass)
    [ "$#" -eq 4 ] || [ "$#" -eq 5 ] || die "usage: log.sh --pass <pass> <head> <clean|fixed|not-reviewed> [<PR body file it read>]"
    [[ "$2" =~ ^[a-z0-9-]+$ ]] || die "a pass name is lowercase letters, digits and dashes: $2"
    head=$(commit_of "$3")
    case "$4" in clean|fixed|not-reviewed) ;; *) die "verdict must be clean, fixed or not-reviewed: $4" ;; esac
    body=-
    if [ "$#" -eq 5 ]; then [ -f "$5" ] || die "no body file: $5"; body=$(body_hash "$5"); fi
    ts=$(stamp)
    register_key
    ensure_header "$PASSES" "$PASS_HEADER"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$ts" "$repo" "$branch" "$2" "$head" "$4" "$body" >> "$PASSES"
    exit 0 ;;
  --check)
    [ "$#" -eq 2 ] || [ "$#" -eq 3 ] || die "usage: log.sh --check <head> [<PR number | body file>]"
    head=$(commit_of "$2")
    short=${head:0:8}
    current=""
    if [ "$#" -eq 3 ]; then
      body_file=$(mktemp) pr_file=$(mktemp)
      trap 'rm -f "$body_file" "$pr_file"' EXIT
      if [[ "$3" =~ ^[0-9]+$ ]]; then
        # One request, so the body read belongs to the head it confirms.
        gh pr view "$3" --json headRefOid,body -q '.headRefOid + "\n" + .body' > "$pr_file" || die "could not read PR #$3"
        pr_head=$(head -1 "$pr_file"); tail -n +2 "$pr_file" > "$body_file"
        [ "$pr_head" = "$head" ] || { echo "PR #$3's head is ${pr_head:0:8}, not $short: check the head it will merge."; exit 1; }
      else
        [ -f "$3" ] || die "no body file: $3"
        cp "$3" "$body_file"
      fi
      current=$(body_hash "$body_file")
    fi
    required="standards spec codexloop" reads_body=spec
    # Rows carry their log's place in branch_keys: one log's rows keep write order within a second,
    # two logs' do not, so logs whose last rows in that second disagree leave the pass in conflict.
    records=$(branch_keys | awk '{print NR "\t" $0}' | while IFS=$'\t' read -r i k; do
      f="$HOME/.local/share/recap/$k/reviews.tsv"
      if [ -f "$f" ]; then tail -n +2 "$f" | awk -v i="$i" '{print $0 "\t" i}'; fi
    done | sort -s -t$'\t' -k1,1)
    printf '%s\n' "$records" | awk -F'\t' -v repo="$repo" -v head="$head" -v short="$short" -v cur="$current" \
      -v required="$required" -v reads_body="$reads_body" '
      $2 == repo && NF >= 7 {
        p = $4
        if (!(p in lasthead)) every[++e] = p
        lasthead[p] = $5; lastverdict[p] = $6
        if ($6 != "not-reviewed") { readhead[p] = $5; readverdict[p] = $6 }
        if ($5 == head) {
          if (when[p] != $1) { when[p] = $1; logs[p] = "" }
          if (index(logs[p] " ", " " $8 " ") == 0) logs[p] = logs[p] " " $8
          lastrow[p, $8] = $6 SUBSEP $7; verdict[p] = $6; body[p] = $7
        }
      }
      END {
        n = split(required, names, " ")
        printf "Required passes on %s (PR body %s):\n", short, (cur == "" ? "not checked" : cur)
        for (i = 1; i <= n; i++) {
          p = names[i]; reads = (p == reads_body); conflict = 0
          k = split(logs[p], at, " "); for (j = 2; j <= k; j++) if (lastrow[p, at[j]] != lastrow[p, at[1]]) conflict = 1
          if (!(p in verdict))
            state = (p in lasthead) ? "MISSING: last ran on " substr(lasthead[p], 1, 8) " (" lastverdict[p] ")" : "MISSING: never recorded"
          else if (conflict) state = "CONFLICT: two logs recorded different results in the same second (" when[p] ")"
          else if (verdict[p] == "not-reviewed") state = "NOT REVIEWED on this head (recorded " when[p] ")"
          else if (verdict[p] != "clean") state = "NOT CLEAN: " verdict[p] " on this head"
          else if (reads && cur == "") state = "clean (PR body not checked)"
          else if (reads && body[p] == "-") state = "STALE BODY: it read no PR body"
          else if (reads && body[p] != cur) state = "STALE BODY: the PR body changed after it read it"
          else state = "clean"
          printf "  %-10s %s\n", p, state; req[p] = 1
          if (state ~ /^NOT REVIEWED/) unreviewed = unreviewed " " p
          else if (state !~ /^clean/) bad = bad " " p
        }
        for (i = 1; i <= e; i++) if (!((p = every[i]) in req)) {
          s = (p in readhead) ? "last read " substr(readhead[p], 1, 8) " (" readverdict[p] ")" : "never read a head"
          if (lastverdict[p] == "not-reviewed") s = s "; not-reviewed on " substr(lasthead[p], 1, 8)
          printf "  %-10s not required; %s\n", p, s
        }
        if (bad != "") { printf "Not clean on %s:%s%s\n", short, bad, unreviewed; exit 1 }
        if (unreviewed != "") { printf "Not reviewed on %s:%s\n", short, unreviewed; exit 3 }
        printf "Every required pass is clean on %s%s.\n", short, (cur == "" ? "" : " and its PR body")
      }'
    exit $? ;;
  --bind)
    mkdir -p "$KEYFILES"
    [ -s "$KEYFILE" ] && [ "$(tail -1 "$KEYFILE")" = "${2:?usage: log.sh --bind <key>}" ] \
      || echo "${2:?usage: log.sh --bind <key>}" >> "$KEYFILE"
    new="$HOME/.local/share/recap/$2/decisions.tsv"
    echo "$new"; exit 0 ;;
  --pins)
    { branch_keys; printf '%s\n' ${RECAP_PIN_KEYS:-}; } | awk 'NF && !seen[$0]++' | while read -r k; do
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

ts=$(stamp)
register_key
ensure_header "$LOG" "$HEADER"
row="$ts"$'\t'"$repo"
for cell in "$@"; do row+=$'\t'"$(clean "$cell")"; done
echo "$row" >> "$LOG"
