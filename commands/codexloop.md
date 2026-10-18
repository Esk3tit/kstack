---
description: Loop Codex code review and fixes on the current PR/branch until no findings remain (via the openai-codex plugin primitives)
argument-hint: [--max-iterations N] [--model MODEL] [--base BRANCH] [--scope auto|working-tree|branch]
---

# /codexloop

## Purpose
Run Codex against the current PR or branch to perform a code review, then fix any **real** findings it reports. Repeat until Codex returns no substantive findings (or the max iteration cap is hit).

**Scope of review:** logical errors, bugs, broken edge cases, security/race issues, incorrect error handling, real convention violations. Nitpicks are **OK only when they meaningfully improve code quality** — naming clarity, following established repo conventions, removing dead code, fixing misleading comments. **NOT** in scope: formatting/styling churn, bikeshedding, unnecessary extra tests for trivial behavior, bloated defensive programming or fallbacks for impossible states, premature abstractions, or any "nice-to-have" suggestion that adds complexity without solving a real problem.

**Claude's role:** You are the human-in-the-loop reviewer of Codex's review. Push back. Don't rubber-stamp every finding — reject anything that's pure bikeshedding, a flip-flop, or unnecessary complexity. Accept nits only when they genuinely improve quality. Keep the diffs clean and simple, with no extra explanatory comments.

## Mechanism — use the Codex plugin (openai-codex/codex) primitives, NOT a hand-rolled `codex exec` call

This command drives Codex **exclusively through the installed `openai-codex/codex` plugin's companion runtime** (`scripts/codex-companion.mjs`). Do **not** shell out to `codex exec` / `codex exec review` directly — the plugin primitives take priority and are the source of truth for how Codex is invoked here.

The review step calls the companion's **`adversarial-review`** subcommand (the same engine `/codex:adversarial-review` and the stop-time review gate use). It is the right primitive for this loop because, unlike the native `review`, it:
- returns **structured JSON** — `{verdict, summary, findings[], next_steps[]}`, each finding `{severity, title, body, file, line_start, line_end, recommendation}` — so CLEAN detection and finding extraction are exact, not prose-scraped;
- **accepts custom focus text**, so this command's review scope (below) is passed straight to Codex to steer it.

**Resolve the companion script once, at the top of the run** (this is a user command, so `CLAUDE_PLUGIN_ROOT` is usually unset — fall back to the plugin cache, newest version wins):
```bash
COMPANION="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/codex-companion.mjs}"
if [ -z "$COMPANION" ] || [ ! -f "$COMPANION" ]; then
  COMPANION=$(ls -1 "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | sort -V | tail -1)
fi
[ -n "$COMPANION" ] && [ -f "$COMPANION" ] || { echo 'STATUS=FAIL ERROR="openai-codex plugin not found — install it (/plugin install codex@openai-codex) and run /codex:setup"'; exit 0; }
```
The companion runs the review **foreground/blocking** (no background path for reviews), prints one JSON object with `--json`, and sets a non-zero exit code on Codex failure. A round can outlast the Bash timeout, so launch it from a background shell and wait on its output file.

## Contract
**Inputs:**
- `--max-iterations N` — safety cap on loop count (default: 5)
- `--until-converged` — no iteration cap. The loop has converged after two consecutive rounds with no accepted finding, or on a flip-flop. Each committed iteration is pushed right away, so bots and the next round review the same head. `/pr-loop` runs this mode.
- `--model MODEL` — Codex model passed to the companion (default: the Codex model `CLAUDE.md` names for Codex work; always pass it, since the Codex config sets no default)
- `--base BRANCH` — base branch to diff against (default: auto-detect `master` or `main`)
- `--scope auto|working-tree|branch` — review target passed to the companion (default: `auto`; the companion resolves working-tree vs branch when `auto`)

**Outputs:** `STATUS=<CLEAN|MAX_ITERATIONS|FAIL> ITERATIONS=<N> FINDINGS_REMAINING=<N> [ERROR="..."]`

## Instructions

1. **Preflight — validate environment and inputs:**
   - Resolve `$COMPANION` as above (fail with the install/setup hint if not found).
   - Confirm Codex is ready and authenticated via the plugin, not `command -v codex`:
     ```bash
     node "$COMPANION" setup --json
     ```
     Require `.ready === true` and `.auth.loggedIn === true`. If not, `STATUS=FAIL ERROR="Codex not ready — run /codex:setup"` and stop (do not improvise an auth flow).
   - Confirm working tree is clean or changes are committed (abort if dirty untracked fixes in progress).
   - Determine base branch: explicit `--base` arg wins; otherwise auto-detect via `git symbolic-ref refs/remotes/origin/HEAD` (falls back to `master` then `main`). Confirm it exists.
   - Parse optional `--max-iterations` (default 5), `--model` (default: the Codex model `CLAUDE.md` names), and `--scope` (default `auto`).
   - Determine the review target and map it to companion flags:
     - On a PR branch with an open PR → `--scope branch --base origin/<baseRefName>` (from `gh pr view --json baseRefName`).
     - Branch has commits beyond base → `--scope branch --base origin/<base>`.
     - Only uncommitted working-tree changes → `--scope working-tree`.
   - Report the resolved companion path, model, and review target to the user before starting the loop.

2. **Loop: review → fix → repeat.**
   For each iteration (1..max-iterations):

   **a. Refresh the base ref.** The companion gathers the diff from git **itself** — do NOT build or pipe a diff. Just make the base ref current:
   ```bash
   git fetch origin <base> --quiet
   ```

   **b. Invoke the review primitive.** Pass this command's review scope as the adversarial-review **focus text**, request JSON, and capture it:
   ```bash
   FOCUS='Review for real defects: logical errors, bugs, broken edge cases, security/race conditions, incorrect error handling, and genuine repo-convention violations. Report nits only when they meaningfully improve quality (naming clarity, dead-code removal, misleading comments). Do NOT report: formatting/style churn, bikeshedding, defensive code for impossible states, premature abstractions, or extra tests for trivial behavior.'
   PINS=$(~/.claude/skills/recap-pr/log.sh --pins)  # the user's settled decisions
   [ -n "$PINS" ] && FOCUS="$FOCUS Settled decisions (do not re-open; report only defects within them): $PINS"
   node "$COMPANION" adversarial-review --scope <scope> ${BASE:+--base "origin/$BASE"} ${MODEL:+--model "$MODEL"} --json "$FOCUS" \
     > /tmp/codexloop-review.json 2>/tmp/codexloop-review.err
   ```
   If the companion exits non-zero **and** the JSON is missing/empty (or `.err` shows an auth/network failure), treat Codex as failed — `STATUS=FAIL ERROR="codex review failed: <reason>"`, never CLEAN.

   **c. Parse the structured findings** (extract compactly with node so raw JSON stays out of context):
   ```bash
   node -e '
   const j=JSON.parse(require("fs").readFileSync("/tmp/codexloop-review.json","utf8"));
   if(j.parseError && !j.result){console.log("PARSE_ERROR: "+j.parseError);process.exit(0);}
   const f=(j.result&&j.result.findings)||[];
   const rank={critical:0,high:1,medium:2,low:3};
   console.log("VERDICT: "+((j.result&&j.result.verdict)||"n/a"));
   console.log("COUNT: "+f.length);
   f.sort((a,b)=>(rank[a.severity]??3)-(rank[b.severity]??3)).forEach(x=>{
     console.log(`- [${x.severity}] ${x.title} (${x.file}:${x.line_start||"?"})`);
     if(x.body)console.log("  "+x.body.replace(/\s+/g," "));
     if(x.recommendation)console.log("  rec: "+x.recommendation.replace(/\s+/g," "));
   });'
   ```
   - **CLEAN detection:** `COUNT: 0` (empty `findings`) → print `STATUS=CLEAN ITERATIONS=<n>` and exit the loop.
   - **PARSE_ERROR with no result:** retry the review once; if it still fails, `STATUS=FAIL ERROR="codex returned unparseable review"`. Never treat a parse failure as CLEAN.
   - Otherwise list the findings to the user (severity, `file:line`, issue) and proceed to 2d.

   **d. Apply fixes — push back, don't rubber-stamp:**
   - You (Claude) are the reviewer of Codex's review. Do NOT agree with everything at face value. For each finding, decide: is this a real logical error / bug / edge case, OR a nit that meaningfully improves quality, OR is Codex inventing work?
   - **Accept** real issues (logic, bugs, edge cases, security) AND nits that meaningfully improve quality (clearer naming, repo-convention alignment, dead-code removal, fixing misleading comments).
   - **Reject and skip** findings that are: formatting/styling churn, pure bikeshedding, defensive code for impossible states, bloated fallbacks, premature abstractions, "while you're here" refactors, unnecessary extra tests for trivial behavior, or anything that adds complexity/bloat without fixing a real problem. Note the rejection in the summary — don't fabricate a change to silence it.
   - **Watch for flip-flopping across iterations.** If Codex now suggests reverting or contradicting a change it (or a prior iteration) requested, STOP. Do not apply it. Treat flip-flop as a signal the loop has converged — exit with `STATUS=CLEAN` and surface the contradiction to the user. Cross-check each new finding against this repo's `codexloop` rows in the decision log from this run's first round on.
   - **Apply the mechanism rule** in `~/.claude/skills/recap-pr/LEDGER.md` to every finding that adds a mechanism.
   - **Log every finding**, accepted or rejected, as one decision-log row (`phase codexloop`, `source codex`, `asked no`; format in LEDGER.md). The user audits these rows with `/recap-pr` before merge.
   - For findings you accept, read the referenced file and apply the **smallest correct fix** (prefer Edit over Write). Do NOT blindly apply Codex's `recommendation` — verify against the actual code and reject if wrong or out of scope.
   - **Optional escalation:** for a genuinely hard finding that needs deep multi-file debugging (not a smallest-fix), you may subcontract that one fix to Codex via the plugin's rescue primitive — `node "$COMPANION" task --write "<tight fix prompt>"` (equivalent to `/codex:rescue`) — then review its diff before staging. Default remains: Claude applies the fix.
   - **Keep it clean.** Do not leave explanatory comments about the fix, the finding, or the iteration. No "// addressed in codexloop" markers, no narrating-what-the-code-does comments. Only add a comment if a genuinely non-obvious invariant requires it.
   - Run fast verification after fixes using repo-appropriate commands (e.g., `make lint`, `pnpm run lint`, `npm run lint`, and relevant `pytest`/`vitest`/`playwright` if test files changed).

   **e. Commit fixes:**
   - Stage only files you changed (never `git add -A`).
   - Conventional commit whose subject says what the fix changed, in the repo's own scope (`fix(api): keep the newest retry token instead of the first`), one commit per iteration.
   - If every finding this iteration was rejected (no real issues), exit with `STATUS=CLEAN` instead of committing — the loop has converged.
   - Do NOT push mid-loop — only after the loop exits CLEAN (see step 4). Under `--until-converged`, push each committed iteration instead.

3. **Exit conditions:**
   - `STATUS=CLEAN` — Codex returned zero findings, or every remaining finding was a rejected nit/flip-flop. Under `--until-converged`, CLEAN needs two such rounds in a row (or a flip-flop).
   - `STATUS=MAX_ITERATIONS` — hit cap with real findings remaining; print remaining findings for human review and DO NOT push.
   - `STATUS=FAIL ERROR="..."` — Codex companion error (non-zero exit with no review output / auth failure / unparseable review), lint/test failure, or merge conflict; DO NOT push.

4. **Post-loop push (only on `STATUS=CLEAN`):**
   - Confirm current branch is not `master`/`main` (abort push if it is).
   - Confirm commits exist beyond the base: `git log origin/<base>..HEAD --oneline` is non-empty.
   - Push the current branch with upstream tracking: `git push -u origin HEAD`.
   - Never force-push. If the remote has diverged, STOP and surface the conflict to the user instead.
   - If an open PR exists for this branch, print its URL (`gh pr view --json url -q .url`); otherwise leave PR creation to the user.

5. **Final summary:**
   - Print iteration count, total findings addressed (by severity), files touched, push status, and current git status.
   - If pushed: print the remote URL and any associated PR URL.

## Constraints
- **Drive Codex only through the openai-codex plugin companion** (`codex-companion.mjs adversarial-review` for review, optionally `task --write` for escalated fixes). Do not call `codex exec`/`codex exec review` directly — the plugin primitives take priority.
- **Review for real problems first** — logical errors, bugs, broken edge cases, security/race issues. Nits welcome only when they meaningfully improve quality. Reject formatting churn, bikeshedding, and unnecessary extra tests.
- **Keep it simple** — reject any suggestion that adds complexity, abstractions, bloated fallbacks, or defensive checks for impossible states without fixing a real problem.
- **Push back on Codex** — Claude is the human-in-the-loop, not a rubber stamp. Skip findings that aren't necessary and note the rejection. Don't fabricate changes to silence findings.
- **Findings come as structured JSON** — parse `result.findings` (severity/title/body/file/line_start/recommendation); empty array = CLEAN. Never scrape prose and never treat a parse failure as CLEAN.
- **Detect flip-flops** — if Codex contradicts a prior iteration's change (suggesting to revert or invert it), STOP and exit CLEAN. The decision log's `codexloop` rows are the history to cross-check.
- **No explanatory comments** — keep diffs clean. No "// per codex review" or narrative comments. Comments only for non-obvious invariants.
- **Push only on CLEAN exit** (each committed iteration under `--until-converged`) — never push mid-loop otherwise, never push on MAX_ITERATIONS or FAIL, never push to `master`/`main`, never force-push.
- **Never skip hooks** (no `--no-verify`).
- **Hard cap** iterations via `--max-iterations` to prevent infinite loops on flaky findings, unless `--until-converged` was passed; its two-clean-rounds and flip-flop exits end the loop instead.
- **Do not rewrite/amend existing commits** — always create new commits per iteration.
- **Fail closed** on a companion failure (non-zero exit with empty review output, auth/network error, or unparseable review) rather than guessing — never treat a failed run as CLEAN.
- Idempotent re-entry: if re-run after a clean pass, loop exits immediately with `STATUS=CLEAN ITERATIONS=0` (no push needed; already up to date).
