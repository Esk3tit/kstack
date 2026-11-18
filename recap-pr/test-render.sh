#!/usr/bin/env bash
# Checks for render.py and recap.html: the data reaches the page intact, a value can't close the data block, bad input
# writes nothing, and the page, drawn in Chrome, heads and counts each section right. Run: bash test-render.sh
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fail=1; fi; }
block() { python3 -c 'import json,re,sys; s=open(sys.argv[1]).read(); m=re.search(r"<script type=\"application/json\" id=\"recap-data\">(.*?)</script>", s, re.S); print(json.dumps(json.loads(m.group(1)), sort_keys=True))' "$1"; }
same() { python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))' "$1"; }
edited() {  # edited <name> <python edit of d>: writes the sample with that edit to $tmp/<name>.json
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); $2; json.dump(d, open(sys.argv[2], 'w'))" "$tmp/recap.json" "$tmp/$1.json"
}
uri() { python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve().as_uri())' "$1"; }

cp "$D/sample-recap.json" "$tmp/recap.json"
check "prints the page beside the data" "$(python3 "$D/render.py" "$tmp/recap.json")" "$tmp/recap.html"
check "the sample reaches the page intact" "$(block "$tmp/recap.html")" "$(same "$tmp/recap.json")"
check "one data block" "$(grep -c 'id="recap-data"' "$tmp/recap.html")" "1"
mkdir -p "$tmp/elsewhere" && python3 "$D/render.py" "$tmp/recap.json" "$tmp/elsewhere/page.html" >/dev/null
check "relative paths stay anchored to recap.json" "$(grep -o '<base href="[^"]*">' "$tmp/elsewhere/page.html")" "<base href=\"$(uri "$tmp")/\">"

edited hostile 'd["title"] = "</script><script>alert(1)</script><!-- &  "'
python3 "$D/render.py" "$tmp/hostile.json" "$tmp/hostile.html" >/dev/null
check "a value can't close the data block" "$(grep -c '</script><script>alert' "$tmp/hostile.html" || true)" "0"
check "the escaped value reads back unchanged" "$(block "$tmp/hostile.html")" "$(same "$tmp/hostile.json")"

refused() {  # refused <name> <python edit of d> <expected phrase>
  edited "$1" "$2"
  check "refused: $1" "$(python3 "$D/render.py" "$tmp/$1.json" "$tmp/$1.html" 2>&1 >/dev/null | grep -c "$3")" "1"
  check "refused $1 writes no page" "$([ -e "$tmp/$1.html" ] && echo written || echo none)" "none"
}
refused missing-section 'del d["sections"]["attention"]' 'sections.attention'
refused sections-a-list 'd["sections"] = []' 'sections is missing'
refused no-prs 'd["prs"] = []' 'prs is missing'
refused unready-unknown 'del d["prs"][0]["merge_ready"]' 'prs\[0\].merge_ready must be'
refused ready-not-a-phrase 'd["prs"][0]["merge_ready"] = True' 'prs\[0\].merge_ready must be'
refused unknown-section 'd["sections"]["open_questions"] = []' 'sections.open_questions is not one'
edited stacked 'd["prs"][0]["merge_ready"] = "yes, after #616 merges"'
check "a stacked PR's readiness is accepted" "$(python3 "$D/render.py" "$tmp/stacked.json" "$tmp/stacked.html" >/dev/null 2>&1 && echo 0 || echo 1)" "0"
refused no-reviewer 'd["reviewed_by"] = ""' 'reviewed_by'
refused not-an-object 'd = [d]' 'not a JSON object'
refused blank-order 'd["prs"][0]["merge_order"] = ""' 'merge_order must be a whole number'
echo '{"title": "x", "prs": [], "sections": [' > "$tmp/broken.json"
check "unreadable JSON is refused" "$(python3 "$D/render.py" "$tmp/broken.json" >/dev/null 2>&1 && echo 0 || echo 1)" "1"

chrome=${CHROME:-}
if [ -z "$chrome" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "/Applications/Chromium.app/Contents/MacOS/Chromium" google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1; then chrome=$c; break; fi
  done
fi
if [ -z "$chrome" ]; then
  echo "FAIL no Chrome or Chromium to draw the page with; set CHROME to one"
  exit 1
fi

# Prints one part of what the drawn page shows: its headline; each section heading with its items' text; or each fold's
# line, with ' · ' before its grey note.
shown_py=$(cat <<'PY'
import html, re, sys

page = sys.stdin.read()


def text(fragment):
    return html.unescape(re.sub(r"<[^>]+>", "", fragment.replace('<span class="note">', " · "))).strip()


headline = re.search(r"<h1>(.*?)</h1>", page, re.S)
sections = re.findall(r"<section><h2>(.*?)</h2>(.*?)</section>", page, re.S)
print({"headline": text(headline.group(1)) if headline else "",
       "sections": " | ".join(text(h) + ": " + ", ".join(text(p) for p in re.findall(r'<p class="text">(.*?)</p>', body, re.S)) for h, body in sections),
       "folds": " | ".join(text(f) for f in re.findall(r'<details class="fold"><summary>(.*?)</summary>', page, re.S))}[sys.argv[1]])
PY
)
drawn() {  # drawn <name> <python edit of d, S its sections>: the sample with no divergences or attention items, edited, drawn in Chrome as $tmp/<name>.dom
  edited "$1" "S = d['sections']; S['divergences'] = []; S['attention'] = []; $2"
  python3 "$D/render.py" "$tmp/$1.json" "$tmp/$1.html" >/dev/null
  if ! "$chrome" --headless --no-first-run --no-default-browser-check --user-data-dir="$tmp/chrome" --dump-dom "$(uri "$tmp/$1.html")" 2>"$tmp/$1.err" > "$tmp/$1.dom" || ! grep -q 'class="verdict"' "$tmp/$1.dom"; then
    err=$(tail -n 1 "$tmp/$1.err")
    echo "FAIL $chrome could not draw $1.html${err:+: $err}"
    exit 1
  fi
}
shown() {  # shown <name> <headline|sections|folds>
  python3 -c "$shown_py" "$2" < "$tmp/$1.dom"
}

user_change="{'surface': 'Nation tree', 'text': 'user change'}"
dev_change="{'surface': 'Developers and agents', 'text': 'agent change'}"
drawn users-only "S['behavior_changes'] = [$user_change]"
drawn dev-only "S['behavior_changes'] = [$dev_change]"
drawn mixed "S['behavior_changes'] = [$dev_change, $user_change]"
drawn unchanged "S['behavior_changes'] = []"
check "user changes go under the users' heading" "$(shown users-only sections)" "What users will see: user change"
check "dev-only changes get their own heading and no users' heading" "$(shown dev-only sections)" "What developers and agents will see: agent change"
check "mixed changes split, users' first" "$(shown mixed sections)" "What users will see: user change | What developers and agents will see: agent change"
check "a page with no changes still draws its headline" "$(shown unchanged headline)" "Nothing needs you. Safe to merge."
check "no changes, no heading" "$(shown unchanged sections)" ""

fill_folds() {  # fill_folds <n>: no behavior changes, n items in every fold's section, n parity pairs that differ and n log rows
  echo "S['behavior_changes'] = []
S['attention'] = [{'surface': 'CI', 'text': 'a note'}] * $1
S['not_asked_for'] = [{'surface': 'Tests', 'text': 'an addition', 'mechanism': True}] * $1
S['rejected_or_reverted'] = [{'surface': 'Tests', 'text': 'a suggestion', 'result': 'rejected'}] * $1
S['decided_no_change'] = [{'surface': 'Reviews', 'text': 'a decision', 'asked': 'yes'}] * $1
d['parity'] = {'summary': '', 'pairs': [{'label': 'a check', 'master': '', 'branch': '', 'verdict': 'differs'}] * $1}
d['log']['rows'] = $1"
}
drawn one-each "$(fill_folds 1)"
drawn two-each "$(fill_folds 2)"
check "count lines agree with one" "$(shown one-each folds)" "1 note · read before merging | 1 addition nobody asked for · 1 mechanism | 1 suggestion turned down | 1 decision that changes nothing | Side-by-side check · 1 differs | Who decided what · you were asked about 1 of 4 | About this recap · from 1 log row"
check "count lines agree with two" "$(shown two-each folds)" "2 notes · read before merging | 2 additions nobody asked for · 2 mechanisms | 2 suggestions turned down | 2 decisions that change nothing | Side-by-side check · 2 differ | Who decided what · you were asked about 2 of 8 | About this recap · from 2 log rows"
check "the headline counts one note" "$(shown one-each headline)" "Nothing to decide. Read one note before merging."
check "the headline counts two notes" "$(shown two-each headline)" "Nothing to decide. Read two notes before merging."

exit $fail
