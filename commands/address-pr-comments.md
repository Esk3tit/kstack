---
description: Address open PR review findings (unresolved threads and review-body items such as CodeRabbit nitpicks) — fix the valid ones, push back on the invalid ones, answer each, looping until every reviewer has reviewed the head and is green
argument-hint: [pr-number] [--once]
---

# /address-pr-comments

Inside T3, follow its injected orchestration instructions instead of native CLI transport. Use a bounded handful of independent fixers and the existing fan-out approval rule; dependent work stays serial.

Address every **open finding** on a PR, both unresolved threads and review-body items: judge each one, fix what's valid, push back on what isn't, answer every finding, resolve its thread. Then loop — push, let the reviewers re-review, repeat — until the PR converges.

**Idempotent.** Each pass works only the unresolved threads whose last comment is not ours and the reviews whose body items we have not answered yet, so re-running is always safe.

- `$1` — PR number (optional; defaults to the current branch's PR)
- `--once` — run a single pass and stop, instead of looping to convergence

**GitHub via `gh-axi`.** Run every GitHub operation here through `gh-axi` (invoke `npx -y gh-axi …`) — the agent-ergonomic wrapper with token-efficient output; fall back to plain `gh` only if it's unavailable. It needs an authenticated `gh` underneath. Key forms: `pr view [<n>] --comments --reviews`, `pr checks <n>`, and `api [METHOD] <path>` — raw REST plus `api POST /graphql --field query=…` for thread resolution and replies.

## Reviewers vs. deploys

Classify every check and comment source by name into exactly one bucket — the loop gates on **reviewers** and is blind to **deploys**:

- **Reviewers** (gate the loop): code-review bots/agents — Gemini Code Assist, CodeRabbit, Greptile, Codex / cloud PR review, Cursor BugBot, Sentry — plus lint/format and test check-runs — Prettier, ESLint, Ruff, pytest, vitest, Playwright. A failing lint or test is a real finding to fix.
- **Deploys** (never wait on, never gate): CI/CD pipeline jobs — preview-environment deployments, build/publish, Docker image builds, infra provisioning. A pending or red deploy never blocks convergence and is never a finding.

## Review-body items

A **review-body item** is a finding a bot writes inside a review's body instead of as a thread. CodeRabbit puts its "Nitpick comments (N)" and "Outside diff range comments (N)" there, in collapsed `<details>` blocks, each naming a file and line range; other bots do the same under their own headings. They never appear in `reviewThreads`, so read every review's body: `gh-axi api 'repos/{owner}/{repo}/pulls/{pr}/reviews?per_page=100'` (fields `id`, `user.login`, `commit_id`, `html_url`, `body`). Judge each item against the current code, as you would a thread. With no thread to reply to or resolve, a review's items are answered by one PR comment of ours that starts with `Re: <review html_url>`; a review with body items and no such comment is still open.

## A green bot is one that reviewed the head

A review bot's green check counts only once that bot has reviewed the current head: a review whose `commit_id` is the head SHA, or the bot's own summary naming the head commit. A bot that is rate-limited, paused, skipping the PR for size, or only reviews when tagged still reports green. Re-trigger it once with its tag (`@coderabbitai review`, `@greptileai`, `bugbot run`) and give it one pass; if it still hasn't reviewed the head, report it as `NOT_REVIEWED=<bot>:<reason>` instead of counting it green.

## The final pass

A repo can name a **final-pass reviewer** in `docs/agents/review-bots.md`, with the tag that requests it: a bot billed per review whose findings mostly repeat the other reviewers'. It reviews each PR once, after everything else has converged, so it is paid only to find what the others missed. Its tag comment on the PR is the record of that request: read the PR's comments for it before each decision below.

- **The request** is the one time it is tagged; the re-trigger above passes it over. It is due once the PR converges and carries no tag comment for it. Standalone, post the tag then; under `/pr-loop`, step 8 posts it.
- **Before the request,** each pass leaves it out of the check on who has reviewed the head.
- **After the request,** it gates convergence until it posts a review or summary newer than the tag comment; a check's state alone doesn't show that. A skip for cost, or 30 minutes from the tag with no review, ends the wait as `NOT_REVIEWED=<bot>:<reason>` rather than a loop failure; the repo doc says how to read a skip. Its findings are worked like any other.
- **On later heads,** that one review stands. It counts as passed once every finding from it is fixed or answered, and is reported as `passed on <sha>`, naming the head it reviewed. Request it again only when the user asks.

## Each pass

1. **Fetch & converge.** Find the PR (`gh-axi pr view` off the current branch, or `<pr>` if given). Read review comments and their thread resolution (`gh-axi pr view <pr> --comments --reviews`; `api POST /graphql` for each thread's `isResolved`), and reviewer states (`gh-axi pr checks <pr>`). For an unresolved thread whose last comment is already our reply (an earlier pass stopped before resolving it), resolve it when the reply is a rejection or the commit it names is on the remote branch (`git fetch origin <branch>`, then `git merge-base --is-ancestor <sha> origin/<branch>`); otherwise work it again. Keep the unresolved threads whose last comment is someone else's, including a bot answering our reply, and the open review-body items (see **Review-body items**). **Converged** when no unresolved thread or open review-body item remains AND every reviewer is green (`SUCCESS`; `NEUTRAL`/`SKIPPED` pass; `FAILURE`/`CANCELLED`/`TIMED_OUT` don't) AND every review bot has reviewed the head or been reported `NOT_REVIEWED` (see **A green bot is one that reviewed the head**; the final-pass reviewer follows **The final pass**). On convergence, a standalone run with a final pass due posts its request and continues at step 6, or stops there under `--once`; otherwise emit `LOOP_STATUS=CLEAN ITERATIONS=<N> [NOT_REVIEWED=<bot>:<reason>,…]` and stop. A red reviewer with no comment is still a finding — investigate and fix it.

2. **Partition into clusters.** Holding every comment at once, group them: comments on the same code or that reference each other share a cluster; everything else is a cluster of one. This call is yours to make directly from full context — no line-distance heuristic.

3. **Fan out.** Handle dependent clusters serially. For independent clusters, use a bounded handful of subagents with isolated worktrees for writes, or fix them serially in the parent when isolation is unavailable. Each fixer has this task:
   > Address these PR comments: {cluster}. Read the code around each. Judge whether each raises a real issue — technically correct, an actual improvement to quality/security/maintainability, consistent with the codebase. A fix that adds a mechanism must pass the mechanism rule in `~/.claude/skills/recap-pr/LEDGER.md`; one that fails it is not a valid fix. Fix the valid ones in your isolated worktree; for invalid ones, prepare a respectful explanation of why it isn't one. Commit only your assigned fixes and return the base SHA and commit SHA. Do NOT push, reply, or resolve. Return per comment: `valid` (bool), `action` ("Fixed: …" / "Not an issue: …"), `files` (paths changed), `reply` (message to post).

   Judge every finding on its merits, CodeRabbit's "Nitpick" items included: fix a valid one when the fix is cheap, reject bikeshedding and bloated defensive code, and never fabricate a fix just to silence a bot.

4. **Finalize (parent only).** Collect results and review each fixer's diff against its returned base. Cherry-pick accepted fixer commits into the parent branch one at a time; resolve conflicts in the parent and run the combined affected checks. Record the source-to-parent SHA mapping for each fix. When isolation is unavailable, the parent makes the edits serially. A fix is not complete while its only copy remains in a child worktree. Check every returned fix that adds a mechanism against the mechanism rule in `~/.claude/skills/recap-pr/LEDGER.md`; revert one that fails and rewrite its reply as a rejection. Print a table (Comment | File | Valid? | Action). Commit any remaining parent edits with a message naming the count addressed and push all accepted fixes (step 5's rules) before replying, so every "Fixed" reply names a commit already on the remote. Under `/pr-loop`, run `/codexloop --until-converged` on these commits instead of pushing, since it pushes on convergence, then recheck each fix and its reply against the pushed head. Then reply to each comment (a fix's reply names the pushed parent-branch SHA that contains it, rather than an unpushed fixer SHA) and resolve its thread via `gh-axi api` (`POST /repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`, and the `resolveReviewThread` graphql mutation). Answer each review's body items with one PR comment starting `Re: <review html_url>` that lists every item with its outcome and pushed SHA; pass bodies through `--body-file` so backticks survive. Log each comment and review-body item as one decision-log row (`phase pr-comments`, `source bot:<reviewer>`, `asked no`).

   Once each fixer has finished and its accepted fixes are pushed, use `~/.agents/skills/cleanup/SKILL.md` to retire its eligible workflow-owned temporary worktree during this pass. Preserve its branch unless deletion was separately authorized, and record any retention reason. Rejected fixer work follows the same preservation and ownership checks.


**If `--once`: stop here.**

## Loop

5. **Push rules** (the push itself happens in step 4) — never force-push; never push to `master`/`main`. If the remote diverged, stop with `LOOP_STATUS=FAIL ERROR="remote diverged"`.

6. **Let reviewers re-review.** In T3, use its injected PR-watch workflow and end the turn. In a native CLI, poll `gh-axi pr checks <pr>` every 60–120s until every reviewer reaches a final state — ignore deploys, pending or red. Once they settle, wait ~45s for bots to post. Per-pass timeout 30 min → `LOOP_STATUS=FAIL ERROR="reviewer timeout"`, except a final-pass reviewer still silent then, which is reported `NOT_REVIEWED` and the loop goes on (see **The final pass**).

7. **Repeat** from step 1 — its convergence test decides when to stop. **No iteration cap**: bots like Cursor BugBot routinely take 20–30+ passes to settle, so print the pass count and remaining items each round for interruptibility. **No-progress guard:** track addressed comment IDs and review-body items (review ID plus file:line) across passes in `/tmp/address-pr-comments-history.txt`; if one ID is re-flagged 3 passes running with no fix landing, stop with `LOOP_STATUS=FAIL ERROR="no progress on comment <id>"`.
