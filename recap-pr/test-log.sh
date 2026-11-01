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
correction() { RECAP_KEY=$1 RECAP_TS=$2 "$L" review me no "$3" why none ev "$4"; }
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
row S1 $T A accepted; row S1 $T C "accepted; supersedes: B"; row S2 $T B "accepted; supersedes: A"
check "split chain, one log order" "$(RECAP_KEY=S1 RECAP_PIN_KEYS='S1 S2' pins)" "- C (why)"
check "split chain, other log order" "$(RECAP_KEY=S2 RECAP_PIN_KEYS='S2 S1' pins)" "- C (why)"
row LB 2026-01-01T00:00:09Z B "accepted; supersedes: A"; row LB 2026-01-01T00:00:05Z A accepted
check "late backfill stays superseded" "$(RECAP_KEY=LB pins)" "- B (why)"
row RV $T D reverted; row RV $T E accepted
check "reverted is not pinned" "$(RECAP_KEY=RV pins)" "- E (why)"
row RT $T A accepted; row RT $T B accepted; correction RT 2026-01-01T00:00:05Z "A was the coordinator's" "accepted; retracts: A"
check "a correction from another source retires a pin" "$(RECAP_KEY=RT pins)" "- B (why)"
row RJ $T A accepted; correction RJ 2026-01-01T00:00:05Z x "rejected; retracts: A"
check "a rejected retraction retires nothing" "$(RECAP_KEY=RJ pins)" "- A (why)"
correction RE 2026-01-01T00:00:01Z "early" "accepted; retracts: A"; row RE 2026-01-01T00:00:05Z A accepted
check "a retraction only retires earlier pins" "$(RECAP_KEY=RE pins)" "- A (why)"
row RA $T A accepted; correction RA 2026-01-01T00:00:05Z x "accepted; retracts: A"; row RA 2026-01-01T00:00:09Z A accepted
check "a pin re-confirmed after its retraction is back" "$(RECAP_KEY=RA pins)" "- A (why)"
row RC $T A accepted; row RC $T B accepted
correction RC 2026-01-01T00:00:05Z x "accepted; retracts: A"; correction RC 2026-01-01T00:00:09Z y "accepted; retracts: B"
check "retractions in consecutive seconds each retire their own pin" "$(RECAP_KEY=RC pins)" ""
row RS $T A accepted; correction RS $T x "accepted; retracts: A"
check "a same-second retraction written after its pin retires it" "$(RECAP_KEY=RS pins)" ""
correction RB $T x "accepted; retracts: A"; row RB $T A accepted
check "a same-second retraction written before its pin retires it" "$(RECAP_KEY=RB pins)" ""
row RN $T A accepted; correction RN 2026-01-01T00:00:05Z x "accepted; retracts: Z"
check "a retraction naming no pin changes nothing" "$(RECAP_KEY=RN pins)" "- A (why)"
row RG $T B "accepted; supersedes: A"; correction RG $T x "accepted; retracts: Q"; row RG $T A accepted
check "a retraction keeps its second's supersession whole" "$(RECAP_KEY=RG pins)" "- B (why)"
correction RX1 $T x "accepted; retracts: A"; row RX2 $T A accepted
check "cross-log same-second retraction, one log order" "$(RECAP_KEY=RX1 RECAP_PIN_KEYS='RX1 RX2' pins)" ""
check "cross-log same-second retraction, other log order" "$(RECAP_KEY=RX2 RECAP_PIN_KEYS='RX2 RX1' pins)" ""
row TX $T keep accepted; row TX $T "say retracts: keep" accepted; row TX 2026-01-01T00:00:05Z new "accepted; supersedes: say retracts: keep"
check "a superseded decision naming the retract tag retires only itself" "$(RECAP_KEY=TX pins)" "- keep (why) - new (why)"
row TS $T A accepted; correction TS 2026-01-01T00:00:05Z x "accepted, unretracts: A"
check "a tag inside a word retires nothing" "$(RECAP_KEY=TS pins)" "- A (why)"
row TN $T A accepted; row TN 2026-01-01T00:00:05Z B "accepted;supersedes: A"
check "a supersedes tag not right after '; ' or ', ' replaces nothing" "$(RECAP_KEY=TN pins)" "- A (why) - B (why)"
row TZ $T A accepted; row TZ 2026-01-01T00:00:05Z B "accepted, note supersedes: Z; supersedes: A"
check "a stray supersedes before the real one leaves the real one working" "$(RECAP_KEY=TZ pins)" "- B (why)"
row TB $T A accepted; row TB 2026-01-01T00:00:05Z B "accepted, note retracts: Z; supersedes: A"
check "a stray tag before '; supersedes:' leaves the supersession working" "$(RECAP_KEY=TB pins)" "- B (why)"
row TC $T A accepted; row TC 2026-01-01T00:00:05Z B "accepted, supersedes: A"; correction TC 2026-01-01T00:00:09Z x "accepted, retracts: B"
check "a tag after ', ' works as after '; '" "$(RECAP_KEY=TC pins)" ""
row SR1 $T C "accepted; supersedes: B"; correction SR1 $T x "accepted; retracts: Q"; row SR2 $T B accepted
check "split chain with a stray retraction, one log order" "$(RECAP_KEY=SR1 RECAP_PIN_KEYS='SR1 SR2' pins)" "- C (why)"
check "split chain with a stray retraction, other log order" "$(RECAP_KEY=SR2 RECAP_PIN_KEYS='SR2 SR1' pins)" "- C (why)"
check "non-UTC RECAP_TS refused" "$(RECAP_TS=2026-01-01T00:00:00-07:00 "$L" user you yes x w none e accepted 2>/dev/null; echo $?)" "2"

exit $fail
