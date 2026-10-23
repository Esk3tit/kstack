---
name: pr-loop
description: Take an authorized finished branch or PR to merge-ready through review, valid comment fixes, affected checks, and recap. Use when asked to finish PR review or get a change ready to merge.
---


# /pr-loop

Run the whole pre-merge loop on the current branch, and on the same-named branch in any sibling repo the change spans, without stopping to ask. The loop is the same in Claude Code and Codex; `/codexloop` and the recap's second opinion always come from the other model family. The shared skill is authoritative; slash commands are aliases. Read the existing codexloop and address-pr-comments workflows for their relevant runtime path. The user is away; the recap at the end is how they audit the run, so write each decision to the decision log as it is made (`~/.claude/skills/recap-pr/LEDGER.md`). Every change accepted from any reviewer passes LEDGER's mechanism rule. The run ends with open, converged PRs; merging is the user's call.

Resolve the log key once in the main repo (`log.sh --path` reuses the key the branch already logged under), then run `log.sh --bind <that key>` in each sibling repo's branch, so every repo writes to one log. Collect every key in every participating branch's key file and set them as `RECAP_PIN_KEYS='<keys>'` in front of each `log.sh --pins` call (shell variables do not survive between calls), so `--pins` in any repo reads all of those logs together and every review gets the same settled decisions, including ones logged in a sibling before binding.

## 1. Open the PRs

Push each repo's branch and open one PR per repo with the `/pr` template, its "Behavior changes vs master" section filled from the log's accepted rows with a `prod_delta` other than `none`. For a cross-repo change, name the merge order in every body and cross-link the PRs. When the T3 `link_pull_request` tool is available, link each PR to the thread.

Done when every repo with commits on the branch has an open PR.

## 2. Two-axis review

Run `/code-review` on each PR with the fixed point `origin/<base>` and the spec given up front: the ticket plus the user's settled decisions (`log.sh --pins`). Fix every hard violation and every spec gap; take a judgement call only when it makes the change simpler or clearer. Log each finding with its outcome.

Done when each PR's findings are fixed, logged as rejected with a reason, or listed in the PR body as open questions for the user.

## 3. Cross-family review to convergence, bot comments between rounds

Run `/codexloop --until-converged` on each PR; its reviewer is the other model family (Codex from Claude Code, Claude Opus 5.5 from Codex). Inside T3, use a new app-owned delegated task for each review round, with the live provider/model options and the settled decisions, prior findings, responses, and unresolved objections in its brief. Track its task ID; triage bot threads while it runs without concurrent writes. In a native CLI, use the existing supported cross-family path and keep long Codex work on the plugin's background path. Then apply the accepted reviewer and bot fixes together, commit, push, and start the next round on the new head.

Done when every PR has converged, has no unresolved bot thread, and every reviewer check on its final pushed head has finished and passed (the `/address-pr-comments` convergence gate). A fix made to get there restarts that PR's convergence count.

## 4. Fable pass, when it changes the outcome

Use Fable only when the user explicitly requests or approves it for this run. Automatic skill routing grants no Fable approval. When approved, run it when the diff carries a judgement the mechanical reviews keep circling, changes what customers or analysts see, or couples parts of the system in a way a reviewer has to hold in their head. Mechanical changes that have already converged skip it.

Run it read-only, briefed with the diffs, the settled decisions, and what to look for: judgement calls, taste, simpler shapes of the problem and the code, edge cases, an adversarial read. In Claude Code that is a subagent with `model: fable`; in Codex, `/Users/<you>/.codex/bin/claude-read claude-fable-5-1 "<brief>" [<extra dirs to read>]` (a copy of kstack `codex/bin/`), pointing the brief at files to Read; Codex allows only that read-only wrapper outside the sandbox, as a plain command. Accepted Fable changes go back through step 3.

Done when the run-or-skip decision and its reason are logged, and every Fable finding is fixed or logged as rejected.

## 5. Affected tests

Run each repo's affected tests on the final heads, deriving the set from the diff as `/implement` does. Fix a failure that predates the branch too, in its own commit, logged with `asked no`; any fix goes back through step 3.

Record each final head, affected commands and collected/executed test results, review state, and unresolved items together in the decision log. Reuse evidence for unchanged inputs and revisions; a relevant fix reruns its affected checks. Done when the affected tests pass on the heads being handed back.

## 6. Recap

Follow `~/.claude/skills/recap-pr/SKILL.md`. Hand back the PR URLs, the merge order, each PR's convergence state, the test results, and the recap.

Done when `recap.md` exists beside the log and every PR body's "Behavior changes vs master" section matches it.

## Runtime handoff and close-out

Use T3 PR watches when monitoring is requested and available; end the turn after arming the watch, and unwatch when handing back. In a native CLI, use the existing review/check tools. Link every PR to the T3 thread when the tool is available.

When addressing comments is already authorized, use the custom address-pr-comments handler and judge each finding without another selection prompt. Keep merging as the user's decision.

Carry the affected test scope, shared-service ownership, and required skills into every child brief. Prompt changes use writing-for-agents; stage-level model experiments use eval with frozen inputs. Keep E2E bug reproduction and warranted final integration checks.

Before declaring the session safe to archive, use the cleanup skill to account for owned processes, brokers, servers, Docker resources, and retained worktrees. A completed agent turn is not proof that its jobs have finished.
