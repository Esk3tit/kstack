#!/usr/bin/env bash
# Checks for render.py: the data reaches the page intact, a value can't close the data block, and bad input writes nothing. Run: bash test-render.sh
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fail=1; fi; }
block() { python3 -c 'import json,re,sys; s=open(sys.argv[1]).read(); m=re.search(r"<script type=\"application/json\" id=\"recap-data\">(.*?)</script>", s, re.S); print(json.dumps(json.loads(m.group(1)), sort_keys=True))' "$1"; }
same() { python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))' "$1"; }

cp "$D/sample-recap.json" "$tmp/recap.json"
check "prints the page beside the data" "$(python3 "$D/render.py" "$tmp/recap.json")" "$tmp/recap.html"
check "the sample reaches the page intact" "$(block "$tmp/recap.html")" "$(same "$tmp/recap.json")"
check "one data block" "$(grep -c 'id="recap-data"' "$tmp/recap.html")" "1"
mkdir -p "$tmp/elsewhere" && python3 "$D/render.py" "$tmp/recap.json" "$tmp/elsewhere/page.html" >/dev/null
check "relative paths stay anchored to recap.json" "$(grep -o '<base href="[^"]*">' "$tmp/elsewhere/page.html")" "<base href=\"$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve().as_uri())' "$tmp")/\">"

python3 - "$tmp/recap.json" "$tmp/hostile.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
data["title"] = "</script><script>alert(1)</script><!-- &  "
json.dump(data, open(sys.argv[2], "w"))
PY
python3 "$D/render.py" "$tmp/hostile.json" "$tmp/hostile.html" >/dev/null
check "a value can't close the data block" "$(grep -c '</script><script>alert' "$tmp/hostile.html" || true)" "0"
check "the escaped value reads back unchanged" "$(block "$tmp/hostile.html")" "$(same "$tmp/hostile.json")"

refused() {  # refused <name> <python edit of d> <expected phrase>
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); $2; json.dump(d, open(sys.argv[2], 'w'))" "$tmp/recap.json" "$tmp/$1.json"
  check "refused: $1" "$(python3 "$D/render.py" "$tmp/$1.json" "$tmp/$1.html" 2>&1 >/dev/null | grep -c "$3")" "1"
  check "refused $1 writes no page" "$([ -e "$tmp/$1.html" ] && echo written || echo none)" "none"
}
refused missing-section 'del d["sections"]["attention"]' 'sections.attention'
refused sections-a-list 'd["sections"] = []' 'sections is missing'
refused no-prs 'd["prs"] = []' 'prs is missing'
refused unready-unknown 'del d["prs"][0]["merge_ready"]' 'prs\[0\].merge_ready must be'
refused ready-not-a-phrase 'd["prs"][0]["merge_ready"] = True' 'prs\[0\].merge_ready must be'
refused unknown-section 'd["sections"]["open_questions"] = []' 'sections.open_questions is not one'
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); d["prs"][0]["merge_ready"]="yes, after #616 merges"; json.dump(d, open(sys.argv[2], "w"))' "$tmp/recap.json" "$tmp/stacked.json"
check "a stacked PR's readiness is accepted" "$(python3 "$D/render.py" "$tmp/stacked.json" "$tmp/stacked.html" >/dev/null 2>&1 && echo 0 || echo 1)" "0"
refused no-reviewer 'd["reviewed_by"] = ""' 'reviewed_by'
refused not-an-object 'd = [d]' 'not a JSON object'
refused blank-order 'd["prs"][0]["merge_order"] = ""' 'merge_order must be a whole number'
echo '{"title": "x", "prs": [], "sections": [' > "$tmp/broken.json"
check "unreadable JSON is refused" "$(python3 "$D/render.py" "$tmp/broken.json" >/dev/null 2>&1 && echo 0 || echo 1)" "1"

exit $fail
