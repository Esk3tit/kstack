---
description: Loop a review from the other model family (Codex from Claude Code, Claude Opus 5.5 from Codex) and fixes on the current PR/branch until no findings remain
argument-hint: [--max-iterations N] [--until-converged] [--model MODEL] [--base BRANCH] [--scope auto|working-tree|branch]
---

# /codexloop

Inside T3, follow its injected instructions for app-owned review rounds and PR tracking; the native CLI transport below applies outside T3.

## Purpose
Have a reviewer from the **other model family** review the current PR or branch, then fix any **real** findings it reports. Repeat until the reviewer returns no substantive findings (or the max iteration cap is hit). The loop is the same in every harness; only the reviewer call differs.

**Scope of review:** logical errors, bugs, broken edge cases, security/race issues, incorrect error handling, real convention violations. Nitpicks are **OK only when they meaningfully improve code quality** — naming clarity, following established repo conventions, removing dead code, fixing misleading comments. **NOT** in scope: formatting/styling churn, bikeshedding, unnecessary extra tests for trivial behavior, bloated defensive programming or fallbacks for impossible states, premature abstractions, or any "nice-to-have" suggestion that adds complexity without solving a real problem.

**Your role:** you are the human-in-the-loop reviewer of the reviewer. Push back. Don't rubber-stamp every finding — reject anything that's pure bikeshedding, a flip-flop, or unnecessary complexity. Accept nits only when they genuinely improve quality. Keep the diffs clean and simple, with no extra explanatory comments.

## Reviewer — the other model family

Pick by the harness you are running in. Both reviewers return the same JSON, `{verdict, summary, findings[]}`, each finding `{severity, title, body, file, line_start, line_end, recommendation}`, written to `review.json` (under `R`, or in Codex under the directory `claude-review` prints) as `{"result": <that object>}` or `{"parseError": ...}`, so the steps below are the same for both. `R` is a fresh directory per round, so a stale review never reads as the new one and parallel loops in sibling repos never share files:
```bash
mktemp -d "/tmp/codexloop-$(basename "$(git rev-parse --show-toplevel)").XXXXXX"
```
Use the printed path as `R` for the whole round. Shell variables do not survive between shell calls in either harness: write `COMPANION`, `R`, `SCOPE`, `BASE` and `MODEL` into each command as literals, and run step 2b's `FOCUS`/`PINS`/`REJECTED` lines in the same shell as the companion call in Claude Code, or as step 1's `printf` into `focus.txt` in Codex. A round can outlast the shell timeout: in Claude Code, launch it from a background shell and wait for that shell to exit; in Codex, run it in the foreground with a timeout of 30 minutes. `$SCOPE` is this round's target, resolved per preflight: `branch` or `working-tree` (an explicit `--scope` holds for every round).

### In Claude Code: Codex, through the openai-codex plugin

Drive Codex **only through the plugin's companion runtime** (`scripts/codex-companion.mjs`), never `codex exec` / `codex exec review`. Its **`adversarial-review`** subcommand (the engine behind `/codex:adversarial-review` and the stop-time review gate) returns the JSON above and **accepts focus text**, so this command's review scope steers it. Resolve the companion once (`CLAUDE_PLUGIN_ROOT` is usually unset for a user command, so fall back to the plugin cache, newest version wins):
```bash
COMPANION="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/codex-companion.mjs}"
if [ -z "$COMPANION" ] || [ ! -f "$COMPANION" ]; then
  COMPANION=$(ls -1 "$HOME"/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | sort -V | tail -1)
fi
[ -n "$COMPANION" ] && [ -f "$COMPANION" ] || { echo 'STATUS=FAIL ERROR="openai-codex plugin not found — install it (/plugin install codex@openai-codex) and run /codex:setup"'; exit 0; }
```
- **Ready check:** `node "$COMPANION" setup --json` must show `.ready === true` and `.auth.loggedIn === true`; otherwise `STATUS=FAIL ERROR="Codex not ready — run /codex:setup"` (do not improvise an auth flow).
- **Model:** the Codex model `CLAUDE.md` names for Codex work; always pass it, since the Codex config sets no default.
- **Review call** (the companion gathers the diff from git itself; it prints `{"result": ...}` with `--json` and exits non-zero on failure):
  ```bash
  node "$COMPANION" adversarial-review --scope "$SCOPE" ${BASE:+--base "origin/$BASE"} --model "$MODEL" --json "$FOCUS" \
    > "$R/review.json" 2>"$R/review.err"
  ```

### In Codex: Claude Opus 5.5, through `claude-review`

`claude -p` needs the network and the user's Claude login, so it must run outside the sandbox, and Codex's allow rules only match a plain command. So the Claude call lives in one script, `~/.codex/bin/claude-review` (a copy of kstack `codex/bin/`), allowed by a rule on its absolute path; it runs no git, so the review itself runs nothing from the reviewed repo unsandboxed. Codex runs every command in a fresh shell: write `R`, `BASE` and the focus text into each command as literal values, and run both steps below from the repo root (`git rev-parse --show-toplevel`), which the wrapper hands Claude.

- **Ready check:** `/Users/<you>/.codex/bin/claude-read claude-opus-5-5 "reply ok"` answers; otherwise `STATUS=FAIL ERROR="claude unavailable: <its error>"`.
- **Model:** `claude-opus-5-5`.
- **Review call.**
  1. In the sandbox, write the diff and the focus text. The default diff is the working tree against the merge-base, so committed fixes and any uncommitted work stay in review together; an explicit `--scope` narrows it. A failed `git diff` fails the round; the focus file spares the pins any shell quoting:
     ```bash
     MB=$(git merge-base "origin/$BASE" HEAD)
     git diff "$MB" > "$R/diff.patch"      # default (auto); --scope branch: git diff "$MB" HEAD; --scope working-tree: git diff HEAD
     git ls-files --others --exclude-standard --full-name :/ | sed 's/^/New file, not in the diff; read it: /' >> "$R/diff.patch"   # skip for --scope branch
     printf '%s' "$FOCUS" > "$R/focus.txt"
     ```
  2. Review it, as a plain command (no pipe, redirect or variable assignment, so the rule matches) with `$HOME` written out:
     ```bash
     /Users/<you>/.codex/bin/claude-review /tmp/codexloop-<repo>.XXXXXX claude-opus-5-5
     ```
  It prints the directory holding `review.json` (under `~/.cache`, out of the sandbox's reach); step 2c parses that directory instead of `R`. It reports every failure, including its stderr, as `parseError`.

## Contract
**Inputs:**
- `--max-iterations N` — safety cap on loop count (default: 5)
- `--until-converged` — no iteration cap; each round reviews the whole PR or only the fixes since the last round, and the loop ends as **Round scope** (below) says. Commits stay local until the loop converges, then step 4 pushes that head once, because bots and CI run on every push and bots bill per run. `/pr-loop` runs this mode.
- `--model MODEL` — reviewer model (default: the one its Reviewer section names)
- `--base BRANCH` — base branch to diff against (default: auto-detect `master` or `main`)
- `--scope auto|working-tree|branch` — review target (default: `auto`: branch when it has commits beyond base, else working-tree)

**Outputs:** `STATUS=<CLEAN|MAX_ITERATIONS|PAUSED|FAIL> ITERATIONS=<N> FINDINGS_REMAINING=<N> [ERROR="..."]`

## Round scope (`--until-converged`)

The loop ends on two clean rounds at the final head, the second over the whole PR: each fix gets a look aimed at it, and unchanged code is not re-read after every one-line fix. A round is **clean** when it commits nothing: zero findings, or every finding rejected (a flip-flop is one more rejected finding, surfaced to the user). Under `--until-converged` a clean round never exits by itself; the rules below pick the next round or declare convergence. (A `--scope working-tree` run reviews the working tree every round and converges on two clean rounds in a row.)

A branch-scope round reviews one of two scopes:

- **Whole PR:** the branch against its merge-base with `origin/<base>`. Its focus text also says what the change is for (its ticket, or a summary of the branch), so the reviewer can tell when the code doesn't do it.
- **Fixes:** only the commits since the last reviewed head. In Claude Code, the review call passes `--base <last reviewed head>` in place of `origin/<base>`; in Codex, the round's diff is `git diff <last reviewed head> HEAD`. The focus text adds, for each finding those commits fix, `Fixed since the last round: <title> (<file>:<line>), <the fix in one line>.`, then: `Check that each fix resolves its finding and breaks nothing the change reaches; read whole files, callers and tests, and report a defect wherever the change reaches. If the change needs the whole PR reviewed again, put WHOLE_PR in your summary.`

**Round rows.** A round logs two decision-log rows, each with `phase codexloop`, `source me`, `asked yes`, `prod_delta none` and result `accepted`: a dispatch row as it starts, and a round row once it is finished (its findings triaged, any accepted fix committed). The dispatch row's decision is `round <n> dispatched on <branch>`, its evidence `head <sha>, <whole-PR or fixes>`. The round row's decision is `round <n> (<whole-PR or fixes>) on <branch>: <k> findings, <a> accepted, <clean or fixed>` (plus `, reviewer asks whole-PR next` when its summary said `WHOLE_PR`), its evidence `head <sha the review ran on, before this round's fixes>, merge-base <sha>`. A round that ends without a review (the reviewer failed, or its run was lost) logs `round <n> dropped on <branch>` in place of a round row, with the reason as `why`.

- `~/.claude/skills/recap-pr/log.sh --rounds` prints the branch's last two round rows, oldest first: the last holds the **last reviewed head**, and survives a compacted context. It reads only this repo's and this branch's rows, since sibling repos and branches sharing a ticket can share one log; a round row without a branch counts for nothing.
- It exits 1, naming the round, while a dispatched round has neither a round row nor a dropped row: that round is still pending or untriaged. Wait for its review, triage it and log its round row, or log it dropped; dispatch nothing beside it.
- A run starts with a whole-PR round unless the branch already has a round row; then it picks up from that row.

Take the next round's scope from the first rule that applies:

1. The branch took in base changes since the last reviewed head (`git merge-base origin/<base> HEAD` differs from the logged one, or `git merge-base --is-ancestor <last reviewed head> HEAD` fails) → whole PR, since a fixes diff would carry the base's changes.
2. HEAD has commits since the last reviewed head → fixes, unless the last round row says `reviewer asks whole-PR next` or `git diff <last reviewed head> HEAD` is empty (an empty commit, or a fix and its revert), which take a whole-PR round instead.
3. The last round row says `clean` at this head. When that row is a whole-PR round and the round row before it is also `clean` at this head, the loop has converged: record the pass (`~/.claude/skills/recap-pr/log.sh --pass codexloop <head> clean`) and exit `STATUS=CLEAN` (on a re-run, `ITERATIONS=0`, and step 4 pushes only what the remote lacks). Otherwise → whole PR.

Inside T3, each delegated round's brief names its scope (for fixes, the last reviewed head) and carries the same focus lines, and the round is dispatched under the same `--rounds` check and dispatch row, so rounds run one at a time.

### Design pause

Five fixing rounds clustered in one area say the design is edge-case-prone, and the next move is a simpler design rather than another round. Once the rules above pick a round, run this check before it starts. A **pause row** is a decision-log row whose decision starts `design pause`, with a round row's fields apart from those named here.

1. Read the branch's last pause row. While its result is `open`, only a reply the user gave after it lets the run go on: log that reply as a pause row with source `you`, decision `design pause answered on <branch>: <the answer>` and result `accepted`. With no reply, exit `STATUS=PAUSED`.
2. Count the branch's round rows that say `fixed`, from its last `accepted` pause row, or else from its first round row. With fewer than five, the round starts.
3. At five or more, lay those rounds' accepted findings side by side. When most are edge cases of the same state, flow or component, they cluster: log a pause row with decision `design pause after round <n> on <branch>: <the area>` and result `open`, exit `STATUS=PAUSED`, and bring the user the cluster, its root cause and a simpler shape. Otherwise log that row with result `accepted`, and the round starts.

Done when the round has started or the run has exited `PAUSED`.

## Instructions

1. **Preflight — validate environment and inputs:**
   - Pick the reviewer for this harness and run its ready check.
   - Confirm working tree is clean or changes are committed (abort if dirty untracked fixes in progress).
   - Determine base branch: explicit `--base` arg wins; otherwise auto-detect via `git symbolic-ref refs/remotes/origin/HEAD` (falls back to `master` then `main`). Confirm it exists.
   - Parse optional `--max-iterations` (default 5), `--model` (default: the reviewer's), and `--scope` (default `auto`).
   - Determine the review target:
     - On a PR branch with an open PR → branch scope against `origin/<baseRefName>` (from `gh pr view --json baseRefName`).
     - Branch has commits beyond base → branch scope against `origin/<base>`.
     - Only uncommitted working-tree changes → working-tree scope. Resolve the target again each round, staying in working-tree scope while uncommitted changes remain; move to branch scope once the tree is clean.
   - Report the reviewer, model, and review target to the user before starting the loop.

2. **Loop: review → fix → repeat.**
   For each iteration (1..max-iterations):

   **a. Refresh the base ref:**
   ```bash
   git fetch origin <base> --quiet
   ```

   Under `--until-converged`, confirm `log.sh --rounds` exits 0, pick this iteration's round, run the **Design pause** check, and log the round's dispatch row (all in Round scope) now.

   **b. Run the review call** from the Reviewer section with this focus text, plus, under `--until-converged`, the round's scope and focus lines from **Round scope**:
   ```bash
   FOCUS='Review for real defects: logical errors, bugs, broken edge cases, security/race conditions, incorrect error handling, and genuine repo-convention violations. Report nits only when they meaningfully improve quality (naming clarity, dead-code removal, misleading comments). Do NOT report: formatting/style churn, bikeshedding, defensive code for impossible states, premature abstractions, or extra tests for trivial behavior.'
   PINS=$(~/.claude/skills/recap-pr/log.sh --pins)  # the user's settled decisions; /pr-loop puts RECAP_PIN_KEYS='<keys>' in front
   [ -n "$PINS" ] && FOCUS="$FOCUS Settled decisions (do not re-open; report only defects within them): $PINS"
   REJECTED=$(~/.claude/skills/recap-pr/log.sh --rejected)  # earlier rounds' rejected findings, by ID
   [ -n "$REJECTED" ] && FOCUS="$FOCUS Rejected in earlier rounds (settled; reopen one only with new evidence, giving its ID and the evidence): $REJECTED"
   ```
   In Claude Code, if the companion exits non-zero **and** the JSON is missing/empty (or `$R/review.err` shows an auth/network failure), treat the reviewer as failed — `STATUS=FAIL ERROR="review failed: <reason>"`, never CLEAN. In Codex, `claude-review` reports those failures as `parseError`, handled in 2c.

   **c. Parse the structured findings** (extract compactly with node so raw JSON stays out of context):
   ```bash
   node -e '
   const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/review.json","utf8"));
   if(j.parseError && !j.result){console.log("PARSE_ERROR: "+j.parseError);process.exit(0);}
   const f=(j.result&&j.result.findings)||[];
   const rank={critical:0,high:1,medium:2,low:3};
   console.log("VERDICT: "+((j.result&&j.result.verdict)||"n/a"));
   console.log("COUNT: "+f.length);
   console.log("SUMMARY: "+((j.result&&j.result.summary)||"").replace(/\s+/g," "));
   f.sort((a,b)=>(rank[a.severity]??3)-(rank[b.severity]??3)).forEach(x=>{
     console.log(`- [${x.severity}] ${x.title} (${x.file}:${x.line_start||"?"})`);
     if(x.body)console.log("  "+x.body.replace(/\s+/g," "));
     if(x.recommendation)console.log("  rec: "+x.recommendation.replace(/\s+/g," "));
   });' "<the round's R path>"
   ```
   - **CLEAN detection:** `COUNT: 0` (empty `findings`) → print `STATUS=CLEAN ITERATIONS=<n>` and exit the loop. Under `--until-converged`: a clean round (Round scope).
   - **PARSE_ERROR with no result:** retry the review once, in a fresh `R`; if it still fails, `STATUS=FAIL ERROR="reviewer returned unparseable review"`. Never treat a parse failure as CLEAN.
   - Otherwise list the findings to the user (severity, `file:line`, issue) and proceed to 2d.

   **d. Apply fixes — push back, don't rubber-stamp:**
   - Do NOT agree with everything at face value. For each finding, decide: is this a real logical error / bug / edge case, OR a nit that meaningfully improves quality, OR is the reviewer inventing work?
   - **Accept** real issues (logic, bugs, edge cases, security) AND nits that meaningfully improve quality (clearer naming, repo-convention alignment, dead-code removal, fixing misleading comments).
   - **Reject and skip** findings that are: formatting/styling churn, pure bikeshedding, defensive code for impossible states, bloated fallbacks, premature abstractions, "while you're here" refactors, unnecessary extra tests for trivial behavior, or anything that adds complexity/bloat without fixing a real problem. Note the rejection in the summary — don't fabricate a change to silence it.
   - **Watch for flip-flopping across iterations.** If the reviewer now suggests reverting or contradicting a change it (or a prior iteration) requested, STOP. Do not apply it. Treat flip-flop as a signal the loop has converged — exit with `STATUS=CLEAN` and surface the contradiction to the user. Under `--until-converged`: reject it as one more finding and surface it (Round scope). Cross-check each new finding against this repo's `codexloop` rows in the decision log from this run's first round on.
   - **Apply the mechanism rule** in `~/.claude/skills/recap-pr/LEDGER.md` to every finding that adds a mechanism.
   - **Log every finding**, accepted or rejected, as one decision-log row (`phase codexloop`, `source codex` or `claude`, `asked no`; format in LEDGER.md) whose decision starts with the finding's ID: `F<round>.<k>`, the round that first raised it and its place in that round's list. A finding that repeats an earlier one keeps that one's ID; one that repeats a rejected ID without new evidence is rejected again under it, and one with new evidence is judged afresh under it. The user audits these rows with `/recap-pr` before merge.
   - For findings you accept, read the referenced file and apply the **smallest correct fix** (prefer Edit over Write). Do NOT blindly apply the reviewer's `recommendation` — verify against the actual code and reject if wrong or out of scope.
   - **Optional escalation (Claude Code):** for a genuinely hard finding that needs deep multi-file debugging (not a smallest-fix), you may subcontract that one fix to Codex via the plugin's rescue primitive — `node "$COMPANION" task --write "<tight fix prompt>"` (equivalent to `/codex:rescue`) — then review its diff before staging. Default remains: you apply the fix.
   - **Keep it clean.** Do not leave explanatory comments about the fix, the finding, or the iteration. No "// addressed in codexloop" markers, no narrating-what-the-code-does comments. Only add a comment if a genuinely non-obvious invariant requires it.
   - Run fast verification after fixes using repo-appropriate commands (e.g., `make lint`, `pnpm run lint`, `npm run lint`, and relevant `pytest`/`vitest`/`playwright` if test files changed).

   **e. Commit fixes:**
   - Stage only files you changed (never `git add -A`).
   - Conventional commit whose subject says what the fix changed, in the repo's own scope (`fix(api): keep the newest retry token instead of the first`), one commit per iteration.
   - If every finding this iteration was rejected (no real issues), exit with `STATUS=CLEAN` instead of committing — the loop has converged. Under `--until-converged`: a clean round (Round scope).
   - Keep commits local until the loop exits CLEAN (step 4). Under `--until-converged` on a draft PR opened so CI can judge the change, also push a commit whose next step needs CI's answer; review bots can bill for that push too.

3. **Exit conditions:**
   - `STATUS=CLEAN` — the reviewer returned zero findings, or every remaining finding was a rejected nit/flip-flop. Under `--until-converged`: Round scope rule 3's convergence.
   - `STATUS=MAX_ITERATIONS` — hit cap with real findings remaining; print remaining findings for human review and DO NOT push.
   - `STATUS=PAUSED` — under `--until-converged`, the **Design pause** check stopped the run; DO NOT push.
   - `STATUS=FAIL ERROR="..."` — reviewer error (non-zero exit with no review output / auth failure / unparseable review), lint/test failure, or merge conflict; DO NOT push.

4. **Post-loop push (only on `STATUS=CLEAN`):**
   - Confirm current branch is not `master`/`main` (abort push if it is).
   - Confirm commits exist beyond the base: `git log origin/<base>..HEAD --oneline` is non-empty.
   - Push the current branch with upstream tracking: `git push -u origin HEAD`.
   - Never force-push. If the remote has diverged, STOP and surface the conflict to the user instead.
   - If an open PR exists for this branch, print its URL (`gh pr view --json url -q .url`).

5. **Final summary:**
   - Print iteration count, total findings addressed (by severity), files touched, push status, and current git status.
   - If pushed: print the remote URL and any associated PR URL.

## Constraints
- **The reviewer is always the other model family** — Codex through the plugin companion from Claude Code, Claude Opus 5.5 through `claude-review` from Codex. Never review your own family's work.
- **Review for real problems first** — logical errors, bugs, broken edge cases, security/race issues. Nits welcome only when they meaningfully improve quality. Reject formatting churn, bikeshedding, and unnecessary extra tests.
- **Keep it simple** — reject any suggestion that adds complexity, abstractions, bloated fallbacks, or defensive checks for impossible states without fixing a real problem.
- **Push back on the reviewer** — you are the human-in-the-loop, not a rubber stamp. Skip findings that aren't necessary and note the rejection. Don't fabricate changes to silence findings.
- **Findings come as structured JSON** — parse `result.findings` (severity/title/body/file/line_start/recommendation); empty array = CLEAN. Never scrape prose and never treat a parse failure as CLEAN.
- **Detect flip-flops** — if the reviewer contradicts a prior iteration's change (suggesting to revert or invert it), STOP and exit CLEAN (under `--until-converged`, reject it as one more finding; Round scope). The decision log's `codexloop` rows are the history to cross-check.
- **No explanatory comments** — keep diffs clean. No "// per review" or narrative comments. Comments only for non-obvious invariants.
- **Push only on CLEAN exit** (plus step 2e's draft PR push) — never push mid-loop otherwise, never push on MAX_ITERATIONS or FAIL, never push to `master`/`main`, never force-push.
- **Never skip hooks** (no `--no-verify`).
- **Hard cap** iterations via `--max-iterations` to prevent infinite loops on flaky findings, unless `--until-converged` was passed; its Round scope convergence ends the loop instead.
- **Do not rewrite/amend existing commits** — always create new commits per iteration.
- **Fail closed** on a reviewer failure (non-zero exit with empty review output, auth/network error, or unparseable review) rather than guessing — never treat a failed run as CLEAN.
- Idempotent re-entry: if re-run after a clean pass, loop exits immediately with `STATUS=CLEAN ITERATIONS=0` (no push needed; already up to date). Under `--until-converged`, Round scope's rules decide instead.
