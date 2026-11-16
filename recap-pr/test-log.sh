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

git switch -q -c feat/passes
undeclared=$(git rev-parse HEAD)
mkdir -p docs/agents
printf '%s\n' '# PR loop' '' '## Required passes' '' '- pass: standards' '- pass: spec, reads the PR body' \
  '- pass: fable' '- pass: codexloop' > docs/agents/pr-loop.md
git add docs && git commit -q -m "declare the passes"
H1=$(git rev-parse HEAD)
body="$HOME/body.md"
printf '## Summary\n\nDoes the thing.\n' > "$body"
clean_on() { for p in standards fable codexloop; do "$L" --pass "$p" "$1" clean; done; "$L" --pass spec "$1" clean "$body"; }
verdict() { "$L" --check "$@" > "$HOME/check.out" 2>&1 && echo pass || echo "fail: $(tail -1 "$HOME/check.out")"; }
line() { grep "^  $1 " "$HOME/check.out" | sed -E 's/^  [a-z-]+ +//'; }
clean_on "$H1"
check "all four clean on the head and body" "$(verdict "$H1" "$body")" "pass"
printf '## Summary\n\nDoes the thing.  \r\n\n\n<!-- pr-facts:start -->\nchecks 9/9\n<!-- pr-facts:end -->\n<!-- CURSOR_SUMMARY -->\nbugbot\n<!-- /CURSOR_SUMMARY -->\n' > "$HOME/bots.md"
check "bot and facts blocks, blank lines and spacing leave the body unchanged" "$(verdict "$H1" "$HOME/bots.md")" "pass"
printf '## Summary\n\nDoes the thing.\n<!-- pr-facts:start -->\nnever closed\n' > "$HOME/open.md"
check "an unclosed block counts as text" "$(verdict "$H1" "$HOME/open.md")" "fail: Not clean on ${H1:0:8}: spec"
printf '## Summary\n\nDoes the thing, twice as fast.\n' > "$HOME/edited.md"
check "a body edit after Spec" "$(verdict "$H1" "$HOME/edited.md")" "fail: Not clean on ${H1:0:8}: spec"
check "a body edit names why" "$(line spec)" "STALE BODY: the PR body changed after it read it"
check "without a body the head alone is checked" "$(verdict "$H1")" "pass"

git switch -q -c base "$undeclared" && git commit -q --allow-empty -m "main moved" && git switch -q feat/passes
git merge -q --no-edit base
H2=$(git rev-parse HEAD)
check "a base merge after review" "$(verdict "$H2" "$body")" "fail: Not clean on ${H2:0:8}: standards spec fable codexloop"
check "a pass from an older head says where it ran" "$(line fable)" "MISSING: last ran on ${H1:0:8} (clean)"

git commit -q --allow-empty -m "fix from Fable"
H3=$(git rev-parse HEAD)
"$L" --pass fable "$H2" fixed
for p in standards codexloop; do "$L" --pass "$p" "$H3" clean; done
"$L" --pass spec "$H3" clean "$body"
check "a fix after Fable" "$(verdict "$H3" "$body")" "fail: Not clean on ${H3:0:8}: fable"
check "the fixing pass is named with its verdict" "$(line fable)" "MISSING: last ran on ${H2:0:8} (fixed)"
"$L" --pass fable "$H3" clean
check "all four clean after the fix" "$(verdict "$H3" "$body")" "pass"
"$L" --pass standards "$H3" fixed
check "a later fixed verdict on the same head reopens the pass" "$(verdict "$H3" "$body")" "fail: Not clean on ${H3:0:8}: standards"
"$L" --pass spec "$H2" clean
"$L" --pass spec "$H3" clean
"$L" --pass standards "$H3" clean
check "a body-reading pass that read no body" "$(verdict "$H3" "$body" >/dev/null; line spec)" "STALE BODY: it read no PR body"
check "no declaration lists what ran" "$(verdict "$undeclared" "$body")" "pass"
check "no declaration says so" "$(head -1 "$HOME/check.out")" "No required passes declared (docs/agents/pr-loop.md at ${undeclared:0:8})."
check "a bad verdict is refused" "$("$L" --pass fable "$H3" approved 2>/dev/null; echo $?)" "2"
check "an unknown head is refused" "$("$L" --check deadbeef 2>/dev/null; echo $?)" "2"

mkdir -p "$HOME/bin"
printf '#!/usr/bin/env bash\ncase "$*" in *headRefOid*) echo %s ;; *body*) cat %s ;; esac\n' "$H3" "$body" > "$HOME/bin/gh"
chmod +x "$HOME/bin/gh"
"$L" --pass spec "$H3" clean "$body"
check "a PR number reads its live head and body" "$(PATH="$HOME/bin:$PATH" verdict "$H3" 7)" "pass"
check "a PR number with another head" "$(PATH="$HOME/bin:$PATH" verdict "$H2" 7)" "fail: PR #7's head is ${H3:0:8}, not ${H2:0:8}: check the head it will merge."

round() { "$L" codexloop me yes "$1" scope none "head $2" accepted; }
check "no rounds yet" "$("$L" --rounds; echo $?)" "0"
round "round 1 dispatched on feat/passes" "$H1, whole-PR"
check "a dispatched round blocks the next" "$("$L" --rounds 2>/dev/null; echo $?)" "1"
check "the block names the round" "$("$L" --rounds 2>&1 | cut -c1-34)" "round 1 on feat/passes (dispatched"
"$L" --bind ROUNDS >/dev/null
check "binding to another log keeps the pending round" "$("$L" --rounds 2>/dev/null; echo $?)" "1"
round "round 1 (whole-PR) on feat/passes: 2 findings, 1 accepted, fixed" "$H1"
check "a round row unblocks" "$("$L" --rounds | cut -f6)" "round 1 (whole-PR) on feat/passes: 2 findings, 1 accepted, fixed"
round "round 2 dispatched on feat/passes" "$H3, fixes"
round "round 2 dropped on feat/passes" "$H3"
round "round 9 dispatched on feat/other" "$H3, whole-PR"
check "a dropped round and another branch's round block nothing" "$("$L" --rounds | cut -f6)" "round 1 (whole-PR) on feat/passes: 2 findings, 1 accepted, fixed"
round "round 3 dispatched on feat/passes" "$H3, fixes"
round "round 3 (fixes) on feat/passes: 0 findings, 0 accepted, clean" "$H3"
"$L" --bind ROUNDS2 >/dev/null
RECAP_TS=2026-01-01T00:00:00Z round "round 4 dispatched on feat/passes" "$H3, fixes"
"$L" --bind ROUNDS >/dev/null
RECAP_TS=2026-01-01T00:00:00Z round "round 4 dropped on feat/passes" "$H3"
check "a drop in another log in the same second still ends its round" "$("$L" --rounds >/dev/null 2>&1; echo $?)" "0"
round "round 9 (whole-PR) on feat/other: rebased on feat/passes: 0 findings, 0 accepted, clean" "$H3"
check "the last two round rows, oldest first" "$("$L" --rounds | cut -f6 | tr '\n' '|')" "round 1 (whole-PR) on feat/passes: 2 findings, 1 accepted, fixed|round 3 (fixes) on feat/passes: 0 findings, 0 accepted, clean|"

finding() { "$L" codexloop codex no "$1" "$2" none ev "$3"; }
finding "F1.1 on feat/passes: retry token kept stale" "the old token is still valid" rejected
finding "F1.2 on feat/passes: missing await" "real" "accepted, tests green"
"$L" --bind FINDINGS >/dev/null
finding "F2.1 on feat/passes: title says undimmed" "wording only" rejected
finding "F1.1 on feat/passes: retry token kept stale" "new trace shows a 401" "accepted, tests green"
finding "F2.1 on feat/other: unrelated finding" "another branch's" "accepted, tests green"
finding "F3.1 on feat/other: another branch's rejection" "not ours" rejected
finding "F2.1 on feat/other: a regression on feat/passes: same ID" "another branch's, naming ours" "accepted, tests green"
check "rejected findings keep their IDs across logs, and a reopened one leaves" "$("$L" --rejected)" "- F2.1 on feat/passes: title says undimmed (wording only)"

exit $fail
