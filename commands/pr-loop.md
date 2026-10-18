---
description: Take a finished branch to merge-ready without check-ins — open the PR, two-axis review, Codex loop to convergence, bot comments, an optional Fable pass, then the /recap-pr recap
argument-hint: [ticket or spec] [--repos <sibling repos>]
---

# /pr-loop

Run the whole pre-merge loop on the current branch, and on the same-named branch in any sibling repo the change spans, without stopping to ask. The user is away; the recap at the end is how they audit the run, so write each decision to the decision log as it is made (`~/.claude/skills/recap-pr/LEDGER.md`). Every change accepted from any reviewer passes LEDGER's mechanism rule. The run ends with open, converged PRs; merging is the user's call.

Resolve the log key once in the main repo (`log.sh --path` reuses the key the branch already logged under) and export it as `RECAP_KEY` for every sibling repo, so all repos write one log.

## 1. Open the PRs

Push each repo's branch and open one PR per repo with the `/pr` template, its "Behavior changes vs master" section filled from the log's accepted rows with a `prod_delta` other than `none`. For a cross-repo change, name the merge order in every body and cross-link the PRs. When the T3 `link_pull_request` tool is available, link each PR to the thread.

Done when every repo with commits on the branch has an open PR.

## 2. Two-axis review

Run `/code-review` on each PR with the fixed point `origin/<base>` and the spec given up front: the ticket plus the user's settled decisions (`log.sh --pins`). Fix every hard violation and every spec gap; take a judgement call only when it makes the change simpler or clearer. Log each finding with its outcome.

Done when each PR's findings are fixed, logged as rejected with a reason, or listed in the PR body as open questions for the user.

## 3. Codex to convergence, bot comments between rounds

Run `/codexloop --until-converged` on each PR. Its review call blocks, so launch each round from a background shell. While a round runs, triage the PR's new bot threads per `/address-pr-comments` without editing files; once the round returns, apply the accepted Codex and bot fixes together, commit, push, and start the next round on the new head.

Done when every PR has converged, has no unresolved bot thread, and every reviewer check on its final pushed head has finished and passed (the `/address-pr-comments` convergence gate). A fix made to get there restarts that PR's convergence count.

## 4. Fable pass, when it changes the outcome

Running `/pr-loop` is the user's approval for one Fable pass per run, used only when it changes the outcome. Run it when the diff carries a judgement the mechanical reviews keep circling, changes what customers or analysts see, or couples parts of the system in a way a reviewer has to hold in their head. Mechanical changes that have already converged skip it.

Run it as a read-only subagent (`model: fable`) briefed with the diffs, the settled decisions, and what to look for: judgement calls, taste, simpler shapes of the problem and the code, edge cases, an adversarial read. Accepted Fable changes go back through step 3.

Done when the run-or-skip decision and its reason are logged, and every Fable finding is fixed or logged as rejected.

## 5. Affected tests

Run each repo's affected tests on the final heads, deriving the set from the diff as `/implement` does. Fix a failure that predates the branch too, in its own commit, logged with `asked no`; any fix goes back through step 3.

Done when the affected tests pass on the heads being handed back.

## 6. Recap

Follow `~/.claude/skills/recap-pr/SKILL.md`. Hand back the PR URLs, the merge order, each PR's convergence state, the test results, and the recap.

Done when `recap.md` exists beside the log and every PR body's "Behavior changes vs master" section matches it.
