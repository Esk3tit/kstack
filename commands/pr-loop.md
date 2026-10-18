---
description: Take a finished branch to merge-ready without check-ins — open the PR, two-axis review, a cross-family review loop to convergence, bot comments, an optional Fable pass, then the /recap-pr recap
argument-hint: [ticket or spec] [--repos <sibling repos>]
---

# /pr-loop

Run the whole pre-merge loop on the current branch, and on the same-named branch in any sibling repo the change spans, without stopping to ask. The loop is the same in Claude Code and Codex; `/codexloop` and the recap's second opinion always come from the other model family. Codex cannot invoke a custom prompt, so there each `/codexloop` and `/address-pr-comments` below means following that file in `~/.codex/prompts/`. The user is away; the recap at the end is how they audit the run, so write each decision to the decision log as it is made (`~/.claude/skills/recap-pr/LEDGER.md`). Every change accepted from any reviewer passes LEDGER's mechanism rule. The run ends with open, converged PRs; merging is the user's call.

Resolve the log key once in the main repo (`log.sh --path` reuses the key the branch already logged under), then run `log.sh --bind <that key>` in each sibling repo's branch, so every repo writes to one log. Collect every key in every participating branch's key file and set them as `RECAP_PIN_KEYS='<keys>'` in front of each `log.sh --pins` call (shell variables do not survive between calls), so `--pins` in any repo reads all of those logs together and every review gets the same settled decisions, including ones logged in a sibling before binding.

## 1. Open the PRs

Push each repo's branch and open one PR per repo with the `/pr` template, its "Behavior changes vs master" section filled from the log's accepted rows with a `prod_delta` other than `none`. For a cross-repo change, name the merge order in every body and cross-link the PRs. When the T3 `link_pull_request` tool is available, link each PR to the thread.

Done when every repo with commits on the branch has an open PR.

## 2. Two-axis review

Run `/code-review` on each PR with the fixed point `origin/<base>` and the spec given up front: the ticket plus the user's settled decisions (`log.sh --pins`). Fix every hard violation and every spec gap; take a judgement call only when it makes the change simpler or clearer. Log each finding with its outcome.

Done when each PR's findings are fixed, logged as rejected with a reason, or listed in the PR body as open questions for the user.

## 3. Cross-family review to convergence, bot comments between rounds

Run `/codexloop --until-converged` on each PR; its reviewer is the other model family (Codex from Claude Code, Claude Opus 5.5 from Codex). Its review call blocks. In Claude Code, launch each round from a background shell and, while it runs, triage the PR's new bot threads per `/address-pr-comments` without editing files; in Codex, run the round in the foreground and triage the bot threads after it returns. Then apply the accepted reviewer and bot fixes together, commit, push, and start the next round on the new head.

Done when every PR has converged, has no unresolved bot thread, and every reviewer check on its final pushed head has finished and passed (the `/address-pr-comments` convergence gate). A fix made to get there restarts that PR's convergence count.

## 4. Fable pass, when it changes the outcome

Running `/pr-loop` is the user's approval for one Fable pass per run, used only when it changes the outcome. Run it when the diff carries a judgement the mechanical reviews keep circling, changes what customers or analysts see, or couples parts of the system in a way a reviewer has to hold in their head. Mechanical changes that have already converged skip it.

Run it read-only, briefed with the diffs, the settled decisions, and what to look for: judgement calls, taste, simpler shapes of the problem and the code, edge cases, an adversarial read. In Claude Code that is a subagent with `model: fable`; in Codex, `/Users/<you>/.codex/bin/claude-read claude-fable-5-1 "<brief>" [<extra dirs to read>]` (a copy of kstack `codex/bin/`), pointing the brief at files to Read; Codex allows only that read-only wrapper outside the sandbox, as a plain command. Accepted Fable changes go back through step 3.

Done when the run-or-skip decision and its reason are logged, and every Fable finding is fixed or logged as rejected.

## 5. Affected tests

Run each repo's affected tests on the final heads, deriving the set from the diff as `/implement` does. Fix a failure that predates the branch too, in its own commit, logged with `asked no`; any fix goes back through step 3.

Done when the affected tests pass on the heads being handed back.

## 6. Recap

Follow `~/.claude/skills/recap-pr/SKILL.md`. Hand back the PR URLs, the merge order, each PR's convergence state, the test results, and the recap.

Done when `recap.md` exists beside the log and every PR body's "Behavior changes vs master" section matches it.
