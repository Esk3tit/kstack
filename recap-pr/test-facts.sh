#!/usr/bin/env bash
# Checks for facts.py against a stand-in gh: the block's sources, its place in the body, and the read-back. Run: bash test-facts.sh
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
export HOME=$(mktemp -d)
trap 'rm -rf "$HOME"' EXIT
export FAKE="$HOME/fake" FACTS_RETRY_SECONDS=0 PATH="$HOME/bin:$PATH"
mkdir -p "$FAKE" "$HOME/bin"

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fail=1; fi; }

cat > "$HOME/bin/gh" <<'PY'
#!/usr/bin/env python3
import json, os, sys
fake, a = os.environ["FAKE"], sys.argv[1:]
read = lambda name: open(os.path.join(fake, name)).read()
if a[:2] == ["pr", "view"]:
    fields = a[a.index("--json") + 1]
    if "-q" in a:
        print(read("head").strip() if fields == "headRefOid" else read("body"))
    elif fields == "body":
        print(json.dumps({"body": read("body")}))
    else:
        print(json.dumps({"headRefOid": read("head").strip(), "baseRefName": "main", "url": "https://github.com/o/r/pull/7"}))
elif a[0] == "api" and "PATCH" in a:
    body = json.load(open(a[a.index("--input") + 1]))["body"]
    clobbers = os.path.join(fake, "clobbers")
    left = int(read("clobbers")) if os.path.exists(clobbers) else 0
    if left > 0:
        open(clobbers, "w").write(str(left - 1))
        body = read("stale") + "\n<!-- CURSOR_SUMMARY -->\nrewritten from an old copy\n<!-- /CURSOR_SUMMARY -->\n"
    open(os.path.join(fake, "body"), "w").write(body)
    print("{}")
elif a[0] == "api" and a[1].endswith("/check-runs"):
    print("build\tcompleted\tsuccess\ne2e | webkit\tin_progress\t\nlint\tcompleted\tsuccess")
elif a[0] == "api" and a[1].endswith("/status"):
    print("CodeRabbit\tsuccess")
else:
    sys.exit(f"stand-in gh got: {a}")
PY
chmod +x "$HOME/bin/gh"

origin="$HOME/origin.git"; repo="$HOME/repo"
git init -q --bare "$origin"
git init -q -b main "$repo" && cd "$repo"
git remote add origin "$origin"
git commit -q --allow-empty -m "start (#1)"
git push -q origin main
git switch -q -c feat/x
mkdir -p docs/agents
printf '%s\n' '- pass: standards' '- pass: spec, reads the PR body' '- facts: Tests = run: printf "chromium {head}"' '- facts: Perf = file: perf.md' \
  '- facts: Broken = run: exit 3' '- facts: Runs = run: echo x >> .runs && wc -l < .runs | tr -d " "' > docs/agents/pr-loop.md
git add docs && git commit -q -m "branch work"
git switch -q main
git commit -q --allow-empty -m "tighten the budget (#2)"
git commit -q --allow-empty -m "Merge pull request #3 from o/side" -m "Name the cards by their owner"
git commit -q --allow-empty -m "a direct commit"
git push -q origin main
git switch -q feat/x && git merge -q --no-edit main
head=$(git rev-parse HEAD)
echo "$head" > "$FAKE/head"
echo "| bytes | 198,603 |" > perf.md
"$D/log.sh" --pass standards "$head" clean
printf '## Summary\n\nDoes the thing.\n' > "$FAKE/body"
"$D/log.sh" --pass spec "$head" clean "$FAKE/body"

block=$(python3 "$D/facts.py" 7 --dry-run)
has() { printf '%s\n' "$block" | grep -cF -- "$1" || true; }
check "names the head" "$(has "**Facts on \`${head:0:8}\`**")" "1"
check "counts every check and status by result" "$(has "**Checks:** 4 on this head: 3 success, 1 in_progress.")" "1"
check "a pipe in a check name stays in its cell" "$(has '| e2e \| webkit | in_progress |')" "1"
check "carries the review check" "$(has "Every required pass is clean on ${head:0:8} and its PR body.")" "1"
check "lists the PRs a base merge brought in" "$(printf '%s\n' "$block" | grep -E '^- #' | tr '\n' '|')" "- #2 tighten the budget|- #3 Name the cards by their owner|"
check "counts commits naming no PR" "$(has '- 1 commit naming no PR')" "1"
check "runs a declared command with the head filled in" "$(has "chromium $head")" "1"
check "reads a declared file" "$(has '| bytes | 198,603 |')" "1"
check "a failing command says so" "$(has '_`exit 3` failed with exit 3')" "1"

printf '## Summary\n\nDoes the thing.\n\n<!-- Macroscope'"'"'s pull request summary starts here -->\nmacroscope\n<!-- Macroscope'"'"'s pull request summary ends here -->\n' > "$FAKE/body"
python3 "$D/facts.py" 7 >/dev/null
body=$(cat "$FAKE/body")
check "first write goes before the bots' summaries" "$(printf '%s\n' "$body" | grep -oE 'pr-facts:start|Macroscope.s pull request summary starts' | tr '\n' '|')" "pr-facts:start|Macroscope's pull request summary starts|"
check "the author's text stays" "$(printf '%s\n' "$body" | head -3 | tr '\n' '|')" "## Summary||Does the thing.|"
echo "| bytes | 201,000 |" > perf.md
python3 "$D/facts.py" 7 >/dev/null
check "a rerun replaces the block in place" "$(grep -c 'pr-facts:start' "$FAKE/body") $(grep -c '201,000' "$FAKE/body") $(grep -c '198,603' "$FAKE/body")" "1 1 0"
check "a rerun keeps the bots' summaries" "$(grep -c '^macroscope$' "$FAKE/body")" "1"
check "the review record sits in its own markers" "$(sed -n '/pr-facts:record:start/,/pr-facts:record:end/p' "$FAKE/body" | grep -c 'Review passes')" "1"
"$D/log.sh" --pass spec "$head" clean "$FAKE/body"
facts_before=$(sed -n '/pr-facts:start/,/pr-facts:record:start/p' "$FAKE/body")
check "a record-only refresh says so" "$(python3 "$D/facts.py" 7 --record-only)" "review record refreshed on PR #7 for ${head:0:8}"
check "it keeps every fact, measured ones included" "$(sed -n '/pr-facts:start/,/pr-facts:record:start/p' "$FAKE/body")" "$facts_before"
check "so Spec stays clean" "$("$D/log.sh" --check "$head" 7 | tail -1)" "Every required pass is clean on ${head:0:8} and its PR body."
check "and the record shows it" "$(sed -n '/pr-facts:record:start/,/pr-facts:record:end/p' "$FAKE/body" | grep -c 'Every required pass is clean')" "1"
python3 "$D/facts.py" 7 >/dev/null
check "a full refresh reruns the measured facts, so Spec goes round again" "$("$D/log.sh" --check "$head" 7 | tail -1)" "Not clean on ${head:0:8}: spec"
printf '## Summary\n\nDoes the thing.\n' > "$FAKE/stale"
echo 1 > "$FAKE/clobbers"
check "a bot's stale rewrite is outrun" "$(python3 "$D/facts.py" 7)" "facts block written to PR #7 for ${head:0:8} after 2 writes"
check "the bot's own section survives the retry" "$(grep -c 'rewritten from an old copy' "$FAKE/body")" "1"
echo 5 > "$FAKE/clobbers"
check "a body that keeps losing the block fails" "$(python3 "$D/facts.py" 7 >/dev/null 2>&1; echo $?)" "1"
printf '## Summary\n\nDoes an older thing.\n' > "$FAKE/stale"
echo 1 > "$FAKE/clobbers"
check "a stale copy of the author's text is refused, not written back" "$(python3 "$D/facts.py" 7 2>&1 >/dev/null | grep -c "own text changed")" "1"
rm "$FAKE/clobbers"
printf '## Summary\n\nNo block yet.\n' > "$FAKE/body"
check "a record-only refresh needs a block to refresh" "$(python3 "$D/facts.py" 7 --record-only 2>&1 >/dev/null | grep -c 'run facts.py <pr> first')" "1"
printf 'text\n<!-- pr-facts:end -->\n<!-- pr-facts:start -->\n' > "$FAKE/body"
check "broken markers are refused, not guessed at" "$(python3 "$D/facts.py" 7 2>&1 >/dev/null | grep -c 'markers are broken')" "1"

exit $fail
