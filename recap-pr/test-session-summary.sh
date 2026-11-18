#!/usr/bin/env bash
# Checks for session_summary.py on fixtures/session: executed calls only, each outcome apart, definitions printed. Run: bash test-session-summary.sh
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
S="$D/fixtures/session/s1.jsonl"

fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fail=1; fi; }
get() { python3 "$D/session_summary.py" "$S" --json | python3 -c 'import json,sys; v=json.load(sys.stdin); [v := v[k] for k in sys.argv[1:]]; print(json.dumps(v, sort_keys=True))' "$@"; }

check "a replayed api-request-blob and a repeated entry add no calls" "$(get tool_calls parent)" '{"Agent": 1, "Bash": 3, "Read": 1, "mcp__plugin_context-mode_context-mode__ctx_execute": 2, "mcp__plugin_context-mode_context-mode__ctx_search": 1}'
check "the subagents/ folder is read, its metadata is not" "$(get tool_calls subagents) $(get subagent_logs) $(get metadata_files)" '{"Grep": 1, "Read": 1} 1 1'
check "an error result counts once, by its tool" "$(get results error)" '{"Bash": 1, "Grep": 1}'
check "a hook denial is not an error" "$(get results "hook denial")" '{"Read": 1}'
check "indexed outputs are counted apart, a hook's and ctx_execute's own (escaped quotes too), not a search page's" "$(get results "indexed output")" '{"Bash": 1, "mcp__plugin_context-mode_context-mode__ctx_execute": 2}'
check "a compaction and its continuation summary are not user text" "$(get compaction_boundaries) $(get continuation_summaries) $(get user_text)" "1 1 1"
check "snapshots are skipped by type" "$(get skipped_entries)" '{"api-request": 1, "api-request-blob": 2}'
check "a line that is not JSON is counted, not fatal" "$(get unreadable_lines)" "1"
text=$(python3 "$D/session_summary.py" "$S")
check "the table totals the calls" "$(printf '%s\n' "$text" | grep -E '^  total' | tr -s ' ')" " total 8 2 2 1 0 3"
check "every definition prints with the counts" "$(printf '%s\n' "$text" | sed -n '/^Definitions:/,$p' | grep -c '^  [a-z]')" "9"
check "a missing file is refused" "$(python3 "$D/session_summary.py" "$D/nope.jsonl" >/dev/null 2>&1; echo $?)" "1"

exit $fail
