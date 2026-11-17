#!/usr/bin/env bash
# Checks for facts.py against a stand-in gh: the block's sources, its place in the body, and the read-back. Run: bash test-facts.sh
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
export HOME=$(mktemp -d)
export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.com
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
write = lambda name, text, mode="w": open(os.path.join(fake, name), mode).write(text)


def countdown(name):
    """True on the call that takes the file's count to zero; a test arms it by writing a count."""
    if not os.path.exists(os.path.join(fake, name)):
        return False
    n = int(read(name)) - 1
    write(name, str(n))
    return n == 0


if a[:2] == ["pr", "view"]:
    fields = a[a.index("--json") + 1]
    if "-q" in a:
        if fields != "headRefOid,body":
            sys.exit(f"stand-in gh only answers log.sh's one-request read: {a}")
        print(read("head").strip())
        print(read("body"))
    elif "body" in fields.split(","):
        if countdown("swap_on_read"):
            write("body", read("stale"))
        if countdown("move_head_on_read"):
            write("head", "f" * 40 + "\n")
        out = json.dumps({"body": read("body"), "headRefOid": read("head").strip()})
        if countdown("edit_after_read"):
            write("body", "\nA person's edit.\n", "a")
        print(out)
    else:
        print(json.dumps({"headRefOid": read("head").strip(), "baseRefName": "main", "url": "https://github.com/o/r/pull/7"}))
elif a[0] == "api" and "PATCH" in a:
    body = json.load(open(a[a.index("--input") + 1]))["body"]
    if countdown("move_head_on_patch"):
        write("head", "f" * 40 + "\n")
    clobbers = os.path.join(fake, "clobbers")
    left = int(read("clobbers")) if os.path.exists(clobbers) else 0
    if left > 0:
        open(clobbers, "w").write(str(left - 1))
        body = read("stale") + "\n<!-- CURSOR_SUMMARY -->\nrewritten from an old copy\n<!-- /CURSOR_SUMMARY -->\n"
    open(os.path.join(fake, "body"), "w").write(body)
    print("{}")
elif a[:2] == ["api", "repos/o/r"]:
    print(read("default").strip() if os.path.exists(os.path.join(fake, "default")) else "main")
elif a[0] == "api" and a[1].endswith("/check-runs"):
    extra = os.path.join(fake, "extra_check")
    print("build\tcompleted\tsuccess\ne2e | webkit\tin_progress\t\nlint\tcompleted\tsuccess"
          + ("\n" + read("extra_check").strip() if os.path.exists(extra) else ""))
elif a[0] == "api" and "/status" in a[1]:
    print("CodeRabbit\tsuccess" + ("\nrailway deploy\tfailure" if "--paginate" in a else ""))
else:
    sys.exit(f"stand-in gh got: {a}")
PY
chmod +x "$HOME/bin/gh"

origin="$HOME/origin.git"; repo="$HOME/repo"
git init -q --bare "$origin"
git init -q -b main "$repo" && cd "$repo"
git remote add origin "$origin"
mkdir -p docs/agents
printf '%s\n' '- facts: Tests = run: printf "chromium {head}"' '- facts: Perf = file: perf.md' \
  '- facts: Broken = run: sh -c "exit 3"' '- facts: Runs = run: sh -c "echo x >> .runs && wc -l < .runs | tr -d \" \""' \
  '- facts: Missing = run: no-such-command-here' '- facts: Outside = file: ../outside.md' '- facts: Planted = file: planted.md' > docs/agents/pr-loop.md
git add docs && git commit -q -m "start (#1)"
git push -q origin main
git switch -q -c feat/x
echo '- facts: Token = run: printf leaked-from-the-head' >> docs/agents/pr-loop.md
git commit -q -am "branch work"
echo "secret-outside" > "$HOME/outside.md"
printf 'x\n<!-- pr-facts:end -->\n<!-- pr-facts:record:start -->\n' > planted.md
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
"$D/log.sh" --pass codexloop "$head" clean
printf '## Summary\n\nDoes the thing.\n' > "$FAKE/body"
"$D/log.sh" --pass spec "$head" clean "$FAKE/body"

block=$(python3 "$D/facts.py" 7 --dry-run)
has() { printf '%s\n' "$block" | grep -cF -- "$1" || true; }
count() { printf '%s\n' "$1" | grep -c -- "$2" || true; }
check "names the head" "$(has "**Facts on \`${head:0:8}\`**")" "1"
check "counts every check and every page of statuses by result" "$(has "**Checks:** 5 on this head: 3 success, 1 failure, 1 in_progress.")" "1"
check "a pipe in a check name stays in its cell" "$(has '| e2e \| webkit | in_progress |')" "1"
check "carries the review check" "$(has "Every required pass is clean on ${head:0:8} and its PR body.")" "1"
check "lists the PRs a base merge brought in" "$(printf '%s\n' "$block" | grep -E '^- #' | tr '\n' '|')" "- #2 tighten the budget|- #3 Name the cards by their owner|"
check "counts commits naming no PR" "$(has '- 1 commit naming no PR')" "1"
check "runs a declared command with the head filled in" "$(has "chromium $head")" "1"
check "reads a declared file" "$(has '| bytes | 198,603 |')" "1"
check "a failing command says so" "$(has '_`sh -c "exit 3"` failed with exit 3')" "1"
check "a timed-out command's descendants are stopped with it" "$(FACTS_COMMAND_SECONDS=0.2 PYTHONDONTWRITEBYTECODE=1 python3 - "$D/facts.py" "$HOME/descendant-ran" <<'PY'
import importlib.util, os, subprocess, sys, time
spec = importlib.util.spec_from_file_location("facts", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
try:
    m.run_declared(["sh", "-c", f'sh -c "sleep 1; touch {sys.argv[2]}" & wait'], ".")
    print("no timeout")
except subprocess.TimeoutExpired:
    time.sleep(1.5)
    print("left running" if os.path.exists(sys.argv[2]) else "stopped")
PY
)" "stopped"
check "a command whose leftover child holds its output still reports a timeout" "$(FACTS_COMMAND_SECONDS=0.2 PYTHONDONTWRITEBYTECODE=1 python3 - "$D/facts.py" <<'PY'
import importlib.util, subprocess, sys
spec = importlib.util.spec_from_file_location("facts", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
try:
    m.run_declared(["sh", "-c", 'python3 -c "import os, time; os.setsid(); time.sleep(1)" & exit 0'], ".")
    print("no timeout")
except subprocess.TimeoutExpired:
    print("timed out")
except OSError as problem:
    print(f"{type(problem).__name__}: {problem}")
PY
)" "timed out"
check "a command missing on this machine says so" "$(has '_`no-such-command-here` could not run: ')" "1"
check "a facts line only the PR's head declares is not run" "$(has 'leaked-from-the-head') $(has '**Token**')" "0 0"
check "a comment marker in declared output is escaped" "$(count "$block" '<!-- pr-facts:end -->') $(has '&lt;!-- pr-facts:end -->') $(has '&lt;!-- pr-facts:record:start -->')" "1 1 1"
printf 'evil <!-- pr-facts:end -->\tcompleted\tsuccess\n' > "$FAKE/extra_check"
named=$(python3 "$D/facts.py" 7 --dry-run); rm "$FAKE/extra_check"
check "a comment marker in a check name is escaped" "$(count "$named" '<!-- pr-facts:end -->') $(count "$named" 'evil &lt;!-- pr-facts:end -->')" "1 1"
check "a path outside the checkout is refused" "$(has 'secret-outside') $(has '_`../outside.md` is outside the checkout._')" "0 1"
rm perf.md && ln -s "$HOME/outside.md" perf.md
linked=$(python3 "$D/facts.py" 7 --dry-run)
check "a file that links outside the checkout is refused" "$(count "$linked" 'secret-outside') $(count "$linked" '_`perf.md` is outside the checkout._')" "0 1"
rm perf.md && echo "| bytes | 198,603 |" > perf.md

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
printf '## Summary\n\nDoes the thing.\n' > "$FAKE/stale"
echo 1 > "$FAKE/clobbers"
check "a record-only refresh outruns a bot that drops the block" "$(python3 "$D/facts.py" 7 --record-only)" "review record refreshed on PR #7 for ${head:0:8} after 2 writes"
check "and puts the same facts back" "$(sed -n '/pr-facts:start/,/pr-facts:record:start/p' "$FAKE/body")" "$facts_before"
sed 's/201,000/205,000/' "$FAKE/body" > "$FAKE/stale"; echo 1 > "$FAKE/swap_on_read"
python3 "$D/facts.py" 7 --record-only >/dev/null
check "a record-only refresh describes the facts it keeps, when another writer changed them meanwhile" "$(sed -n '/pr-facts:record:start/,/pr-facts:record:end/p' "$FAKE/body" | grep -c 'STALE BODY') $("$D/log.sh" --check "$head" 7 | tail -1)" "1 Not clean on ${head:0:8}: spec"
rm -f "$FAKE/swap_on_read"
cp "$FAKE/body" "$FAKE/body.kept"
blk=$(sed -n '/^<!-- pr-facts:start -->$/,/^<!-- pr-facts:end -->$/p' "$FAKE/body")
printf '## Summary\n\nDoes the thing.\n\n## Facts\n\n%s\n\n## Merge Danger\n\nTwo-way.\n' "$blk" > "$FAKE/body"
"$D/log.sh" --pass spec "$head" clean "$FAKE/body"
printf '## Summary\n\nDoes the thing.\n\n## Facts\n\n## Merge Danger\n\nTwo-way.\n' > "$FAKE/stale"
echo 1 > "$FAKE/clobbers"
python3 "$D/facts.py" 7 --record-only >/dev/null
check "a retry that moves the block gets a record of the body it left" "$(sed -n '/pr-facts:record:start/,/pr-facts:record:end/p' "$FAKE/body" | grep -E '^(Every|Not clean)')" "$("$D/log.sh" --check "$head" 7 | tail -1)"
rm -f "$FAKE/clobbers"; mv "$FAKE/body.kept" "$FAKE/body"
python3 "$D/facts.py" 7 >/dev/null
check "a full refresh reruns the measured facts, so Spec goes round again" "$("$D/log.sh" --check "$head" 7 | tail -1)" "Not clean on ${head:0:8}: spec"
check "and the record it writes says so" "$(sed -n '/pr-facts:record:start/,/pr-facts:record:end/p' "$FAKE/body" | grep -c 'STALE BODY')" "1"
printf '## Summary\n\nDoes the thing.\n' > "$FAKE/stale"
echo 1 > "$FAKE/clobbers"
check "a bot's stale rewrite is outrun" "$(python3 "$D/facts.py" 7)" "facts block written to PR #7 for ${head:0:8} after 2 writes"
check "the bot's own section survives the retry" "$(grep -c 'rewritten from an old copy' "$FAKE/body")" "1"
echo 5 > "$FAKE/clobbers"
check "a body that keeps losing the block fails" "$(python3 "$D/facts.py" 7 >/dev/null 2>&1; echo $?)" "1"
printf '## Summary\n\nDoes the thing.\n\n<!-- pr-facts:start -->\nan older block\n<!-- pr-facts:record:start -->\nEvery required pass is clean\n<!-- pr-facts:record:end -->\n<!-- pr-facts:end -->\n' > "$FAKE/stale"
rm -f "$FAKE/clobbers"; echo 3 > "$FAKE/swap_on_read"
python3 "$D/facts.py" 7 >/dev/null
check "a bot's older copy between the two writes loses to the fresh facts" "$(grep -c 'an older block' "$FAKE/body") $(grep -c '^\*\*Checks:\*\* 5 on this head' "$FAKE/body")" "0 1"
rm -f "$FAKE/swap_on_read"
echo 2 > "$FAKE/move_head_on_read"
check "a push between the two writes stops facts.py before it records the old head" "$(python3 "$D/facts.py" 7 2>&1 >/dev/null | grep -c "head moved to ffffffff")" "1"
rm -f "$FAKE/move_head_on_read"; echo "$head" > "$FAKE/head"
echo 2 > "$FAKE/move_head_on_patch"
check "a push during the last write fails rather than leaving the old head's facts" "$(python3 "$D/facts.py" 7 2>&1 >/dev/null | grep -c "head moved to ffffffff")" "1"
echo "$head" > "$FAKE/head"; echo 1 > "$FAKE/move_head_on_patch"
check "and so does one during a record-only write" "$(python3 "$D/facts.py" 7 --record-only 2>&1 >/dev/null | grep -c "head moved to ffffffff")" "1"
rm -f "$FAKE/move_head_on_patch"; echo "$head" > "$FAKE/head"
echo 1 > "$FAKE/edit_after_read"
check "an edit made while the block is built stops the write instead of being overwritten" "$(python3 "$D/facts.py" 7 >/dev/null 2>&1; echo $?) $(grep -c "A person's edit" "$FAKE/body")" "1 1"
rm -f "$FAKE/edit_after_read"; sed -i.bak "/A person's edit/d" "$FAKE/body" && rm -f "$FAKE/body.bak"
printf '## Summary\n\nDoes an older thing.\n' > "$FAKE/stale"
echo 1 > "$FAKE/clobbers"
check "a stale copy of the author's text is refused, not written back" "$(python3 "$D/facts.py" 7 2>&1 >/dev/null | grep -c "own text changed")" "1"
rm "$FAKE/clobbers"
printf '## Summary\n\nNo block yet.\n' > "$FAKE/body"
check "a record-only refresh needs a block to refresh" "$(python3 "$D/facts.py" 7 --record-only 2>&1 >/dev/null | grep -c 'run facts.py <pr> first')" "1"
printf 'text\n<!-- pr-facts:end -->\n<!-- pr-facts:start -->\n' > "$FAKE/body"
check "broken markers are refused, not guessed at" "$(python3 "$D/facts.py" 7 2>&1 >/dev/null | grep -c 'markers are broken')" "1"

git switch -q -c trusted origin/main
printf '%s\n' '- facts: Trusted = run: printf from-the-default-branch' > docs/agents/pr-loop.md
git commit -q -am "the default branch's declaration" && git push -q origin trusted && git update-ref -d refs/remotes/origin/trusted
git switch -q feat/x && echo trusted > "$FAKE/default"
git config remote.origin.fetch +refs/heads/feat/x:refs/remotes/origin/feat/x && git update-ref -d refs/remotes/origin/main
trusted=$(python3 "$D/facts.py" 7 --dry-run)
check "a one-branch clone fetches the base and the default branch GitHub names, and facts come from the latter, not main or the head" "$(count "$trusted" '^from-the-default-branch$') $(count "$trusted" '^chromium ')" "1 0"
git switch -q --detach HEAD~1
away=$(python3 "$D/facts.py" 7 --dry-run)
check "a checkout away from the PR head runs no declared fact" "$(count "$away" 'from-the-default-branch') $(count "$away" 'not the PR head; rerun')" "0 1"
git switch -q feat/x

exit $fail
