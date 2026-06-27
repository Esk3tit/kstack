---
description: Address PR comments by reviewing, fixing valid issues, explaining invalid ones, and replying to each comment
argument-hint: [pr-number] [--loop]
---

# /address-pr-comments

## Purpose
Address **unresolved** PR comments left on a pull request using parallel subagents for efficient processing. Review each comment to determine if it's a valid issue. Fix valid issues, explain why invalid ones aren't issues. Display a summary table and reply to each PR comment with the action taken, then mark comments as resolved.

**Idempotent:** Safe to call multiple times on the same PR - only processes unresolved comments without replies.

**Loop mode (`--loop`):** Re-runs the full pass after pushing fixes, polling until every **in-scope** check is green AND no unresolved review comments remain. **In scope (gate the loop):** automated code-review bots/agents (Gemini Code Assist, CodeRabbit, Greptile, Codex / cloud PR review, Cursor BugBot, Sentry, etc.) plus lint/format and test check-runs (Prettier, ESLint, Ruff, pytest, vitest, Playwright). **Out of scope (never wait on or gate the loop):** CI/CD pipeline jobs — preview-environment deployments, build/publish steps, Docker image builds, infra provisioning. Each iteration: address comments → push → wait for in-scope bots/checks to re-review → repeat.

## Contract
**Inputs:**
- `$1` — PR number (optional, defaults to current branch's PR)
- `--loop` — keep processing comments + pushing + waiting for **in-scope** re-reviews until all in-scope checks are green and no unresolved review comments remain. **Scope — gate the loop on code-review bots/agents ONLY**, plus lint/format and test check-runs (a failing lint or test is a real problem to fix). In-scope sources: Gemini Code Assist, CodeRabbit, Greptile, Codex / cloud PR review, Cursor BugBot, Sentry, and similar; lint/format/test jobs (Prettier, ESLint, Ruff, pytest, vitest, Playwright). **Never watch, wait on, or gate the loop on CI/CD pipeline jobs** — preview-environment deployments, build/publish steps, Docker image builds, infra provisioning. A pending or failing deploy/preview check must not block convergence and is never treated as a finding to fix here. **No iteration cap** — bots like Cursor BugBot routinely take 20–30+ rounds to fully settle. The loop terminates only on convergence (CLEAN), genuine no-progress (FAIL), or user interrupt

**Outputs:** Summary table of comments and resolutions per iteration; loop status `LOOP_STATUS=<CLEAN|FAIL> ITERATIONS=<N>` when `--loop` is used

## Instructions

### Phase 1: Gather PR Comments

1. **Get PR information:**
   - If no PR number provided, find PR for current branch using `gh pr view --json number`
   - Fetch all review comments using `gh api repos/{owner}/{repo}/pulls/{pr}/comments`
   - Fetch review threads to check resolution status using `gh api graphql`

2. **Filter to unresolved comments only:**
   - Skip comments where `isResolved: true` in the review thread
   - Skip comments that already have replies (check if comment is part of a thread with responses)
   - Only process top-level unresolved comments that need attention
   - If no unresolved comments remain, report "No unresolved comments to address" and exit

### Phase 2: Analyze Comment Dependencies

3. **Classify comments by independence:**
   For each unresolved comment, determine if it can be fixed in isolation:

   **Independent comments** (can be processed in parallel):
   - Comments on different files
   - Comments on the same file but different non-overlapping code sections (>20 lines apart)
   - Comments that don't reference each other
   - Style/formatting issues
   - Documentation fixes
   - Simple bug fixes with clear scope

   **Dependent comments** (must be processed sequentially):
   - Multiple comments on the same code block or adjacent lines (<20 lines apart in same file)
   - Comments that reference each other ("see my other comment", "related to above")
   - Architectural concerns that affect multiple files
   - Comments requiring coordinated refactoring

### Phase 3: Parallel Processing with Subagents

4. **Launch subagents for independent comments:**
   For each independent comment, spawn a subagent using the Task tool with this prompt template:

   ```
   You are addressing a single PR comment. Your task:

   **PR Comment Details:**
   - File: {file_path}
   - Line(s): {line_number}
   - Comment: "{comment_body}"
   - Author: {comment_author}
   - Comment ID: {comment_id}
   - Thread ID: {thread_id}

   **Instructions:**
   1. Read the referenced file and understand the context around the commented line(s)
   2. Analyze if the comment raises a valid issue:
      - Is the concern technically correct?
      - Does it improve code quality, security, or maintainability?
      - Is it consistent with the codebase patterns?
   3. If VALID: Make the fix in the codebase using the Edit tool
   4. If NOT VALID: Prepare a clear, respectful explanation why
   5. Do NOT commit changes, reply to the comment, or mark as resolved

   **Return your result as structured output:**
   - valid: true/false
   - action_taken: "Fixed: <description>" or "Not an issue: <explanation>"
   - files_modified: [list of files changed, if any]
   - reply_message: <message to post as reply to the PR comment>
   ```

   **Important:** Launch all independent comment subagents in parallel using a single message with multiple Task tool calls.

5. **Process dependent comments sequentially:**
   - Group dependent comments by their dependency clusters
   - Process each cluster one at a time in the main agent
   - For each comment in a cluster: read, analyze, fix if valid, prepare reply

### Phase 4: Collect Results and Finalize

6. **Collect all subagent results:**
   - Wait for all parallel subagents to complete
   - Gather the structured output from each subagent
   - Merge with results from sequentially-processed dependent comments

7. **Display summary table:**
   | Comment | File | Valid? | Action Taken | Processed By |
   |---------|------|--------|--------------|--------------|
   | ... | ... | Yes/No | Fixed: ... / Not an issue: ... | Subagent / Main |

8. **Reply to PR comments:**
   - Use `gh api` to reply to each comment with the prepared reply message
   - Mark each comment thread as resolved using `gh api graphql` mutation

9. **Commit fixes (if any):**
   - Stage and commit all fixes with descriptive message
   - Include count of comments addressed in commit message
   - Do NOT push unless explicitly requested (or `--loop` is set — see Phase 5)

### Phase 5: Loop Mode (only when `--loop` is set)

10. **Push fixes for this iteration:**
    - If commits were made this iteration, push to the PR branch: `git push`
    - Never force-push. If remote diverged, abort the loop with `LOOP_STATUS=FAIL ERROR="remote diverged"`

11. **Wait for in-scope bots/checks to re-review:**
    - **First classify checks by name** from `gh pr checks <pr> --json name,state,conclusion`. **In scope:** code-review bot/agent checks (Gemini Code Assist, CodeRabbit, Greptile, Codex, Cursor BugBot, Sentry, etc.) and lint/format/test jobs (Prettier, ESLint, Ruff, pytest, vitest, Playwright). **Out of scope:** CI/CD jobs — preview-environment deployments, build/publish, Docker image builds, infra provisioning.
    - Poll only until the **in-scope** checks reach a final status (no `pending`/`in_progress`/`queued`). **Do NOT wait on out-of-scope CI/CD checks** — they may still be deploying or even failing; that never blocks this loop.
    - Use a sensible cadence (e.g., 60–120s between polls). **Hard timeout per iteration: 30 minutes** — if exceeded, abort with `LOOP_STATUS=FAIL ERROR="bot review timeout"`
    - Allow a brief settle period (~45s) after in-scope checks complete so bots can post their review comments

12. **Re-fetch PR state and decide:**
    - Re-run Phase 1 (fetch comments + review threads) and Phase 1's filter for unresolved comments
    - Run `gh pr checks <pr> --json name,state,conclusion` and evaluate **in-scope checks only** (code-review bots/agents + lint/format/test). **Exclude CI/CD jobs** (preview-env deploys, build/publish, Docker, infra) from this evaluation entirely.
    - **Exit `LOOP_STATUS=CLEAN`** when BOTH conditions hold:
      - No unresolved review comments remain (every comment thread has `isResolved: true`)
      - Every **in-scope** check has `conclusion: SUCCESS` (treat `NEUTRAL`/`SKIPPED` as pass; `FAILURE`/`CANCELLED`/`TIMED_OUT` is not pass). **Out-of-scope CI/CD checks are not consulted** — a red preview-deploy does not prevent CLEAN
    - **No iteration cap.** Bots like Cursor BugBot routinely take 20–30+ rounds to fully settle, so the loop keeps going as long as it's making progress. Print iteration count + remaining items at the end of each round so the user can interrupt if desired
    - **Track convergence across iterations.** Maintain `/tmp/address-pr-comments-history.txt` with one line per iteration listing the comment IDs addressed and which were rejected vs fixed. **No-progress detection:** if the same comment ID appears in 3 consecutive iterations with no fix landing (bot keeps re-flagging the same line and your fix isn't sticking), STOP with `LOOP_STATUS=FAIL ERROR="no progress on comment <id>"` and surface to the user. The 3-strike rule (instead of 2) gives flaky/slow bots room to acknowledge a fix that just hasn't propagated yet
    - Otherwise increment iteration counter and return to Phase 1

13. **Loop-mode constraints:**
    - Only push when at least one commit was made this iteration (don't push empty)
    - Never force-push, never push to `master`/`main`
    - Same rules from the non-loop path apply per iteration: reject nitpicks/bikeshedding/bloated defensive code, don't fabricate fixes to silence comments, push back on Claude's own judgment when bot suggestions are wrong

## Subagent Configuration

When launching subagents, use these parameters:
- `subagent_type`: "general-purpose"
- `description`: "Fix PR comment on {filename}"
- `model`: "sonnet" (for efficiency; use "opus" only for complex architectural comments)

## Constraints
- Requires `gh` CLI to be authenticated
- Does not push changes automatically (except in `--loop` mode, which pushes per iteration)
- Reviews comments objectively - not all comments require code changes
- Skips already-resolved comments for efficient re-runs
- Maximum 10 parallel subagents at once (batch if more comments)
- Subagents do NOT commit, reply, or resolve - only the main agent does this
- **Loop mode watches code-review bots + lint/test ONLY** — gate the loop solely on automated code-review bot/agent feedback (Gemini Code Assist, CodeRabbit, Greptile, Codex, Cursor BugBot, Sentry, etc.) and lint/format + test check-runs. NEVER watch, wait on, or gate the loop on CI/CD jobs like preview-environment deployments, builds, image publishes, or infra — ignore those entirely for loop control
- **Loop mode** exit conditions: all **in-scope** checks green (code-review bots/agents + lint/format/test) AND zero unresolved review comments. **No iteration cap** — bots like Cursor BugBot can take 20–30+ rounds. Abort with `LOOP_STATUS=FAIL` only on: no-progress (same comment ID flagged 3 consecutive iterations), bot timeout (>30min wait per iteration), or remote divergence. User can interrupt at any iteration boundary
