---
name: pr-loop
description: Take an authorized finished branch or PR to merge-ready through review, valid comment fixes, affected checks, and recap. Use when asked to finish PR review or get a change ready to merge, or when the user says a PR it ran has merged.
---


# /pr-loop

Run the whole pre-merge loop on the current branch, and on the same-named branch in any sibling repo the change spans, without stopping to ask. The loop is the same in Claude Code and Codex; `/codexloop` and the recap's second opinion always come from the other model family. The shared skill is authoritative; slash commands are aliases. In Codex, read and follow `~/.codex/prompts/codexloop.md` and `~/.codex/prompts/address-pr-comments.md`; Codex does not execute those prompts itself. In Claude Code, use the corresponding commands under `~/.claude/commands/`. Inside T3, use the injected T3 Code orchestration instructions instead of native CLI transport; they govern delegated review rounds, task tracking and PR watches. The user is away; the recap at the end is how they audit the run, so write each decision to the decision log as it is made (`~/.claude/skills/recap-pr/LEDGER.md`). Every change accepted from any reviewer passes LEDGER's mechanism rule. The run ends with open, converged PRs; merging is the user's call.

Resolve the log key once in the main repo (`log.sh --path` reuses the key the branch already logged under), then run `log.sh --bind <that key>` in each sibling repo's branch, so every repo writes to one log. Collect every key in every participating branch's key file and set them as `RECAP_PIN_KEYS='<keys>'` in front of each `log.sh --pins` call (shell variables do not survive between calls), so `--pins` in any repo reads all of those logs together and every review gets the same settled decisions, including ones logged in a sibling before binding.

## 1. Open the PRs

Push each repo's branch and open one PR per repo with the `/pr` template, its "Behavior changes vs master" section filled from the log's accepted rows with a `prod_delta` other than `none`. For a cross-repo change, name the merge order in every body and cross-link the PRs.

Done when every repo with commits on the branch has an open PR.

## 2. Two-axis review

Run `/code-review` on each PR with the fixed point `origin/<base>` and the spec given up front: the ticket plus the user's settled decisions (`log.sh --pins`). Fix every hard violation and every spec gap; take a judgement call only when it makes the change simpler or clearer. Log each finding with its outcome.

Done when each PR's findings are fixed, logged as rejected with a reason, or listed in the PR body as open questions for the user.

## 3. Cross-family review to convergence, bot comments between rounds

Run `/codexloop --until-converged` on each PR; its reviewer is the other model family (Codex from Claude Code, Claude Opus 5.5 from Codex). Triage bot threads while reviews run, without concurrent writes. In a native CLI, use the existing supported cross-family path and keep long Codex work on the plugin's background path. Then apply the accepted reviewer and bot fixes together, commit, push, and start the next round on the new head.

Done when every PR has converged, has no open bot finding (threads and review-body items alike), and every reviewer on its final pushed head has reviewed that head and passed, or is reported `NOT_REVIEWED` (the `/address-pr-comments` convergence gate). A fix made to get there restarts that PR's convergence count.

## 4. Fable pass, when it changes the outcome

An explicit human `/pr-loop` invocation approves at most one Fable pass for that run, as does an explicit Fable request or approval. Automatic skill routing grants no Fable approval. When approved, run it when the diff carries a judgement the mechanical reviews keep circling, changes what customers or analysts see, or couples parts of the system in a way a reviewer has to hold in their head. Mechanical changes that have already converged skip it.

Run it read-only, briefed with the diffs, the settled decisions, and what to look for: judgement calls, taste, simpler shapes of the problem and the code, edge cases, an adversarial read. In Claude Code that is a subagent with `model: fable`; in Codex, `/Users/<you>/.codex/bin/claude-read claude-fable-5-1 "<brief>" [<extra dirs to read>]` (a copy of kstack `codex/bin/`), pointing the brief at files to Read; Codex allows only that read-only wrapper outside the sandbox, as a plain command. Accepted Fable changes go back through step 3.

Done when the run-or-skip decision and its reason are logged, and every Fable finding is fixed or logged as rejected.

## 5. Verify in the running app, when the diff changes what renders

When a diff changes what a user sees or does (components, routes, styles, copy, a UI-facing API), run `/no-mistakes` on the final head through a route that drives the browser (frontend or full-stack, never backend-only), with a case for the change on screen, and post its screenshots and recordings to the PR. When the pixels that change belong to another repo's PR, post them on the PR whose diff caused them. A diff that changes nothing on screen skips this; log the run-or-skip and why. A fix it causes goes back through step 3, and the evidence is retaken on the head that fix produces.

Done when every PR whose diff changes what renders carries evidence from its final head, or a logged skip.

## 6. Affected tests

Run each repo's affected tests on the final heads, deriving the set from the diff as `/implement` does. Fix a failure that predates the branch too, in its own commit, logged with `asked no`; any fix goes back through step 3, and through step 5 when it changes what renders.

Record each final head, affected commands and collected/executed test results, review state, and unresolved items together in the decision log. Reuse evidence for unchanged inputs and revisions; a relevant fix reruns its affected checks. Done when the affected tests pass on the heads being handed back.

## 7. Recap and hand-back

Follow `~/.claude/skills/recap-pr/SKILL.md`. Then hand back this block for each PR, every line filled from the final head:

```text
PR <url>: <what it changes, in a user's words> · head <sha> · merge order <n>
Reviewers on this head: <name: passed | failed: why | NOT_REVIEWED: reason>, one per reviewer
Open findings: <none | each one>
CI on this head: <each check and its conclusion, with test counts where the check reports them>
App evidence: <taken on <sha> | skipped: reason>
Re-verify before merge: <no | yes: what, and why>
Merge-ready: <yes | no: what blocks it>
```

A deploy job's result is reported but never sets `Merge-ready: no`; a failed reviewer, an open finding or a failing required check does.

Done when `recap.md` exists beside the log, every PR body's "Behavior changes vs master" section matches it, and each PR's block is handed back.

## When the user says merged

1. Use the cleanup skill to retire this run's resources, deleting its merged branches, and stop any PR watch the run started.
2. Close what the PRs finished: each ticket whose whole scope the merged PRs delivered and the merge did not close itself, and a parent once every child is closed, ticking the parent's checklist where it keeps one. A ticket with work left stays open, with a comment saying what remains.
3. Check production runs the merge, following the deploy check the repo documents (`docs/deploy.md` or similar): report the deployed commit and, where the merge carries migrations, whether they applied. With no documented check, say so rather than guess.

Done when the cleanup inventory is empty or names a reason for each kept resource, the finished issues are closed, and the deploy state is reported.

## Runtime handoff and close-out

For native CLI monitoring, use the existing review/check tools. T3 transport and PR tracking follow its injected instructions.

When addressing comments is already authorized, read and follow `~/.codex/prompts/address-pr-comments.md` in Codex or `~/.claude/commands/address-pr-comments.md` in Claude Code and judge each finding without another selection prompt. Keep merging as the user's decision.

Before delegating, read [HANDOFF.md](HANDOFF.md).

Before declaring the session safe to archive, use the cleanup skill to account for owned processes, brokers, servers, Docker resources, and retained worktrees. A completed agent turn is not proof that its jobs have finished.
