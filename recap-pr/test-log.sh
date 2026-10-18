#!/usr/bin/env bash
# Checks for log.sh: key resolution, binding, the header, and settled-decision pins. Run: bash test-log.sh
set -euo pipefail
L="$(cd "$(dirname "$0")" && pwd)/log.sh"
export HOME=$(mktemp -d)
repo=$(mktemp -d)
trap 'rm -rf "$HOME" "$repo"' EXIT
cd "$repo" && git init -q && git commit -q --allow-empty -m init

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fail=1; fi; }
pins() { "$L" --pins | tr '\n' ' ' | sed 's/ $//'; }
row() { RECAP_KEY=$1 RECAP_TS=$2 "$L" user you yes "$3" why none ev "$4"; }
T=2026-01-01T00:00:00Z

git switch -q -c fix/repro-42-x
check "no ticket in repro-42" "$("$L" --path | sed 's#.*/recap/##')" "$(basename "$repo")-fix%2Frepro-42-x/decisions.tsv"
git switch -q -c fix/pro-2725-thing
check "ticket from branch" "$("$L" --path | sed 's#.*/recap/##')" "PRO-2725/decisions.tsv"

git switch -q -c feat/keep
"$L" user you yes early w none e accepted
git commit -q --allow-empty -m "PRO-9 later"
check "key survives a ticketed commit" "$("$L" --path | sed 's#.*/recap/##')" "$(basename "$repo")-feat%2Fkeep/decisions.tsv"
"$L" --bind SHARED >/dev/null
"$L" user you yes later w none e accepted
check "pins span bound logs" "$(pins)" "- early (w) - later (w)"

RECAP_KEY=RACE bash -c 'for i in $(seq 1 20); do "$0" user you yes "d$i" w none e accepted & done; wait' "$L"
check "parallel first writers keep every row" "$(($(wc -l < "$HOME/.local/share/recap/RACE/decisions.tsv") - 1))" "20"

row C4 $T A accepted; row C4 $T B "accepted; supersedes: A"; row C4 $T C "accepted; supersedes: B"; row C4 $T A "accepted; supersedes: C"
check "same-second A>B>C>A" "$(RECAP_KEY=C4 pins)" "- A (why)"
row X1 $T B "accepted; supersedes: A"; row X2 $T A accepted
check "cross-log same-second" "$(RECAP_KEY=X1 RECAP_PIN_KEYS='X1 X2' pins)" "- B (why)"
row LB 2026-01-01T00:00:09Z B "accepted; supersedes: A"; row LB 2026-01-01T00:00:05Z A accepted
check "late backfill stays superseded" "$(RECAP_KEY=LB pins)" "- B (why)"
row RV $T D reverted; row RV $T E accepted
check "reverted is not pinned" "$(RECAP_KEY=RV pins)" "- E (why)"
check "non-UTC RECAP_TS refused" "$(RECAP_TS=2026-01-01T00:00:00-07:00 "$L" user you yes x w none e accepted 2>/dev/null; echo $?)" "2"

exit $fail
