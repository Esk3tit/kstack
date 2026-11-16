---
name: pr-loop
description: Take an authorized finished branch or PR to merge-ready through review, valid comment fixes, affected checks, and recap. Use when asked to finish PR review or get a change ready to merge, or when the user says a PR it ran has merged.
---


# /pr-loop

Run the whole pre-merge loop on the current branch, and on the same-named branch in any sibling repo the change spans, without stopping to ask. The loop is the same in Claude Code and Codex; `/codexloop` and the recap's second opinion always come from the other model family. The shared skill is authoritative; slash commands are aliases. In Codex, read and follow `~/.codex/prompts/codexloop.md` and `~/.codex/prompts/address-pr-comments.md`; Codex does not execute those prompts itself. In Claude Code, use the corresponding commands under `~/.claude/commands/`. Inside T3, use the injected T3 Code orchestration instructions instead of native CLI transport; they govern delegated review rounds, task tracking and PR watches. The user is away; the recap at the end is how they audit the run, so write each decision to the decision log as it is made (`~/.claude/skills/recap-pr/LEDGER.md`). Every change accepted from any reviewer passes LEDGER's mechanism rule. The run ends with open, converged PRs, or a design question handed back; merging is the user's call.

Resolve the log key once in the main repo (`log.sh --path` reuses the key the branch already logged under), then run `log.sh --bind <that key>` in each sibling repo's branch, so every repo writes to one log. Collect every key in every participating branch's key file and set them as `RECAP_PIN_KEYS='<keys>'` in front of each `log.sh --pins` call (shell variables do not survive between calls), so `--pins` in any repo reads all of those logs together and every review gets the same settled decisions, including ones logged in a sibling before binding.

## Required passes

**The pass sequence** is `/codexloop --until-converged --base <base>`. Before step 1, run `log.sh --check HEAD` in each repo's branch: an exit 2 hands back `Merge-ready: no: check could not run: <its message>`, and when its first line starts `Required passes on` (the repo, or its default branch, declares them in `docs/agents/pr-loop.md`), read [PASSES.md](PASSES.md) for that repo: there the sequence runs every required pass, each push and the hand-back wait on `log.sh --check`, and a `fable` line can stand. Record every pass as it lands, declared or not (LEDGER.md, **Review passes**).

- **A pass whose reviewer cannot run or finish** (it fails or times out, Spec finds no spec, or `/codexloop` exits `FAIL` on a reviewer error) is recorded `not-reviewed` and not rerun on that head in this run; a later run tries it again, and a clean result replaces the record. The run still makes a guarded push, goes through step 9 and hands back `Merge-ready: no: <pass> not reviewed`; a lint, test or merge failure is the run's to fix.
- **A guarded push** is `git push -u origin HEAD` from a branch other than `master`/`main` that has commits beyond the base, made when the remote lacks the head and never forced; a diverged remote hands back `Merge-ready: no: remote diverged`.

## 1. Two-axis review

Run `/code-review` on each repo's branch with the fixed point `origin/<base>` (the branch it merges into) and the spec given up front: the ticket plus the user's settled decisions (`log.sh --pins`). A prototype question from either axis goes to the user through step 5's gallery. Fix every hard violation and every spec gap; take a judgement call only when it makes the change simpler or clearer. Log each finding with its outcome. Record both axes on the head they reviewed: `log.sh --pass standards <head> clean|fixed`, and `log.sh --pass spec <head> clean|fixed [<body file>]`, with the PR body file Spec read, if any, saved beside the log as `spec-body-<head>.md` for step 9 (every Spec run, step 9's included).

Done when each branch's findings are fixed, logged as rejected with a reason, or logged with result `open` as questions for the user, and both axes are recorded.

## 2. Cross-family review to convergence

When only CI can judge the change (a failure seen only on CI's runners, a suite too heavy to run locally), open a draft PR first. Run the pass sequence on each branch; `/codexloop`'s reviewer is the other model family (Codex from Claude Code, Claude Opus 5.5 from Codex). In a native CLI, use the existing supported cross-family path and keep long Codex work on the plugin's background path.

Wherever this run calls `/codexloop`, a `PAUSED` exit (its design pause) stops the run on that branch. With a Fable pass approved, brief it on the cluster as step 5 does and carry its proposal to the user unapplied. Hand back the branch, and its PR if one is open, with the design question as the open item and `Merge-ready: no: design pause`.

Done when every branch has converged, or has a pass recorded `not-reviewed`, and its head is on the remote; or has stopped on a design pause or a check that could not run.

## 3. Open the PRs

Open one PR per repo against `<base>` with the `/pr` template, marked as closing the spec and tickets it finishes, its "Behavior changes vs master" section filled from the log's accepted rows with a `prod_delta` other than `none`, and the log's `open` rows listed as open questions. A branch that already has a PR keeps it, with its body updated the same way, and a draft opened under step 2 is marked ready. For a cross-repo change, name the merge order in every body and cross-link the PRs. Then, in each repo, write its PR's facts block (`python3 ~/.claude/skills/recap-pr/facts.py <pr>`; a failure is retried in step 9) and post each pending prototype question's gallery (step 5).

Done when every repo with commits on the branch has an open PR carrying its facts block (or a `facts.py` failure left for step 9) and any pending prototype gallery.

## 4. Bot and CI findings

Commit any fix from steps 5–8. A branch with unpushed commits first runs the pass sequence. Then follow `/address-pr-comments` on each PR, judging every bot finding and red check on the pushed head; a `LOOP_STATUS=FAIL` from it goes to step 9 without waiting for CI and hands back `Merge-ready: no: <its ERROR>`. Its finalize step sends accepted fixes through the same passes, and `/codexloop` picks up from its last logged round (Round scope).

A red check that passes on a re-run is an unexplained failure: diagnose it in this run through the repo's CI-only reproduction recipe (in its CI or e2e doc) and the `diagnosing-bugs` skill. The diagnosis ends when a cause is named (in the change, a finding like any other; older than the branch, step 7's own-commit fix), or when the recipe has run without reproducing the failure or the repo has no recipe; then the hand-back's CI line reports `cause unknown` and says which.

Done when every PR has converged, has no open bot finding (threads and review-body items alike), and every reviewer on its final pushed head has reviewed that head and passed, or is reported `NOT_REVIEWED` or `PENDING` (the `/address-pr-comments` convergence gate). A final-pass reviewer is judged in step 8.

## 5. Fable pass

A repo whose `fable` line stands (PASSES.md) runs it on every head the check finds it missing on. Otherwise, including a `fable` line that does not stand yet, an explicit human `/pr-loop` invocation approves at most one Fable pass for that run, as does an explicit request or approval of a single Fable pass; automatic skill routing grants no Fable approval. Without a standing line, when approved, run it when the diff carries a judgement the mechanical reviews keep circling, changes what customers or analysts see, or couples parts of the system in a way a reviewer has to hold in their head; mechanical changes that have already converged skip it.

Run it read-only, briefed with the diffs, the settled decisions, and what to look for: judgement calls, taste, simpler shapes of the problem and the code, edge cases, an adversarial read. A taste finding that departs from the spec's agreed prototype goes to the user as a question showing both pictures, the prototype as built and the proposal: one standalone gallery per question, under its own `--marker` (`no-mistakes-frontend` step 8), posted once the PR is open and never again. The prototype stays built until they choose. In Claude Code that is a subagent with `model: fable`; in Codex, `/Users/<you>/.codex/bin/claude-read claude-fable-5-1 "<brief>" [<extra dirs to read>]` (a copy of kstack `codex/bin/`), pointing the brief at files to Read; Codex allows only that read-only wrapper outside the sandbox, as a plain command. Record it: `log.sh --pass fable <head> clean|fixed`. Accepted Fable changes are committed and go round the pass sequence again, through step 4 once the PR is open.

Done when the run-or-skip decision and its reason are logged, every Fable finding is fixed, logged as rejected or put to the user as a question, and a pass that ran is recorded.

## 6. Verify in the running app, when the diff changes what renders

When a diff changes what a user sees or does (components, routes, styles, copy, a UI-facing API), run `/no-mistakes` on the final head through a route that drives the browser (frontend or full-stack, never backend-only), with a case for the change on screen, and post its screenshots and recordings to the PR. In a cross-repo change, post the evidence on the PR whose diff caused what changed on screen. A diff that changes nothing on screen skips this; log the run-or-skip and why. A fix it causes goes back through step 4, and the evidence is retaken on the head that fix produces.

Done when every PR whose diff changes what renders carries evidence from its final head, or a logged skip.

## 7. Affected tests

Run each repo's affected tests on the final heads, deriving the set from the diff as `/implement` does. Fix a failure that predates the branch too, in its own commit, logged with `asked no`; any fix goes back through step 4, and through step 6 when it changes what renders.

Record each final head, affected commands and collected/executed test results, review state, and unresolved items together in the decision log. Reuse evidence for unchanged inputs and revisions; a relevant fix reruns its affected checks. Done when the affected tests pass on the heads being handed back.

## 8. Final pass

When the repo names final-pass reviewers (`/address-pr-comments`, **The final pass**), make the call for each one on each PR once steps 4–7 are done on that PR's final head, and post the requests you make together, so they review last. Then run step 4, which waits for their reviews and works their findings; steps 6 and 7 follow for the fixes they touch. Each time steps 4, 6 and 7 settle on a new head, make the call again.

Done when each final-pass reviewer is done (**The final pass**, "It's done") and steps 6 and 7 are done for its fixes. A repo that names none skips this step.

## 9. Recap and hand-back

1. Follow `~/.claude/skills/recap-pr/SKILL.md`.
2. Once CI has finished on each final head, or passed its deadline (**Waits** in `/address-pr-comments`), or at once after a FAIL from step 4, refresh its PR's facts block from its repo: `facts.py <pr>`.
3. Run `log.sh --check <head> <pr>` in its repo. While it exits 1, or 3 naming a pass this run has not tried, run the passes it names, skipping any this run recorded `not-reviewed`, and check again: a changed fact or the recap's edit reruns Spec, so Spec reads the finished description last. A pass that changes the head sends it back through steps 4 to 8, then step 9 starts again from 1 on the new head; so does a PR whose head has moved past the one checked. A stale body the run did not cause means a bot or person changed the description: compare it with `spec-body-<head>.md`, restore any lost edit, then rerun Spec. A `gh` error (exit 2) is retried once; any error then hands back `Merge-ready: no: check could not run: <its message>`.
4. Refresh only the block's review record (`facts.py <pr> --record-only`), keeping the facts Spec read, and run the check a last time: its output is the one handed back. Exit 3 (only `not-reviewed` passes left) hands back `Merge-ready: no: <passes> not reviewed`; any other failure of the check goes back to 3. A `facts.py` failure at 2 or 4 goes back to 2, which rebuilds a missing block; a second one in this step hands back `Merge-ready: no: facts block not written: <its message>`.
5. Hand back this block for each PR, every line filled from the final head:

```text
PR <url>: <what it changes, in a user's words> · head <sha> · merge order <n>
Required passes: <log.sh --check's output, whole>
Reviewers on this head: <each review bot and final-pass reviewer: passed | failed: why | NOT_REVIEWED: reason | its final-pass report>
Open findings: <none | each one>
CI on this head: <each check and its conclusion from the facts block, with test counts where the repo's facts give them>
App evidence: <taken on <sha> | skipped: reason>
Merge-ready: <yes | yes, after <sibling PR> merges | no: what blocks it>
```

A deploy job's result is reported but never sets `Merge-ready: no`; a failed reviewer, an open finding, a failing or still-pending required CI check, or `log.sh --check` exiting non-zero does. In a repo that declares passes, a description edit after the hand-back (a settled question) reruns Spec and the check before a `yes` stands again.

Done when `recap.html` exists beside the log, every PR body's "Behavior changes vs master" section matches it, each PR's facts block was written on its final head or its failure handed back, and each PR's block is handed back with its check's output.

## When the user says merged

1. Use the cleanup skill to retire this run's resources, deleting its merged branches, and stop any PR watch the run started.
2. Close what the PRs finished: each ticket whose whole scope the merged PRs delivered and the merge did not close itself, and a parent once every child is closed and nothing on its checklist is left, ticking what the merge delivered. A ticket with work left stays open, with a comment saying what remains.
3. Check production runs the merge, following the deploy check the repo documents (`docs/deploy.md` or similar): report the deployed commit and, where the merge carries migrations, whether they applied. With no documented check, say so rather than guess.

Done when the cleanup inventory is empty or names a reason for each kept resource, the finished issues are closed, and the deploy state is reported.

## Runtime handoff and close-out

For native CLI monitoring, use the existing review/check tools. T3 transport and PR tracking follow its injected instructions. Every wait in the run, on a bot, a check, a delegated round or a child, follows **Waits** in `/address-pr-comments`.

When addressing comments is already authorized, read and follow `~/.codex/prompts/address-pr-comments.md` in Codex or `~/.claude/commands/address-pr-comments.md` in Claude Code and judge each finding without another selection prompt. Keep merging as the user's decision.

Before delegating, read [HANDOFF.md](HANDOFF.md).

Before declaring the session safe to archive, use the cleanup skill to account for owned processes, brokers, servers, Docker resources, and retained worktrees. A completed agent turn is not proof that its jobs have finished.
