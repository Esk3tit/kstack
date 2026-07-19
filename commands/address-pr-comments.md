---
description: Address unresolved PR review comments — fix the valid ones, push back on the invalid ones, reply and resolve each, looping until every reviewer is green
argument-hint: [pr-number] [--once]
---

# /address-pr-comments

Address **unresolved** review comments on a PR: judge each one, fix what's valid, push back on what isn't, reply to every comment, resolve the thread. Then loop — push, let the reviewers re-review, repeat — until the PR converges.

**Idempotent.** Each pass only touches unresolved threads with no reply, so re-running is always safe.

- `$1` — PR number (optional; defaults to the current branch's PR)
- `--once` — run a single pass and stop, instead of looping to convergence

## Reviewers vs. deploys

Classify every check and comment source by name into exactly one bucket — the loop gates on **reviewers** and is blind to **deploys**:

- **Reviewers** (gate the loop): code-review bots/agents — Gemini Code Assist, CodeRabbit, Greptile, Codex / cloud PR review, Cursor BugBot, Sentry — plus lint/format and test check-runs — Prettier, ESLint, Ruff, pytest, vitest, Playwright. A failing lint or test is a real finding to fix.
- **Deploys** (never wait on, never gate): CI/CD pipeline jobs — preview-environment deployments, build/publish, Docker image builds, infra provisioning. A pending or red deploy never blocks convergence and is never a finding.

## Each pass

1. **Fetch & converge.** Find the PR (`gh pr view --json number` if no number given). Pull review comments (`gh api repos/{owner}/{repo}/pulls/{pr}/comments`), thread resolution (`gh api graphql`), and reviewer states (`gh pr checks <pr> --json name,state,conclusion`). Keep only unresolved threads with no reply. **Converged** when no such threads remain AND every reviewer is green (`SUCCESS`; `NEUTRAL`/`SKIPPED` pass; `FAILURE`/`CANCELLED`/`TIMED_OUT` don't). On convergence, emit `LOOP_STATUS=CLEAN ITERATIONS=<N>` and stop. A red reviewer with no comment is still a finding — investigate and fix it.

2. **Partition into clusters.** Holding every comment at once, group them: comments on the same code or that reference each other share a cluster; everything else is a cluster of one. This call is yours to make directly from full context — no line-distance heuristic.

3. **Fan out.** Spawn one general-purpose subagent per cluster, all in parallel, each with this task:
   > Address these PR comments: {cluster}. Read the code around each. Judge whether each raises a real issue — technically correct, an actual improvement to quality/security/maintainability, consistent with the codebase. Fix the valid ones with Edit; for invalid ones, prepare a respectful explanation of why it isn't one. Do NOT commit, reply, or resolve. Return per comment: `valid` (bool), `action` ("Fixed: …" / "Not an issue: …"), `files` (paths changed), `reply` (message to post).

   Reject nitpicks, bikeshedding, and bloated defensive code; never fabricate a fix just to silence a bot.

4. **Finalize (parent only).** Collect results. Print a table (Comment | File | Valid? | Action). Reply to each comment and resolve its thread via `gh api` / `gh api graphql`. Commit any fixes with a message naming the count addressed.

**If `--once`: stop here.**

## Loop

5. **Push** — only if this pass committed. Never force-push; never push to `master`/`main`. If the remote diverged, stop with `LOOP_STATUS=FAIL ERROR="remote diverged"`.

6. **Let reviewers re-review.** Poll `gh pr checks` every 60–120s until every reviewer reaches a final state — ignore deploys, pending or red. Once they settle, wait ~45s for bots to post. Per-pass timeout 30 min → `LOOP_STATUS=FAIL ERROR="reviewer timeout"`.

7. **Repeat** from step 1 — its convergence test decides when to stop. **No iteration cap**: bots like Cursor BugBot routinely take 20–30+ passes to settle, so print the pass count and remaining items each round for interruptibility. **No-progress guard:** track addressed comment IDs across passes in `/tmp/address-pr-comments-history.txt`; if one ID is re-flagged 3 passes running with no fix landing, stop with `LOOP_STATUS=FAIL ERROR="no progress on comment <id>"`.

**Requires** an authenticated `gh` CLI.
