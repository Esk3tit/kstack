---
description: Loop Codex CLI code review and fixes on the current PR/branch until no findings remain
argument-hint: [--max-iterations N] [--model MODEL] [--base BRANCH] [--fast]
---

# /codexloop

## Purpose
Run the Codex CLI (state-of-the-art GPT model) against the current PR or branch to perform a code review, then fix any **real** findings it reports. Repeat until Codex returns no substantive findings (or the max iteration cap is hit).

**Scope of review:** logical errors, bugs, broken edge cases, security/race issues, incorrect error handling, real convention violations. Nitpicks are **OK only when they meaningfully improve code quality** — naming clarity, following established repo conventions, removing dead code, fixing misleading comments. **NOT** in scope: formatting/styling churn, bikeshedding, unnecessary extra tests for trivial behavior, bloated defensive programming or fallbacks for impossible states, premature abstractions, or any "nice-to-have" suggestion that adds complexity without solving a real problem.

**Claude's role:** You are the human-in-the-loop reviewer of Codex's review. Push back. Don't rubber-stamp every finding — reject anything that's pure bikeshedding, a flip-flop, or unnecessary complexity. Accept nits only when they genuinely improve quality. Keep the diffs clean and simple, with no extra explanatory comments.

## Contract
**Inputs:**
- `--max-iterations N` — safety cap on loop count (default: 5)
- `--model MODEL` — Codex model override (default: Codex's own configured default — the latest state-of-the-art model; never pin a specific version)
- `--base BRANCH` — base branch to diff against (default: auto-detect `master` or `main`)
- `--fast` — shorthand that maps to `--enable fast_mode` on the codex invocation (NOT a literal codex flag named `--fast`)

**Outputs:** `STATUS=<CLEAN|MAX_ITERATIONS|FAIL> ITERATIONS=<N> FINDINGS_REMAINING=<N> [ERROR="..."]`

## Instructions

**First, invoke the `codex-cli` skill** (via the Skill tool) — it is the source of truth for the reliable Codex CLI invocation recipe. Follow it for every `codex` call below. (Note: for the `codex exec review` subcommand specifically, the constraints in step 2b below are authoritative — `review` does not take a custom prompt or honor `--output-schema`; the skill's `--output-schema` guidance applies to plain `codex exec`, not `exec review`.)

1. **Preflight — validate environment and inputs:**
   - Confirm `codex` CLI is installed: `command -v codex` (fail with install hint if missing)
   - Confirm working tree is clean or changes are committed (abort if dirty untracked fixes in progress)
   - Determine base branch: explicit `--base` arg wins; otherwise auto-detect via `git symbolic-ref refs/remotes/origin/HEAD` (falls back to `master` then `main`). Confirm it exists
   - Parse optional `--max-iterations` (default 5) and `--model` (default: current Codex default)
   - Parse `--fast` flag. `--fast` is shorthand, NOT a literal codex flag: when set, add `--enable fast_mode` to every `codex exec review` invocation in the loop (e.g., `codex exec review --base … --enable fast_mode`). Report fast mode status to the user
   - Determine the review target (passed to `codex exec review`, which gathers the diff itself):
     - If on a PR branch with an open PR → `--base origin/<baseRefName>` from `gh pr view --json baseRefName`
     - If the branch has commits beyond base → `--base origin/<base>`
     - If reviewing only uncommitted working-tree changes → `--uncommitted`
   - Report the review target to the user before starting the loop

2. **Loop: review → fix → repeat.**
   For each iteration (1..max-iterations):

   **a. Refresh the base ref.** `codex exec review` gathers the diff from git **itself** — do NOT build or pipe a diff. (Large diffs piped through stdin get killed by MCP-reconnect churn; the native `review` subcommand is reliable.) Just make the base ref current:
   ```bash
   git fetch origin <base> --quiet
   ```

   **b. Invoke Codex for review.** Use the **`codex exec review`** subcommand — it gathers the diff from git **itself**, so pass NO diff and close stdin with `< /dev/null`.

   **Two hard constraints of `codex exec review`** (verified on codex-cli 0.142.0; current behavior — `--help` lists these flags, but the parser/subcommand reject or ignore them, so do NOT use them):
   - **No custom PROMPT alongside a target selector.** `--base` / `--uncommitted` / `--commit` are mutually exclusive with `[PROMPT]` (even piping the prompt via `-`). Passing both hard-errors: `the argument '--base <BRANCH>' cannot be used with '[PROMPT]'`. So do **not** pass review instructions to `review` — it runs Codex's default reviewer, and YOU enforce the scope (Purpose + step 2d) when filtering findings.
   - **No structured-output mode.** `codex exec review` ignores `--output-schema`/`--json` and writes its **human-readable (prose) review** to `-o`. Do **not** pass `--output-schema`, and do **not** try to `JSON.parse` the output. (Structured `--output-schema` only works with plain `codex exec` + a piped diff — which this command avoids because diff-piping is unreliable.)

   Invocation (no prompt, no schema — `-o` captures the prose review; `--fast` → `--enable fast_mode`; `--model` only when overridden):
   ```bash
   # --base origin/<base> for a committed branch; swap to --uncommitted for working-tree changes.
   codex exec review --base origin/<base> ${FAST:+--enable fast_mode} ${MODEL:+--model "$MODEL"} \
     -o /tmp/codexloop-review.txt < /dev/null 2>/tmp/codexloop-review.err
   ```
   If codex exits non-zero **and** `/tmp/codexloop-review.txt` is empty (or `.err` shows an auth/network failure), treat Codex as failed — `STATUS=FAIL ERROR="codex review failed: <reason>"`, never CLEAN.

   **c. Read the review and extract findings (it's prose, not JSON):**
   - Read `/tmp/codexloop-review.txt`. The review is human-readable: a one-line summary, and — when there are issues — a `Full review comments:` list of bullets, each typically `- [P1|P2|P3] <title> — <file>:<line>` with an indented description (Codex's suggested direction). Treat each bullet as a finding (priority P1/P2/P3 ≈ high/medium/low, plus `file:line` and the issue).
   - **CLEAN detection (prose):** if the review surfaces **no** actionable findings — no `- [P…]` finding bullets AND the summary indicates nothing blocking (e.g. "No actionable … issues were found", "did not find any … issues that warrant blocking the patch") — print `STATUS=CLEAN ITERATIONS=<n>` and exit the loop.
   - Otherwise list the findings to the user (priority, `file:line`, issue) and proceed to 2d.

   **d. Apply fixes — push back, don't rubber-stamp:**
   - You (Claude) are the reviewer of Codex's review. Do NOT agree with everything at face value. For each finding, decide: is this a real logical error / bug / edge case, OR a nit that meaningfully improves quality, OR is Codex inventing work?
   - **Accept** real issues (logic, bugs, edge cases, security) AND nits that meaningfully improve quality (clearer naming, repo-convention alignment, dead-code removal, fixing misleading comments)
   - **Reject and skip** findings that are: formatting/styling churn, pure bikeshedding, defensive code for impossible states, bloated fallbacks, premature abstractions, "while you're here" refactors, unnecessary extra tests for trivial behavior, or anything that adds complexity/bloat without fixing a real problem. Note the rejection in the summary — don't fabricate a change to silence it
   - **Watch for flip-flopping across iterations.** If Codex now suggests reverting or contradicting a change it (or a prior iteration) requested, STOP. Do not apply it. Treat flip-flop as a signal the loop has converged — exit with `STATUS=CLEAN` and surface the contradiction to the user. Keep a short ledger of prior iterations' applied changes (e.g., commit messages or `/tmp/codexloop-history.txt`) and cross-check each new finding against it before acting
   - For findings you accept, read the referenced file and apply the **smallest correct fix** (prefer Edit over Write). Do NOT blindly apply Codex's suggested fix — verify against the actual code and reject if wrong or out of scope
   - **Keep it clean.** Do not leave explanatory comments about the fix, the finding, or the iteration. No "// addressed in codexloop" markers, no narrating-what-the-code-does comments. Only add a comment if a genuinely non-obvious invariant requires it
   - Run fast verification after fixes using repo-appropriate commands (e.g., `make lint`, `pnpm run lint`, `npm run lint`, and relevant `pytest`/`vitest`/`playwright` if test files changed)

   **e. Commit fixes:**
   - Stage only files you changed (never `git add -A`)
   - Conventional commit: `fix(codexloop): address iteration <n> findings`
   - Append a one-line ledger entry to `/tmp/codexloop-history.txt` summarizing what was changed/rejected this iteration (used for flip-flop detection next iteration)
   - If every finding this iteration was rejected (no real issues), exit with `STATUS=CLEAN` instead of committing — the loop has converged
   - Do NOT push mid-loop — only after the loop exits CLEAN (see step 4)

3. **Exit conditions:**
   - `STATUS=CLEAN` — Codex returned zero findings, or every remaining finding was a rejected nit/flip-flop
   - `STATUS=MAX_ITERATIONS` — hit cap with real findings remaining; print remaining findings for human review and DO NOT push
   - `STATUS=FAIL ERROR="..."` — Codex CLI error (non-zero exit with no review output / auth failure), lint/test failure, or merge conflict; DO NOT push

4. **Post-loop push (only on `STATUS=CLEAN`):**
   - Confirm current branch is not `master`/`main` (abort push if it is)
   - Confirm commits exist beyond the base: `git log origin/<base>..HEAD --oneline` is non-empty
   - Push the current branch with upstream tracking: `git push -u origin HEAD`
   - Never force-push. If the remote has diverged, STOP and surface the conflict to the user instead
   - If an open PR exists for this branch, print its URL (`gh pr view --json url -q .url`); otherwise leave PR creation to the user

5. **Final summary:**
   - Print iteration count, total findings addressed (by severity), files touched, push status, and current git status
   - If pushed: print the remote URL and any associated PR URL

## Constraints
- **Review for real problems first** — logical errors, bugs, broken edge cases, security/race issues. Nits welcome only when they meaningfully improve quality (naming clarity, repo conventions, dead-code removal, fixing misleading comments). Reject formatting churn, bikeshedding, and unnecessary extra tests
- **Keep it simple** — reject any suggestion that adds complexity, abstractions, bloated fallbacks, or defensive checks for impossible states without fixing a real problem
- **Push back on Codex** — Claude is the human-in-the-loop, not a rubber stamp. Skip findings that aren't necessary and note the rejection. Don't fabricate changes to silence findings
- **`codex exec review` takes no prompt and emits prose** — never pass a custom PROMPT with `--base`/`--uncommitted`/`--commit` (hard error) and never pass `--output-schema` (ignored; output is prose, not JSON). Read the prose review from `-o`; apply the review scope yourself when filtering
- **Detect flip-flops** — if Codex contradicts a prior iteration's change (suggesting to revert or invert it), STOP and exit CLEAN. The loop has converged. Maintain `/tmp/codexloop-history.txt` and cross-check each iteration against it
- **No explanatory comments** — keep diffs clean. No "// per codex review" or narrative comments. Comments only for non-obvious invariants
- **Push only on CLEAN exit** — never push mid-loop, never push on MAX_ITERATIONS or FAIL, never push to `master`/`main`, never force-push
- **Never skip hooks** (no `--no-verify`)
- **Hard cap** iterations via `--max-iterations` to prevent infinite loops on flaky findings
- **Do not rewrite/amend existing commits** — always create new commits per iteration
- **Fail closed** on a Codex CLI failure (non-zero exit with empty review output, or an auth/network error) rather than guessing — never treat a failed run as CLEAN
- Idempotent re-entry: if re-run after a clean pass, loop exits immediately with `STATUS=CLEAN ITERATIONS=0` (no push needed; already up to date)
