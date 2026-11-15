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

python3 - "$tmp/recap.json" "$tmp/hostile.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
data["title"] = "</script><script>alert(1)</script><!-- &  "
json.dump(data, open(sys.argv[2], "w"))
PY
python3 "$D/render.py" "$tmp/hostile.json" "$tmp/hostile.html" >/dev/null
check "a value can't close the data block" "$(grep -c '</script><script>alert' "$tmp/hostile.html" || true)" "0"
check "the escaped value reads back unchanged" "$(block "$tmp/hostile.html")" "$(same "$tmp/hostile.json")"

python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); del d["sections"]["attention"]; json.dump(d, open(sys.argv[2], "w"))' "$tmp/recap.json" "$tmp/partial.json"
check "a missing section is refused" "$(python3 "$D/render.py" "$tmp/partial.json" "$tmp/partial.html" 2>&1 >/dev/null | grep -c 'sections.attention')" "1"
check "a refused recap writes no page" "$([ -e "$tmp/partial.html" ] && echo written || echo none)" "none"
echo '{"title": "x", "prs": [], "sections": [' > "$tmp/broken.json"
check "unreadable JSON is refused" "$(python3 "$D/render.py" "$tmp/broken.json" >/dev/null 2>&1 && echo 0 || echo 1)" "1"

exit $fail
