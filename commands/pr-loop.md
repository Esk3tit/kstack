---
description: Take a finished branch to merge-ready without check-ins — open the PR, two-axis review, Codex loop to convergence, bot comments, an optional Fable pass, then /recap-pr
argument-hint: [ticket or spec] [--repos <sibling repos>]
---

# /pr-loop

Run the whole pre-merge loop on the current branch, and on the same-named branch in any sibling repo the change spans, without stopping to ask. The user is away; the recap at the end is how they audit the run, so write each decision to the decision log as it is made (`~/.claude/skills/recap-pr/LEDGER.md`). The run ends with open, converged PRs. Merging is the user's call.

## 1. Open the PRs

Push each repo's branch and open one PR per repo with the `/pr` template, its "Behavior changes vs master" section filled from the log's `prod_delta` rows. For a cross-repo change, name the merge order in every body and cross-link the PRs. When the T3 `link_pull_request` tool is available, link each PR to the thread.

Done when every repo with commits on the branch has an open PR.

## 2. Two-axis review

Run `/code-review` on each PR against its base. The Spec reviewer gets the ticket plus the user's settled decisions (`log.sh --pins`); the Standards reviewer gets the repo's `CLAUDE.md`/`AGENTS.md`. Fix every hard violation and every spec gap; take a judgement call only when it makes the change simpler or clearer. Log each finding with its outcome.

Done when each PR's findings are fixed, logged as rejected with a reason, or left in the PR body as open questions for the user.

## 3. Codex to convergence, bot comments alongside

Run `/codexloop` on each PR with no iteration cap. A PR has **converged** after two consecutive Codex rounds with no accepted finding, or on a flip-flop. Run each round in the background; while it runs, work the PR's new bot threads per `/address-pr-comments`. Every fix commit restarts that PR's convergence count; push it, then start the next round.

Done when every PR has converged and has no unresolved bot thread.

## 4. Fable pass, when it changes the outcome

Fable quota is limited, so decide first, and log the decision and its reason. Run one pass when the diff carries a judgement the mechanical reviews keep circling, changes what customers or analysts see, or couples parts of the system in a way a reviewer has to hold in their head. Skip it for mechanical changes that have already converged.

Run it as a read-only subagent (`model: fable`) briefed with the diffs, the settled decisions, and what to look for: judgement calls, taste, simpler shapes of the problem and the code, edge cases, an adversarial read. Accepted Fable changes go back through step 3.

## 5. Verify

Run each repo's affected tests on the final heads (derive the set from the diff, as `/implement` does). Run `/no-mistakes` when the change has a UI or spans repos.

Done when the tests pass on the heads being handed back, or a failure is shown to predate the branch.

## 6. Recap

Run `/recap-pr`. Hand back with the PR URLs, the merge order, each PR's convergence state, the test results, and the recap.
